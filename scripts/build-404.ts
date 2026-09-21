/**
 * build-404.ts — build the 404 page's destination cards from the navbar.
 *
 * Runs as a Quarto post-render step (see `project.post-render` in
 * _quarto.yml). Quarto executes it with its bundled Deno; for local debugging
 * it also runs under Node:
 *
 *   node --experimental-strip-types scripts/build-404.ts
 *
 * The cards in 404.qmd are fallbacks, the same way the stat strips work: this
 * script reads `website.navbar.left` out of _quarto.yml and rewrites the
 * <div data-nw-404-destinations> block in the rendered 404.html from it. A
 * section added, renamed or removed in the navbar therefore shows up on the
 * 404 page on the next render, with no hand-maintained second list to drift.
 *
 * Icon and blurb come from the table below, keyed by the navbar's own href.
 * An unknown destination still gets a card — a generic icon and no blurb —
 * so a new section is never silently dropped.
 */

import fs from "node:fs";
import path from "node:path";
import {
  basePath,
  type Destination,
  escapeHtml,
  navDestinations,
  outputDir,
  projectRoot,
  toUrl,
} from "./site-output.ts";

/** Per-destination chrome, keyed by the site-root URL the navbar resolves to. */
const CARDS: Record<string, { blurb: string; icon: string }> = {
  "/projects/": {
    blurb: "Geospatial analysis, R packages, and data tools.",
    icon: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 9l3 3-3 3M13 15h3"/>',
  },
  "/publications/": {
    blurb: "Papers, presentations, and media coverage.",
    icon: '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6v13"/><path d="M12 6v13"/><path d="M21 6v13"/>',
  },
  "/experience/": {
    blurb: "Roles, fieldwork, and the analysis behind each.",
    icon: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2"/><path d="M12 12v.01"/><path d="M3 13a20 20 0 0 0 18 0"/>',
  },
  "/education/": {
    blurb: "Degrees, coursework, and academic background.",
    icon: '<path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7 -3l7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/>',
  },
  "/awards/": {
    blurb: "Awards, scholarships, grants, and honors.",
    icon: '<circle cx="12" cy="9" r="6"/><path d="M9 14.2l-1 7.8l4 -2l4 2l-1 -7.8"/>',
  },
  "/blog/": {
    blurb: "Notes on R, spatial data, and working reproducibly.",
    icon: '<path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  },
  "/cv.html": {
    blurb: "The full record — education, roles, talks, and skills.",
    icon: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 13h6"/><path d="M9 17h3"/>',
  },
  "/contact.html": {
    blurb: "Email, book a call, or send a message.",
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6l9 -6"/>',
  },
};

/** Fallback glyph for a navbar entry the table above doesn't know yet. */
const GENERIC_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/>';

function card(destination: Destination): string {
  const url = toUrl(destination.href);
  const chrome = CARDS[url];
  const label = escapeHtml(destination.text);
  const icon = chrome?.icon ?? GENERIC_ICON;
  const blurb = chrome?.blurb ? `\n        <p>${escapeHtml(chrome.blurb)}</p>` : "";
  return [
    `      <a class="nw-start-card" href="${basePath}${url}">`,
    `        <span class="nw-start-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></span>`,
    `        <h2>${label}</h2>${blurb}`,
    `        <span class="nw-start-link">Go to this section &#8594;</span>`,
    "      </a>",
  ].join("\n");
}

function main(): void {
  const yml = fs.readFileSync(path.join(projectRoot, "_quarto.yml"), "utf8");
  const destinations = navDestinations(yml);
  const page = path.join(outputDir, "404.html");

  // Non-fatal: the page ships usable fallback cards, so a missing render or a
  // navbar this parser can't read warns rather than failing the whole build.
  if (destinations.length === 0) {
    console.warn("[404] no navbar destinations found in _quarto.yml; keeping fallback cards");
    return;
  }
  // Education has its own section (linked from the footer) but isn't a
  // navbar item, so navDestinations() never sees it. The navbar's odd item
  // count otherwise leaves a lopsided last row in the auto-fit grid; slot
  // Education in right after Experience, where the footer group puts it, to
  // fill it out evenly.
  const experienceIndex = destinations.findIndex((d) => toUrl(d.href) === "/experience/");
  const educationDestination: Destination = { text: "Education", href: "education/index.qmd" };
  destinations.splice(
    experienceIndex === -1 ? destinations.length : experienceIndex + 1,
    0,
    educationDestination,
  );
  if (!fs.existsSync(page)) {
    console.warn(`[404] rendered page not found: ${page}`);
    return;
  }

  const html = fs.readFileSync(page, "utf8");
  // Pandoc renders the bare marker attribute as `data-nw-404-destinations=""`,
  // so the value is optional here and the source form matches too.
  const re = /(<div class="[^"]*" data-nw-404-destinations(?:="")?>)[\s\S]*?(\n\s*<\/div>)/;
  if (!re.test(html)) {
    console.warn("[404] destinations marker not found in 404.html; keeping fallback cards");
    return;
  }
  const cards = destinations.map(card).join("\n");
  const out = html.replace(re, `$1\n${cards}$2`);
  if (out !== html) fs.writeFileSync(page, out);
  console.log(`[404] destinations: ${destinations.map((d) => d.text).join(", ")}`);
}

main();
