#!/usr/bin/env node
/**
 * Every blocking rule must carry guidance.
 *
 *   node tools/check-rule-guide.mjs
 *
 * ## Why this is a check and not a convention
 *
 * The operator's requirement was that a BLOCK must tell the creator why, what structure it wants, and how to
 * change the draft to pass. Twenty-one blocking rules satisfy that today because the guidance was written for all
 * of them in one sitting.
 *
 * The first rule added after this commit would not, and the failure would be silent: the check would block, the
 * writer would get `figures >= 5 · only 2 figures`, and nobody would notice the guidance was missing until
 * somebody watched a revision round fail. That is exactly the shape of every other defect this repository has
 * had - the machine keeps working and loses one property nobody was measuring.
 *
 * So the coverage is measured. It reads the rule names out of qa-check.mjs rather than from a list, because a
 * list is a second thing to keep in sync and this whole file exists because second lists drift.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guidedRules } from "../src/lib/rule-guide.mjs";

const ROOT = process.cwd();
const QA = join(ROOT, "tools", "qa-check.mjs");

const src = readFileSync(QA, "utf8");

/*
 * Rule names as they are passed to add("block", ...). Two spellings are used in the file - a template literal and
 * a plain string - and both are collected. Interpolated names are skipped: they cannot be keyed in a table, and
 * guideFor() falls back to a prefix match for the one that interpolates (the prose tier).
 */
const rules = new Set();
for (const m of src.matchAll(/add\(\s*"block"\s*,\s*`([^`]+)`/g)) rules.add(m[1]);
for (const m of src.matchAll(/add\(\s*"block"\s*,\s*"([^"]+)"/g)) rules.add(m[1]);

const interpolated = [...rules].filter((r) => r.includes("${"));
const literal = [...rules].filter((r) => !r.includes("${"));
const guided = new Set(guidedRules());

const missing = literal.filter((r) => !guided.has(r));
const unused = [...guided].filter((g) => !literal.includes(g) && !/^prose \d+-\d+/.test(g));

console.log("RULE GUIDANCE COVERAGE\n" + "=".repeat(78));
console.log(`  blocking rules found : ${rules.size} (${interpolated.length} interpolated)`);
console.log(`  with guidance        : ${literal.length - missing.length}/${literal.length}`);
console.log("");

if (interpolated.length) {
  console.log("  interpolated names are matched by prefix in guideFor():");
  for (const r of interpolated) console.log("    " + r);
  console.log("");
}

if (missing.length) {
  console.log(`${missing.length} RULE(S) WITH NO GUIDANCE:`);
  for (const r of missing) console.log("  " + r);
  console.log("");
  console.log("  Add an entry to src/lib/rule-guide.mjs with want, how and example. A block that only says");
  console.log("  what is wrong leaves the writer to infer the structure, and inferring a structure from an error");
  console.log("  message is how revision rounds fix one thing and break another.");
  console.log("");
  console.log("RESULT: FAIL");
  process.exit(1);
}

if (unused.length) {
  console.log(`  note: ${unused.length} guidance entries match no rule (renamed or removed):`);
  for (const r of unused) console.log("    " + r);
  console.log("");
}

console.log(`RESULT: PASS - all ${literal.length} blocking rules explain what they want and how to satisfy it`);
process.exit(0);
