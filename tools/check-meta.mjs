/**
 * Check the metadata of every built page: uniqueness, and whether it fits a search result.
 *
 * ## Why this gate exists
 *
 * Every other gate here checks the body: structure, links, policy, layout, figures. Nothing checked the
 * two lines that decide whether anyone arrives at all. So they drifted silently and were measured for
 * the first time on 2026-10-17, with these results on 135 pages:
 *
 *   title over 60 display columns        72 pages      longest 125
 *   description over 155                 88 pages      longest 290
 *   four pages titled identically         "European Commission" x4
 *
 * The cause of the duplicates is worth keeping visible, because the fix looks like the bug. Instrument
 * pages took the source string and cut it at the first comma, on the theory that the part before the
 * comma names the institution and the rest is detail. The detail is the point: "2026 coordinated
 * product safety sweep results" versus "DG TAXUD, Price of CBAM certificates" is the entire difference
 * between two documents, and the old code threw it away and then truncated what was left.
 *
 * ## What it enforces
 *
 *   title        <= 60 display columns, and unique across the whole site
 *   description  <= 155 display columns, and unique
 *   both present on every page, non-empty
 *
 * Width counts CJK and fullwidth characters as two columns, because a title of 60 Chinese characters
 * is twice as wide as 60 Latin ones and gets cut in a result. Measuring in code points would have
 * passed the Vietnamese and Chinese instrument titles that are actually over the limit.
 *
 * The limits are the practical SERP widths rather than a specification. 60 and 155 are where a result
 * stops showing the text and starts rewriting it from page content, which hands the search engine
 * control of the line that decides the click.
 *
 *   node tools/check-meta.mjs
 *   node tools/check-meta.mjs --list      # every offending page, not just the first few
 *
 * Exits non-zero if any page fails.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const LIST_ALL = process.argv.includes("--list");

if (!existsSync("dist")) {
  console.log("RESULT: FAIL - dist/ does not exist, run the build first");
  process.exit(1);
}

/**
 * Display width, not string length.
 *
 * A CJK or fullwidth code point occupies about two columns in a result snippet. The first version of
 * this measurement used String.length, which reported a 43-character Chinese title as comfortably
 * short when it is 86 columns wide and would be truncated. The site publishes Chinese source titles
 * on the instrument pages, so this is not hypothetical.
 */
export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
        ? 2
        : 1;
  }
  return w;
}

const TITLE_MAX = 60;
const DESC_MAX = 155;

function pages(dir = "dist", out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name === "index.html") out.push(p);
  }
  return out;
}

const decode = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const rows = [];
for (const f of pages()) {
  const h = readFileSync(f, "utf8");
  const url = "/" + f.replace(/^dist[\\/]/, "").replace(/index\.html$/, "").replace(/\\/g, "/");
  rows.push({
    url,
    title: decode((/<title[^>]*>([\s\S]*?)<\/title>/.exec(h) ?? [])[1] ?? ""),
    desc: decode((/<meta\s+name="description"\s+content="([^"]*)"/.exec(h) ?? [])[1] ?? ""),
  });
}

const problems = [];
const seenTitle = new Map();
const seenDesc = new Map();

for (const r of rows) {
  if (!r.title) problems.push([r.url, "no <title>"]);
  else if (displayWidth(r.title) > TITLE_MAX) problems.push([r.url, `title is ${displayWidth(r.title)} columns, limit ${TITLE_MAX}: ${r.title}`]);
  if (!r.desc) problems.push([r.url, "no meta description"]);
  else if (displayWidth(r.desc) > DESC_MAX) problems.push([r.url, `description is ${displayWidth(r.desc)} columns, limit ${DESC_MAX}`]);

  /*
   * Uniqueness is checked on the whole string, which is what a search result shows. Two pages may share
   * a prefix as long as they differ, and the collision that matters is the one a reader cannot tell
   * apart.
   */
  if (r.title) {
    if (seenTitle.has(r.title)) problems.push([r.url, `title duplicates ${seenTitle.get(r.title)}: ${r.title}`]);
    else seenTitle.set(r.title, r.url);
  }
  if (r.desc) {
    if (seenDesc.has(r.desc)) problems.push([r.url, `description duplicates ${seenDesc.get(r.desc)}`]);
    else seenDesc.set(r.desc, r.url);
  }
}

console.log("META CHECK\n" + "=".repeat(76));
console.log(`  pages      : ${rows.length}`);
console.log(`  title limit: ${TITLE_MAX} columns, unique`);
console.log(`  desc limit : ${DESC_MAX} columns, unique`);
console.log("");

const longestT = rows.reduce((a, r) => (displayWidth(r.title) > displayWidth(a.title) ? r : a), rows[0] ?? { title: "" });
const longestD = rows.reduce((a, r) => (displayWidth(r.desc) > displayWidth(a.desc) ? r : a), rows[0] ?? { desc: "" });
console.log(`  longest title      : ${displayWidth(longestT.title)}`);
console.log(`  longest description: ${displayWidth(longestD.desc)}`);
console.log("");

const dupTitles = rows.length - seenTitle.size;

if (!problems.length) {
  console.log(`RESULT: PASS - every title fits ${TITLE_MAX} columns and is unique, and every description fits ${DESC_MAX}`);
  process.exit(0);
}

console.log(`${problems.length} PROBLEM(S):`);
for (const [url, why] of LIST_ALL ? problems : problems.slice(0, 15)) console.log(`  ${url}\n      ${why}`);
if (!LIST_ALL && problems.length > 15) console.log(`  ... and ${problems.length - 15} more (--list shows all)`);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
