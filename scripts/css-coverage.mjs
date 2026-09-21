// Reports how much of each shipped stylesheet is actually used across the
// site's key pages, using Chrome's CSS coverage instrumentation.
//
//   node scripts/css-coverage.mjs                  # ./_site, read off disk
//   node scripts/css-coverage.mjs --dir _site
//   node scripts/css-coverage.mjs --base https://noahweidig.com/quarto-portfolio
//   node scripts/css-coverage.mjs --budget 40      # fail under 40% used
//
// Advisory by default (#267): with ~5,100 lines of hand-written CSS and no
// unused-selector check, dead rules accumulate invisibly and ship
// render-blocking to every visitor. Coverage is measured per stylesheet and
// unioned across pages, so a rule used on any one page counts as used.
//
// It is a floor, not a verdict: rules behind :hover, a media query the
// viewport doesn't match, or a state only JS reaches will read as unused.
// Hence advisory first, and --budget only once the number is trusted.

import path from "node:path";
import puppeteer from "puppeteer";

const PAGES = [
  "index.html",
  "cv.html",
  "experience/index.html",
  "education/index.html",
  "projects/index.html",
  "publications/index.html",
  "blog/index.html",
  "contact.html",
  "styleguide.html",
];

function parseArgs(argv) {
  const args = { dir: "_site", base: null, budget: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--budget") args.budget = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function toUrl(page, args) {
  if (!args.base) return "file://" + path.resolve(args.dir, page);
  const clean = page.replace(/index\.html$/, "").replace(/\.html$/, "");
  return new URL(clean, args.base.endsWith("/") ? args.base : args.base + "/").href;
}

// Ranges arrive per page and overlap between pages; merging them keeps the
// union honest instead of double-counting the same bytes.
function merge(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// Same reason as axe-audit.mjs: the CI container has no usable Chrome sandbox,
// and the browser only opens this site's own pages.
const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

// url -> { total, ranges: [] }
const sheets = new Map();

for (const page of PAGES) {
  const tab = await browser.newPage();
  try {
    await tab.coverage.startCSSCoverage();
    await tab.goto(toUrl(page, args), { waitUntil: "networkidle0" });
    for (const entry of await tab.coverage.stopCSSCoverage()) {
      // Inline <style> blocks have no stable identity across pages.
      if (!/\.css(\?|$)/.test(entry.url)) continue;
      const key = entry.url.split("/").pop().split("?")[0];
      const rec = sheets.get(key) || { total: 0, ranges: [] };
      rec.total = Math.max(rec.total, entry.text.length);
      rec.ranges.push(...entry.ranges);
      sheets.set(key, rec);
    }
  } finally {
    await tab.close();
  }
}

await browser.close();

let siteUsed = 0;
let siteTotal = 0;
const rows = [];

for (const [name, rec] of [...sheets].sort((a, b) => a[0].localeCompare(b[0]))) {
  const used = merge(rec.ranges).reduce((n, r) => n + (r.end - r.start), 0);
  siteUsed += used;
  siteTotal += rec.total;
  rows.push({
    name,
    kb: (rec.total / 1024).toFixed(1),
    pct: rec.total ? ((used / rec.total) * 100).toFixed(1) : "0.0",
  });
}

const width = Math.max(10, ...rows.map((r) => r.name.length));
console.log(`CSS coverage over ${PAGES.length} pages\n`);
console.log(`${"stylesheet".padEnd(width)}  ${"size".padStart(8)}  ${"used".padStart(7)}`);
for (const r of rows) {
  console.log(
    `${r.name.padEnd(width)}  ${(r.kb + " KB").padStart(8)}  ${(r.pct + "%").padStart(7)}`,
  );
}

const sitePct = siteTotal ? (siteUsed / siteTotal) * 100 : 0;
console.log(
  `\ntotal: ${(siteTotal / 1024).toFixed(1)} KB, ${sitePct.toFixed(1)}% used, ` +
    `${((siteTotal - siteUsed) / 1024).toFixed(1)} KB unused`,
);

if (args.budget !== null && sitePct < args.budget) {
  console.error(`\nBudget: ${sitePct.toFixed(1)}% used is below the ${args.budget}% floor.`);
  process.exit(1);
}
