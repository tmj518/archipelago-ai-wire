#!/usr/bin/env node
/**
 * MASTER_PROMPT.md must agree with the code.
 *
 *   node tools/check-master-prompt.mjs
 *
 * ## Why this exists
 *
 * MASTER_PROMPT.md is now the only instruction file a run reads. That makes it load-bearing in a way a document
 * usually is not: if it says 1,500-2,000 words and the gate blocks at 1,000-2,500, the writer is told one thing and
 * measured by another. The failure is silent - the article is written to the stated target, the gate passes it,
 * and nobody notices the two numbers were never the same.
 *
 * This repository has already paid for that lesson twice: the schema rules lived in two places and disagreed, and
 * the NO-KEYS message named variables the code did not read. Both were fixed by deriving one side from the other,
 * and where that is impossible, by comparing them on every build. This is the second kind.
 *
 * ## What it compares
 *
 *   the word targets and the hard band, against src/lib/prose.mjs
 *   the ten section headings, against the ones qa-check requires
 *   the figure count, against qa-check's figure rule
 *
 * It reads both files as text. Parsing them would need a parser per file and would break on the next formatting
 * change; the numbers are a short list and a regex on a table row is enough to catch a disagreement.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SECTIONS, CATEGORY_SLUGS, AUDIENCE_VALUES, GUIDE_TOPIC_SLUGS } from "../src/lib/taxonomy.mjs";

const ROOT = process.cwd();
const MP = join(ROOT, "MASTER_PROMPT.md");
const PROSE = join(ROOT, "src", "lib", "prose.mjs");
const QA = join(ROOT, "tools", "qa-check.mjs");

const problems = [];

if (!existsSync(MP)) {
  console.log("  MASTER_PROMPT.md is missing. It is the only instruction file a run reads.");
  process.exit(1);
}

const mp = readFileSync(MP, "utf8");
const prose = readFileSync(PROSE, "utf8");
const qa = readFileSync(QA, "utf8");

console.log("MASTER PROMPT PARITY\n" + "=".repeat(78));

/* ── 1  the word numbers ────────────────────────────────────────────────────────────────────────── */
const tiers = {};
for (const m of prose.matchAll(/(withCostTable|withoutCostTable):\s*\{\s*min:\s*(\d+),\s*targetLow:\s*(\d+),\s*targetHigh:\s*(\d+),\s*max:\s*(\d+)/g)) {
  tiers[m[1]] = { min: Number(m[2]), targetLow: Number(m[3]), targetHigh: Number(m[4]), max: Number(m[5]) };
}

const rows = [...mp.matchAll(/^\|\s*(with a cost table|without a cost table)\s*\|\s*([\d,–\- ]+)\|\s*([\d,–\- ]+)\|/gm)];
if (rows.length < 2) {
  problems.push("MASTER_PROMPT.md has no length table with both tiers - a writer cannot be told a target it does not state");
} else {
  for (const [, label, targetCell, bandCell] of rows) {
    const key = /with a cost/.test(label) ? "withCostTable" : "withoutCostTable";
    const t = tiers[key];
    if (!t) {
      problems.push(`src/lib/prose.mjs has no ${key}, but MASTER_PROMPT.md describes it`);
      continue;
    }
    const nums = (s) => (s.match(/\d[\d,]*/g) ?? []).map((x) => Number(x.replace(/,/g, "")));
    const wantTarget = [t.targetLow, t.targetHigh];
    const wantBand = [t.min, t.max];
    const gotTarget = nums(targetCell);
    const gotBand = nums(bandCell);

    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (!same(gotTarget, wantTarget)) {
      problems.push(`${label}: MASTER_PROMPT says target ${gotTarget.join("-")}, src/lib/prose.mjs says ${wantTarget.join("-")}`);
    }
    if (!same(gotBand, wantBand)) {
      problems.push(`${label}: MASTER_PROMPT says band ${gotBand.join("-")}, src/lib/prose.mjs says ${wantBand.join("-")}`);
    }
    console.log(`  ${same(gotTarget, wantTarget) && same(gotBand, wantBand) ? "ok  " : "FAIL"} ${label.padEnd(20)} target ${wantTarget.join("-")}  band ${wantBand.join("-")}`);
  }
}

/* ── 2  the section headings ───────────────────────────────────────────────────────────────────── */
/*
 * The required list comes from src/lib/taxonomy.json, not from parsing qa-check.mjs.
 *
 * It used to be scraped out of the gate's source with a regex. That worked until 2026-10-26, when
 * the list moved to the shared taxonomy file and the scrape silently found nothing - which this
 * check reports as a failure rather than a pass, thankfully, but the dependency was backwards:
 * the vocabulary should not be discovered by reading an implementation file.
 */
const required = SECTIONS;

if (!required.length) {
  problems.push("src/lib/taxonomy.json defines no sections - this check would pass while comparing nothing");
} else {
  const missing = required.filter((h) => !mp.includes(h));
  if (missing.length) {
    problems.push(`MASTER_PROMPT.md does not name: ${missing.join(", ")} - the writer would not know they are required`);
  }
  console.log(`  ${missing.length ? "FAIL" : "ok  "} sections             ${required.length} required, ${required.length - missing.length} named in MASTER_PROMPT.md`);
}

/* ── 3  the figure count ────────────────────────────────────────────────────────────────────────── */
/*
 * The count lives in src/lib/figure-limits.mjs, in one place, because four things read it. Grepping qa-check for a
 * literal five stopped working the moment the rule was expressed as a constant - which is the point of the constant.
 */
const limits = readFileSync(join(ROOT, "src", "lib", "figure-limits.mjs"), "utf8");
const figs = /MIN_SUBSTANTIVE\s*=\s*(\d+)/.exec(limits)?.[1];
if (!figs) {
  problems.push("cannot find MIN_SUBSTANTIVE in src/lib/figure-limits.mjs");
} else {
  const word = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" }[figs] ?? figs;
  const stated = new RegExp(`(at least|\\b${word}\\b|\\b${figs}\\b).{0,60}(substantive )?figure`, "i").test(mp);
  /* And it must say what does not count, or the writer will read "two" as a lower bar for the same old records. */
  const excludes = /does not count|not a figure|publication date|document number/i.test(mp);
  if (!stated) problems.push(`the gate requires ${figs} substantive figures and MASTER_PROMPT.md does not state that number`);
  if (!excludes) problems.push("MASTER_PROMPT.md does not say that dates and document numbers are not figures");
  console.log(`  ${stated && excludes ? "ok  " : "FAIL"} figures              ${figs} required, stated, and the exclusions named`);
}

/* ── 4  the vocabulary ─────────────────────────────────────────────────────────────────────────── */
/*
 * The category list in MASTER_PROMPT.md §7 had no check at all before this, which is how it ended
 * up describing five categories the code no longer used. A writer told the wrong slug produces a
 * draft the build rejects - the most expensive possible way to learn a list changed.
 *
 * Two directions, because they fail differently:
 *   a stale slug still in the prompt   -> every draft is rejected by the schema
 *   a new slug missing from the prompt -> the writer never uses that section
 */
const STALE_VOCABULARY = [
  "trade-policy", "platforms", "supply-chain", "sourcing", "logistics",
  "old-china-hand", "platform-seller", "relocating", "visitor",
];
const staleFound = STALE_VOCABULARY.filter((v) => new RegExp(`\\b${v.replace(/[-]/g, "[- ]")}\\b`).test(mp));
if (staleFound.length) {
  problems.push(`MASTER_PROMPT.md still names retired values: ${staleFound.join(", ")} - the schema rejects them`);
}

const missingCats = CATEGORY_SLUGS.filter((c) => !mp.includes(c));
const missingAud = AUDIENCE_VALUES.filter((a) => !mp.includes(a));
const missingTopics = GUIDE_TOPIC_SLUGS.filter((t) => !mp.includes(t));
if (missingCats.length) problems.push(`MASTER_PROMPT.md does not name categor${missingCats.length > 1 ? "ies" : "y"}: ${missingCats.join(", ")}`);
if (missingAud.length) problems.push(`MASTER_PROMPT.md does not name audience${missingAud.length > 1 ? "s" : ""}: ${missingAud.join(", ")}`);
if (missingTopics.length) problems.push(`MASTER_PROMPT.md does not name guide topic${missingTopics.length > 1 ? "s" : ""}: ${missingTopics.join(", ")}`);
console.log(
  `  ${staleFound.length || missingCats.length || missingAud.length || missingTopics.length ? "FAIL" : "ok  "} vocabulary           ` +
    `${CATEGORY_SLUGS.length} categories, ${AUDIENCE_VALUES.length} audiences, ${GUIDE_TOPIC_SLUGS.length} guide topics in sync`,
);

console.log("");
if (!problems.length) {
  console.log("RESULT: PASS - MASTER_PROMPT.md and the code state the same rules");
  process.exit(0);
}
console.log(`${problems.length} DISAGREEMENT(S):`);
for (const p of problems) console.log("  " + p);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
