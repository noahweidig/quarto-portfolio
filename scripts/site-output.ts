/**
 * site-output.ts — shared helpers for the post-render scripts.
 *
 * `scripts/generate-og.ts` and `scripts/optimize-output.ts` both walk the
 * rendered site and rewrite pages in place, so they both need to know where
 * Quarto put the output and how to enumerate it; `scripts/build-404.ts` and
 * `scripts/page-headers.ts` both read the navbar out of _quarto.yml and turn
 * its hrefs into site-root URLs. All of that lives here rather than being
 * written twice.
 *
 * Imported by scripts Quarto runs with its bundled Deno; also loadable under
 * `node --experimental-strip-types`.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** Project root. Quarto sets QUARTO_PROJECT_DIR when it runs a post-render
 *  script; falling back to this file's parent keeps direct invocation working. */
export const projectRoot: string =
  process.env.QUARTO_PROJECT_DIR ??
  path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** The rendered site (`_site` unless the project overrides `output-dir`). */
export const outputDir: string = process.env.QUARTO_PROJECT_OUTPUT_DIR
  ? path.resolve(projectRoot, process.env.QUARTO_PROJECT_OUTPUT_DIR)
  : path.join(projectRoot, "_site");

/**
 * The site's deploy path, read from `site-url` in _quarto.yml — `""` when the
 * site sits at its domain's root, or e.g. `/quarto-portfolio` when it is
 * served from a subpath (as this repo has been renamed and re-homed a few
 * times now, see #278). Every hand-written root-absolute href/src in the
 * project (nav, footer, favicons, the compiled theme CSS) has to carry this
 * prefix, and reading it from one place here means the next rename only
 * touches `site-url`.
 */
export const basePath: string = (() => {
  const yml = fs.readFileSync(path.join(projectRoot, "_quarto.yml"), "utf8");
  const m = /^\s*site-url:\s*["']?([^"'\s]+)/m.exec(yml);
  if (!m) return "";
  try {
    return new URL(m[1]).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
})();

/**
 * Every rendered page under `dir`, depth first. Quarto's own asset bundles
 * (`site_libs/`) and per-document resource folders (`*_files/`) hold library
 * HTML that is never a page, so they are skipped.
 */
export function* walkHtml(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "site_libs" || entry.name.endsWith("_files")) continue;
      yield* walkHtml(full);
    } else if (entry.name.endsWith(".html")) {
      yield full;
    }
  }
}

/** A navbar entry: its label and the source file it points at. */
export interface Destination {
  text: string;
  href: string;
}

/**
 * The navbar's left-hand entries, as they appear in _quarto.yml. Parsed by
 * hand rather than with a YAML dependency: the block is a flat list of
 * `- text:` / `href:` pairs and the post-render scripts deliberately run with
 * nothing to install.
 */
export function navDestinations(yml: string): Destination[] {
  const lines = yml.split("\n");
  const start = lines.findIndex((line) => /^\s{4}left:\s*$/.test(line));
  if (start < 0) return [];
  const items: Destination[] = [];
  let current: Partial<Destination> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // A sibling key of `left:` (same or shallower indent) ends the list.
    if (!/^\s{6}/.test(line)) break;
    const text = /^\s+-?\s*text:\s*(.*?)\s*$/.exec(line);
    if (text && /^\s+-\s/.test(line)) {
      if (current.text && current.href) items.push(current as Destination);
      current = { text: unquote(text[1]) };
      continue;
    }
    const href = /^\s+href:\s*(.*?)\s*$/.exec(line);
    if (href) current.href = unquote(href[1]);
  }
  if (current.text && current.href) items.push(current as Destination);
  return items;
}

/** A YAML scalar with its surrounding quotes, if any, taken off. */
export function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/**
 * The site-root URL a navbar href renders to. Quarto navbars point at source
 * files; `foo/index.qmd` becomes the directory `/foo/` and `foo.qmd` becomes
 * `/foo.html` — the form the rest of the site links with, and the only one
 * that exists on disk for the link check to resolve.
 */
export function toUrl(href: string): string {
  const clean = href.replace(/^\//, "");
  if (clean.endsWith("/index.qmd")) return `/${clean.slice(0, -"index.qmd".length)}`;
  return `/${clean.replace(/\.qmd$/, ".html")}`;
}

/** Text destined for an HTML attribute or text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
