#!/usr/bin/env node
/**
 * Does every internal link point at a file that exists?
 *
 * `tools/link-check.mjs` answers a different question: it builds the graph *between articles* and asks
 * whether they link to each other. It never looks at the built site, which is how `/tracker/` - a link
 * to a route that was never generated - survived on the homepage. This tool walks `dist/` instead and
 * resolves each internal href/src to a real file.
 *
 * ## What counts as internal
 *
 * A path that starts with `/`. Everything else is left alone: absolute URLs belong to the network
 * policy (and this tool makes no requests), `mailto:`/`tel:` are not files, and a bare `#fragment` is
 * a position on the current page, not a destination.
 *
 * ## Resolution rules, stated because they are where false results come from
 *
 *   /about      -> dist/about/index.html   (Astro emits directory routes)
 *   /about/     -> dist/about/index.html
 *   /x.html     -> dist/x.html
 *   /_astro/a.css, /favicon.svg -> the file itself
 *   ?query and #fragment are stripped before resolution
 *   %20 and friends are decoded
 *   //host/path is protocol-relative, i.e. external, and is skipped
 *
 * A path that resolves to a **directory without index.html** is a failure, not a pass: that is the
 * shape of a broken route.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const hrefRe = /(?:href|src)="([^"]+)"/g;

/** Strip query and fragment, decode percent-escapes, and collapse duplicate slashes. */
export function normalizeTarget(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null; // same-page fragment
  if (/^(mailto|tel|javascript|data):/i.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null; // absolute URL
  if (trimmed.startsWith("//")) return null; // protocol-relative = external
  if (!trimmed.startsWith("/")) return null; // relative to the page: not checked here
  const withoutQuery = trimmed.split("#")[0].split("?")[0];
  let decoded = withoutQuery;
  try { decoded = decodeURIComponent(withoutQuery); } catch { /* keep the raw form */ }
  const collapsed = decoded.replace(/\/{2,}/g, "/");
  return collapsed.startsWith("/") ? collapsed : "/" + collapsed;
}

/** Map a site path to the file that must exist, or null when the path is not a checked target. */
export function fileFor(distDir, path) {
  if (!path) return null;
  const bare = path === "/" ? "/index.html" : path;
  if (extname(bare)) return join(distDir, bare);
  const asDir = join(distDir, bare, "index.html");
  return asDir;
}

/** @returns {{checked:number, missing:Array<{page:string, href:string, resolved:string}>}} */
export function scanSite(distDir) {
  const missing = [];
  let checked = 0;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
  if (!existsSync(distDir)) return { checked: 0, missing: [{ page: "(none)", href: "(no dist)", resolved: distDir }] };

  for (const file of walk(distDir)) {
    if (!file.endsWith(".html")) continue;
    const page = "/" + relative(distDir, file).replace(/\\/g, "/");
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(hrefRe)) {
      const target = normalizeTarget(m[1]);
      if (!target) continue;
      checked++;
      const resolved = fileFor(distDir, target);
      if (!existsSync(resolved) || (existsSync(resolved) && statSync(resolved).isDirectory())) {
        missing.push({ page, href: m[1], resolved: relative(distDir, resolved) });
      }
    }
  }
  return { checked, missing };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { checked, missing } = scanSite(DIST);
  console.log("LINK INTEGRITY");
  console.log("=".repeat(64));
  console.log(`  dist      : ${relative(ROOT, DIST)}`);
  console.log(`  internal  : ${checked} absolute href/src checked`);
  console.log(`  missing   : ${missing.length}`);
  for (const x of missing.slice(0, 12)) console.log(`    ${x.page} -> ${x.href}  (looked for ${x.resolved})`);
  console.log("");
  console.log(missing.length ? "RESULT: broken internal targets" : "RESULT: every internal target resolves to a file in dist");
  process.exit(missing.length ? 1 : 0);
}
