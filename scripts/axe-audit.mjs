// Runs axe-core over the site's key pages and exits non-zero on violations.
//
//   node scripts/axe-audit.mjs                     # ./_site, read off disk
//   node scripts/axe-audit.mjs --dir _site
//   node scripts/axe-audit.mjs --base https://noahweidig.com/quarto-portfolio
//
// Lived in a heredoc inside .github/workflows/axe.yml until #249/#256: as a
// file it can run locally (`npm run a11y`), it can point at production for
// the scheduled audit, and its dependencies are pinned in package.json
// instead of in a workflow string.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import puppeteer from "puppeteer";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const PAGES = [
  "index.html",
  "cv.html",
  "experience/index.html",
  "education/index.html",
  "projects/index.html",
  "publications/index.html",
  "blog/index.html",
  "contact.html",
  // The 404 page carries the site chrome now, so it gets checked like any other.
  "404.html",
  // Renders every token and component on one page (#222), so a regression in
  // any component fails here regardless of which page it ships on.
  "styleguide.html",
];

// Scoped to heading-order rather than a full axe scan: the site currently has
// other, pre-existing violations (color contrast, landmark structure) that are
// out of scope here. Broadening this to the full rule set is a separate task.
const RULES = ["heading-order"];

function parseArgs(argv) {
  const args = { dir: "_site", base: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--base") args.base = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

// Production serves extensionless URLs; the on-disk build is index.html files.
function toUrl(page, args) {
  if (!args.base) return "file://" + path.resolve(args.dir, page);
  const clean = page.replace(/index\.html$/, "").replace(/\.html$/, "");
  return new URL(clean, args.base.endsWith("/") ? args.base : args.base + "/").href;
}

const args = parseArgs(process.argv.slice(2));

// The CI container disallows unprivileged user namespaces, so Chrome's own
// sandbox can't initialize (zygote_host_impl_linux.cc: "No usable sandbox!").
// Safe here: the browser only opens this site's own pages.
const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

let failed = false;
for (const page of PAGES) {
  const url = toUrl(page, args);
  const tab = await browser.newPage();
  try {
    await tab.goto(url, { waitUntil: "networkidle0" });
    await tab.evaluate(axeSource);
    const results = await tab.evaluate(
      (values) => axe.run({ runOnly: { type: "rule", values } }),
      RULES,
    );

    if (results.violations.length) {
      failed = true;
      console.log(`\n=== ${page}: ${results.violations.length} violation(s) ===`);
      for (const v of results.violations) {
        console.log(`[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
        for (const node of v.nodes) console.log(`  - ${node.target.join(" ")}`);
      }
    } else {
      console.log(`${page}: no violations`);
    }
  } catch (err) {
    failed = true;
    console.log(`\n=== ${page}: could not be audited ===\n${err.message}`);
  } finally {
    await tab.close();
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
