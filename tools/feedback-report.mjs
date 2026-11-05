#!/usr/bin/env node
/**
 * What keeps being rejected, and how many attempts it costs.
 *
 * The retry loop already hands objections back to the writer, but nothing counted them: the same rule
 * could cost three attempts on every article for a week and the only trace was a line in a run log
 * nobody reads twice. Every rejection now writes an entry to data/feedback/<slug>.json, and this turns
 * those entries into the two numbers that decide what to fix first - which rule fires most often, and
 * how many attempts an article takes before it is accepted.
 *
 *   node tools/feedback-report.mjs
 *   node tools/feedback-report.mjs --json
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const dir = join(ROOT, "data", "feedback");
const asJson = process.argv.includes("--json");

if (!existsSync(dir)) {
  if (asJson) console.log(JSON.stringify({ runs: 0, byRule: {}, attempts: {} }, null, 2));
  else console.log("no feedback recorded yet - nothing has been rejected since this was added");
  process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "summary.json");
const entries = [];
for (const f of files) {
  try {
    const rows = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const r of Array.isArray(rows) ? rows : []) entries.push({ slug: f.replace(/\.json$/, ""), ...r });
  } catch {
    /* a corrupt feedback file must not stop the report */
  }
}

const byRule = {};
const attempts = {};
const resolved = { true: 0, false: 0 };
for (const e of entries) {
  const rule = String(e.rule ?? "unknown");
  byRule[rule] = (byRule[rule] ?? 0) + 1;
  const slug = String(e.slug ?? "unknown");
  attempts[slug] = (attempts[slug] ?? 0) + 1;
  if (e.resolved === true) resolved.true++;
  else if (e.resolved === false) resolved.false++;
}

const slugs = Object.keys(attempts);
const avg = slugs.length ? (entries.length / slugs.length).toFixed(2) : "0.00";
const summary = {
  generatedAt: new Date().toISOString(),
  rejections: entries.length,
  slugs: slugs.length,
  averageAttemptsPerSlug: Number(avg),
  resolvedOnRetry: resolved.true,
  stillFailing: resolved.false,
  byRule: Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1])),
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("FEEDBACK REPORT\n" + "=".repeat(72));
  console.log(`  rejections            : ${summary.rejections}`);
  console.log(`  articles touched      : ${summary.slugs}`);
  console.log(`  attempts per article  : ${summary.averageAttemptsPerSlug}`);
  console.log(`  fixed on a retry      : ${summary.resolvedOnRetry}`);
  console.log(`  never fixed           : ${summary.stillFailing}`);
  console.log("");
  console.log("  most frequent rules");
  const rules = Object.entries(summary.byRule);
  if (!rules.length) console.log("    (none)");
  for (const [rule, n] of rules.slice(0, 10)) console.log(`    ${String(n).padStart(4)}  ${rule}`);
}
