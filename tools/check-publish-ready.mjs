/**
 * Publish-readiness check for draft articles.
 *
 *   node tools/check-publish-ready.mjs                 # every draft
 *   node tools/check-publish-ready.mjs <slug> [...]    # named drafts
 *   node tools/check-publish-ready.mjs --all           # drafts and published alike
 *
 * ## Why this exists
 *
 * A draft is invisible: `published()` filters it out of the build, so no gate, no preflight check and
 * no build step ever looks at it. A skeleton can sit in the repository for weeks and nothing reports
 * that it would fail the moment someone set `draft: false`. This turns the readiness of a draft into
 * something measurable now rather than at the moment it is published.
 *
 * ## Why it copies rather than flips the flag
 *
 * The article validators read content from `src/content/blog/`, and the build reads the same
 * directory. Setting `draft: false` in place would publish the article to the live site on the next
 * push - which is exactly what this round must not do. So each draft is copied to `data/tmp/`, the
 * flag is flipped in the copy, and the validators run against that path. The repository is never
 * modified.
 *
 * ## What it checks, and what it cannot
 *
 * The structural rules run against the copy. What it also does - and this is the part that matters
 * for these five files - is scan for the markers a skeleton carries: the sample-post comment, a
 * source line that says a figure is illustrative, and first-person experience claims that section 5.4
 * of the spec forbids because there is no human reviewer to catch an invented one.
 *
 * It cannot tell whether a figure is true. Nothing automated can. It can tell whether a figure is
 * marked as invented, which is what a skeleton does, and that distinction is the whole check.
 *
 * ## The state of the five drafts, measured 2026-10-12
 *
 * All five are v0.1 skeletons and none is publish-ready. The check reports what each one needs, and
 * the first run produced this, which is recorded here because it is the answer to "how ready are
 * they" and re-deriving it costs a build each time:
 *
 *   bonded-logistics-growth-supply-chain    300 words, 0 figures, 3 markers, 2 first-person claims, 9 blocks
 *   china-us-30b-tariff-truce-q4-margins    485 words, 0 figures, 3 markers, 8 blocks
 *   eu-anti-dumping-cellulose-ethers-30-days 306 words, 0 figures, 3 markers, 9 blocks
 *   temu-semi-managed-traffic-shift         290 words, 0 figures, 6 markers, 2 panel claims, 9 blocks
 *   tiktok-shop-us-sps-score-oct-15         336 words, 0 figures, 6 markers, 9 blocks
 *
 * Two of them carry a source line that reads "ILLUSTRATIVE - placeholder figure, no real panel behind
 * it", and the Temu draft's body calls that panel "our panel of 268 stores". One carries a
 * first-person inventory decision. Those are not gaps to fill; they are claims that must be removed or
 * replaced with something a document supports, and the check exists so that a draft cannot be
 * promoted without that being noticed.
 *
 * Source verification attempted on 2026-10-12 for two of the five, and neither succeeded:
 *   - EU cellulose ethers: the Commission's trade-defence register (tron.trade.ec.europa.eu) returns
 *     200 with 28 characters because it is client-rendered, and EUR-Lex returns 202 to an automated
 *     request. Nothing to cite, so nothing written.
 *   - China-US 30 billion truce: the corpus holds eight verified Section 301 figures, but none of
 *     them establishes the truce the draft describes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const TMP = join(ROOT, "data", "tmp", "publish-ready");
const NODE = process.execPath;

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const NAMED = args.filter((a) => !a.startsWith("--"));

/** Markers a skeleton carries. Each one is a claim that the article is not finished. */
const SKELETON_MARKERS = [
  [/SAMPLE POST/i, "a sample-post comment"],
  [/skeleton placeholder/i, "a skeleton-placeholder comment"],
  [/ILLUSTRATIVE/i, "a source line that calls the figure illustrative"],
  [/placeholder figure/i, "a source line that calls the figure a placeholder"],
  [/no real panel behind it/i, "a source line admitting no underlying panel"],
  [/Figures are illustrative/i, "a note that the figures are illustrative"],
  [/replace before launch/i, "an instruction to replace before launch"],
];

/** Section 5.4: no first-person experience, because there is no reviewer to catch an invented one. */
const FIRST_PERSON = [
  [/\bI moved\b/i, "a first-person business decision"],
  [/\bI bought\b/i, "a first-person purchase"],
  [/\bI paid\b/i, "a first-person payment"],
  [/\bmy (?:inventory|supplier|order|margin|write-downs?)\b/i, "a first-person possession"],
  [/\bour panel\b/i, "a proprietary panel"],
  [/\bin our (?:data|sample|panel)\b/i, "proprietary data"],
];

function readDrafts() {
  const out = [];
  for (const f of readdirSync(BLOG).filter((x) => x.endsWith(".md"))) {
    const slug = f.replace(/\.md$/, "");
    if (NAMED.length && !NAMED.includes(slug)) continue;
    const t = readFileSync(join(BLOG, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? "";
    const isDraft = /^draft:\s*true/m.test(fm);
    if (!ALL && !isDraft) continue;
    out.push({ slug, file: f, text: t, isDraft, fm });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

const drafts = readDrafts();
if (!drafts.length) {
  console.log("  no drafts matched.");
  process.exit(0);
}

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

console.log(`PUBLISH-READINESS — ${drafts.length} draft(s)\n${"=".repeat(88)}`);

const summary = [];
for (const d of drafts) {
  console.log(`\n${"█".repeat(3)} ${d.slug}`);

  /* 1. Skeleton markers. */
  const markers = [];
  for (const [re, what] of SKELETON_MARKERS) if (re.test(d.text)) markers.push(what);
  const fp = [];
  for (const [re, what] of FIRST_PERSON) if (re.test(d.text)) fp.push(what);
  console.log(`  skeleton markers : ${markers.length}${markers.length ? ` — ${markers.join("; ")}` : ""}`);
  console.log(`  first-person     : ${fp.length}${fp.length ? ` — ${fp.join("; ")}` : ""}`);

  /* 2. Structural: run the article validator against a copy with the flag flipped. */
  const candidate = join(TMP, d.file);
  const flipped = d.text.replace(/^draft:\s*true\s*$/m, "draft: false");
  writeFileSync(candidate, flipped, "utf8");

  let qaOut = "";
  let qaOk = false;
  try {
    qaOut = execFileSync(NODE, [join(ROOT, "tools", "qa-check.mjs"), candidate], { encoding: "utf8", timeout: 120000 });
    qaOk = true;
  } catch (e) {
    qaOut = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const verdict = /RESULT:\s*(PASS|BLOCKED)/.exec(qaOut)?.[1] ?? "(no verdict)";
  const blocks = [...qaOut.matchAll(/BLOCK\s+([^\n]{0,90})/g)].map((m) => m[1].trim());
  const warns = [...qaOut.matchAll(/warn\s+([^\n]{0,90})/g)].map((m) => m[1].trim());
  console.log(`  qa-check         : ${verdict}  (${blocks.length} block, ${warns.length} warn)`);
  for (const b of blocks.slice(0, 6)) console.log(`      BLOCK ${b}`);

  /* 3. Counts that the reader of this report needs. */
  const body = flipped.slice(flipped.indexOf("\n---", 4) + 5);
  const words = body.split(/\s+/).filter(Boolean).length;
  const figs = (d.fm.match(/^ {2}- value:/gm) ?? []).length;
  const srcs = (d.fm.match(/^ {2}- "/gm) ?? []).length;
  const links = (d.text.match(/\]\(\/blog\//g) ?? []).length;
  const desc = /^description:\s*"([\s\S]*?)"\s*$/m.exec(d.text)?.[1]?.length ?? 0;
  console.log(`  words            : ${words}`);
  console.log(`  figures / sources: ${figs} / ${srcs}`);
  console.log(`  internal links   : ${links}`);
  console.log(`  description      : ${desc}/300`);

  const ready = markers.length === 0 && fp.length === 0 && verdict === "PASS";
  console.log(`  → ${ready ? "PUBLISH-READY" : "NOT READY"}`);
  summary.push({ slug: d.slug, ready, markers: markers.length, firstPerson: fp.length, verdict, blocks: blocks.length, words, figs, srcs, links });
}

/* Leave nothing behind: the copies are only for the validators. */
rmSync(TMP, { recursive: true, force: true });

console.log(`\n\n${"=".repeat(88)}\nSUMMARY\n`);
const ready = summary.filter((s) => s.ready);
console.log(`  ready     : ${ready.length} of ${summary.length}`);
for (const s of summary) {
  const flags = [];
  if (s.markers) flags.push(`${s.markers} skeleton marker(s)`);
  if (s.firstPerson) flags.push(`${s.firstPerson} first-person claim(s)`);
  if (s.verdict !== "PASS") flags.push(`${s.blocks} gate block(s)`);
  console.log(`    ${s.ready ? "READY    " : "NOT READY"}  ${s.slug}`);
  console.log(`               ${s.words} words, ${s.figs} figures, ${s.srcs} sources, ${s.links} internal links`);
  if (flags.length) console.log(`               blockers: ${flags.join(", ")}`);
}
process.exit(ready.length === summary.length ? 0 : 1);
