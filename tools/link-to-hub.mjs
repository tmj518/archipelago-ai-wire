#!/usr/bin/env node
/**
 * Point published articles at a hub page.
 *
 *   node tools/link-to-hub.mjs --target=/calculator/ --anchor="the landed cost calculator"
 *   node tools/link-to-hub.mjs --target=/calculator/ --anchor="..." --write
 *
 * ## Why
 *
 * On 2026-10-26 Search Console showed "landed cost calculator" at position 89 - one impression in
 * ninety days, for the name of the page. The page was fine; nothing pointed at it. Sixty published
 * articles, zero of them linking to the calculator, and a page with no internal links is a page a
 * crawler has no reason to rank.
 *
 * ## The shape it writes
 *
 * The same blockquote that backfill-links.mjs uses for article-to-article links, in the same place:
 *
 *     > Work it out: [the landed cost calculator](/calculator/)
 *
 * immediately before `## For you`, falling back to `## FAQ`. A link after the conclusion is in the
 * least-read part of an article, and putting it in the body rather than at the foot means it counts as
 * a prose link rather than as a footer block.
 *
 * ## What it refuses
 *
 * - A file that already links to the target.
 * - A file the target already links to. Two-way links are a closed loop that passes no weight
 *   anywhere else, and link-check reports reciprocal pairs as a failure.
 * - A draft, or a file with neither `## For you` nor `## FAQ` - it does not guess where the sentence
 *   belongs.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const target = flag("target");
const anchor = flag("anchor");
const lead = flag("lead", "Work it out");
const write = args.includes("--write");

if (!target || !anchor) {
  console.error('usage: node tools/link-to-hub.mjs --target=/calculator/ --anchor="the landed cost calculator" [--lead="Work it out"] [--write]');
  process.exit(2);
}

/* The page that receives the links may itself link out to articles. Those must not link back. */
const TARGET_SOURCE = Object.fromEntries([
  ["/calculator/", "src/pages/calculator.astro"],
])[target];
const targetLinksTo = new Set();
if (TARGET_SOURCE && existsSync(join(ROOT, TARGET_SOURCE))) {
  const src = readFileSync(join(ROOT, TARGET_SOURCE), "utf8");
  for (const m of src.matchAll(/\/blog\/([a-z0-9-]+)\//g)) targetLinksTo.add(m[1]);
}

const files = readdirSync(BLOG).filter((f) => f.endsWith(".md"));
const planned = [];
let skippedDraft = 0;
let skippedHas = 0;
let skippedReciprocal = 0;
let skippedNoAnchor = 0;

for (const f of files) {
  const slug = f.replace(/\.md$/, "");
  const path = join(BLOG, f);
  const raw = readFileSync(path, "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
  if (/^draft:\s*true/m.test(fm)) {
    skippedDraft++;
    continue;
  }
  if (raw.includes(`](${target})`) || raw.includes(`(${target}#`)) {
    skippedHas++;
    continue;
  }
  if (targetLinksTo.has(slug)) {
    skippedReciprocal++;
    continue;
  }
  const idx = raw.includes("\n## For you") ? raw.indexOf("\n## For you") : raw.includes("\n## FAQ") ? raw.indexOf("\n## FAQ") : -1;
  if (idx < 0) {
    skippedNoAnchor++;
    continue;
  }
  const line = `> ${lead}: [${anchor}](${target})\n\n`;
  planned.push({ slug, path, next: raw.slice(0, idx + 1) + line + raw.slice(idx + 1) });
}

console.log(`LINK TO HUB  ${target}`);
console.log("=".repeat(70));
console.log(`  candidates : ${files.length}`);
console.log(`  would link : ${planned.length}`);
console.log(`  already    : ${skippedHas}`);
console.log(`  reciprocal : ${skippedReciprocal}  (the target already links to these)`);
console.log(`  draft      : ${skippedDraft}`);
console.log(`  no anchor  : ${skippedNoAnchor}  (no "## For you" or "## FAQ")`);
if (planned.length) {
  console.log("\n  first five:");
  for (const p of planned.slice(0, 5)) console.log(`    ${p.slug}`);
}

if (!write) {
  console.log("\n  dry run - add --write to apply");
  process.exit(0);
}

for (const p of planned) writeFileSync(p.path, p.next, "utf8");
console.log(`\n  wrote ${planned.length} file(s)`);
