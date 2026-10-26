#!/usr/bin/env node
/**
 * Verify the built pages' Content Security Policy actually permits their own scripts.
 *
 * This check exists because the failure it looks for reached production and nothing
 * caught it. Content-Security-Policy in public/_headers said `script-src 'self'`,
 * Astro inlines page scripts by default, and so the browser refused every one. The
 * mobile Menu button silently did nothing for as long as that policy was live: the
 * build passed, the four gates passed, the deploy passed, and the sitemap was fine.
 * Only a real browser clicking the button showed it.
 *
 * A static check would have caught it in one line, so here it is.
 *
 * Run after a build:  node tools/check-csp.mjs
 * Exits non-zero if any page's policy would block a script the page needs.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DIST = "dist";

if (!existsSync(DIST)) {
  console.log("RESULT: FAIL — dist/ does not exist, run the build first");
  process.exit(1);
}

/** Every built HTML page. */
function pages(dir = DIST, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const files = pages();
const problems = [];

for (const f of files) {
  const h = readFileSync(f, "utf8");

  // The policy Astro emitted as a meta tag.
  //
  // Two earlier versions of this line were wrong, both by trying to be clever about
  // quotes. The value is wrapped in double quotes and is itself full of single quotes
  // ('self', 'unsafe-inline'), so [^"']* stops at the opening quote of 'self' and
  // captures 12 characters. Match the attribute's own quote character and let the
  // content run to the matching one.
  const metaTag = /<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/i.exec(h)?.[0] ?? null;
  const metaPolicy = metaTag ? /content=("([^"]*)"|'([^']*)')/i.exec(metaTag)?.slice(2).find((x) => x !== undefined) ?? null : null;

  // Inline scripts the browser will execute. JSON-LD is data, not script, so the
  // policy does not apply to it and it must not be counted.
  const inline = [...h.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(
    (m) => !/\ssrc=/.test(m[1]) && !/type=["']application\/(ld\+json|json)["']/i.test(m[1]),
  );

  if (inline.length === 0) continue;

  if (!metaPolicy) {
    // No meta policy at all is only safe if no header policy exists either. The
    // header file is checked below, so record the page and let that decide.
    problems.push({ file: f, why: `${inline.length} inline script(s) but no CSP meta tag` });
    continue;
  }

  const scriptSrc = /script-src([^;]*)/.exec(metaPolicy)?.[1] ?? "";
  for (const m of inline) {
    const digest = "sha256-" + createHash("sha256").update(m[2], "utf8").digest("base64");
    const covered = scriptSrc.includes(digest) || /'unsafe-inline'/.test(scriptSrc);
    if (!covered) {
      problems.push({ file: f, why: `inline script not covered by script-src (needs ${digest})` });
    }
  }
}

// The header file must not carry a hand-written script-src: two policies intersect
// and the stricter one wins, so a stale header would keep overriding Astro's.
const headersPath = join(DIST, "_headers");
let headerNote = "no _headers file";
if (existsSync(headersPath)) {
  const hd = readFileSync(headersPath, "utf8");
  const headerCsp = hd.split("\n").filter((l) => /^\s*Content-Security-Policy:/i.test(l)).map((l) => l.trim());
  if (headerCsp.some((l) => /script-src/i.test(l))) {
    problems.push({ file: "_headers", why: `declares its own script-src, which intersects with Astro's: ${headerCsp.join(" | ").slice(0, 120)}` });
  }
  headerNote = headerCsp.length ? headerCsp.map((l) => l.replace(/^Content-Security-Policy:\s*/i, "")).join("; ").slice(0, 100) : "no CSP line";
}

console.log("CSP SELF-CHECK\n" + "=".repeat(78));
console.log(`  pages built        : ${files.length}`);
console.log(`  header CSP         : ${headerNote}`);

const withInline = files.filter((f) => {
  const h = readFileSync(f, "utf8");
  return [...h.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].some(
    (m) => !/\ssrc=/.test(m[1]) && !/type=["']application\/(ld\+json|json)["']/i.test(m[1]),
  );
}).length;
console.log(`  pages with inline scripts needing a hash: ${withInline}`);

if (problems.length === 0) {
  console.log("\nRESULT: PASS — every page's policy permits the scripts it ships");
  process.exit(0);
}

console.log(`\n${problems.length} PROBLEM(S):`);
for (const p of problems.slice(0, 10)) console.log(`  ${p.file.replace(/\\/g, "/")}\n    ${p.why}`);
if (problems.length > 10) console.log(`  ... and ${problems.length - 10} more`);
console.log("\nRESULT: FAIL — the browser would refuse these scripts, and the page would silently do nothing");
process.exit(1);
