/**
 * Prove that the content schema, the constraint list and the vocabulary agree.
 *
 * `src/lib/schema-rules.mjs` states the frontmatter constraints so the writer's prompt, the pre-build
 * validator and this check all read one list. A list that nothing verifies is how the last two failures
 * happened: three text limits were enforced while seventeen fields existed, and a draft whose `stakes`
 * was "high" passed every check and failed the build.
 *
 * ## What changed on 2026-10-26, and why this file had to be rewritten
 *
 * The categories and audiences are no longer written out anywhere except `src/lib/taxonomy.json`. They
 * are derived:
 *
 *     src/content.config.ts   z.enum(taxonomy.categories.map(...))
 *     src/lib/schema-rules.mjs ENUMS = { category: CATEGORY_SLUGS, ... }
 *
 * The previous version of this check read both files as TEXT and compared the string literals inside
 * `z.enum(["a", "b"])` against `category: ["a", "b"]`. With derived values there is no literal to read,
 * so it would have compared two empty sets and printed PASS — a checker that silently checks nothing is
 * worse than no checker, because it is believed.
 *
 * So the check is now shaped around how the values are actually expressed:
 *
 *   derived wiring   the schema must reference the taxonomy for category and audience, and the rules
 *                    module must derive its ENUMS from the same module. A literal list reappearing in
 *                    either place is the failure this catches.
 *   literal leakage  any remaining `z.enum([...])` literal in the schema must be a subset of the
 *                    taxonomy's values. This is what would catch a stray old slug being added back.
 *   text maxima      unchanged: the schema's `.max(n)` against TEXT_LIMITS.
 *   required fields  unchanged: no `.optional()`, no `.default()`.
 *   prompt parity    the writer's prompt must not name a category or audience outside the taxonomy.
 *
 *   node tools/check-schema-parity.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TAXONOMY, CATEGORY_SLUGS, AUDIENCE_VALUES } from "../src/lib/taxonomy.mjs";
import { ENUMS, TEXT_LIMITS, REQUIRED } from "../src/lib/schema-rules.mjs";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "src", "content.config.ts");
const RULES = join(ROOT, "src", "lib", "schema-rules.mjs");
const PROMPT = join(ROOT, "src", "lib", "writer-prompt.mjs");

console.log("SCHEMA PARITY\n" + "=".repeat(78));

if (!existsSync(SCHEMA) || !existsSync(RULES)) {
  console.log("RESULT: FAIL - cannot read src/content.config.ts or src/lib/schema-rules.mjs");
  process.exit(1);
}

const schemaText = readFileSync(SCHEMA, "utf8");
const rulesText = readFileSync(RULES, "utf8");
const problems = [];

/* ── 1  derived wiring ───────────────────────────────────────────────────────────────────────── */

if (!/from\s+"\.\/lib\/taxonomy\.json"/.test(schemaText)) {
  problems.push("src/content.config.ts no longer imports taxonomy.json, so its enums are free to drift");
}
for (const field of ["category", "audience"]) {
  const line = new RegExp(`^\\s*${field}:\\s*z\\.enum\\((.+)\\)`, "m").exec(schemaText)?.[1] ?? "";
  if (!line) problems.push(`schema declares no ${field} enum`);
  else if (/^\[/.test(line)) problems.push(`schema declares ${field} as a literal list again - it must derive from taxonomy.json`);
}
if (!/from\s+"\.\/taxonomy\.mjs"/.test(rulesText)) {
  problems.push("src/lib/schema-rules.mjs does not import taxonomy.mjs");
}
for (const key of ["category", "audience", "stakes", "priority"]) {
  if (!new RegExp(`${key}:\\s*[A-Z_]+`).test(rulesText)) {
    problems.push(`ENUMS.${key} is not derived from a constant - a literal list is back`);
  }
}

/* ── 2  literal leakage ──────────────────────────────────────────────────────────────────────── */

const KNOWN = new Set([
  ...CATEGORY_SLUGS,
  ...AUDIENCE_VALUES,
  ...TAXONOMY.stakes,
  ...TAXONOMY.priority,
  ...TAXONOMY.informationGain,
  ...TAXONOMY.searchIntent,
  ...TAXONOMY.guideTopics.map((t) => t.slug),
]);
const schemaStart = schemaText.indexOf("schema: z.object({");
const schemaBody = schemaStart >= 0 ? schemaText.slice(schemaStart, schemaText.indexOf("\n});", schemaStart)) : "";
if (!schemaBody) problems.push("could not locate the blog schema body - the parser is looking for the wrong shape");

for (const m of schemaBody.matchAll(/z\.enum\(\[([^\]]*)\]\)/g)) {
  const values = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const stray = values.filter((v) => !KNOWN.has(v));
  if (stray.length) problems.push(`a literal enum in the schema carries values the taxonomy does not have: ${stray.join(", ")}`);
}

/* ── 3  the runtime lists agree with the taxonomy ───────────────────────────────────────────── */

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
if (!same(ENUMS.category ?? [], CATEGORY_SLUGS)) {
  problems.push(`ENUMS.category and the taxonomy disagree: ${(ENUMS.category ?? []).join(", ")} vs ${CATEGORY_SLUGS.join(", ")}`);
}
if (!same(ENUMS.audience ?? [], AUDIENCE_VALUES)) {
  problems.push(`ENUMS.audience and the taxonomy disagree: ${(ENUMS.audience ?? []).join(", ")} vs ${AUDIENCE_VALUES.join(", ")}`);
}
if (!same(ENUMS.stakes ?? [], TAXONOMY.stakes)) problems.push("ENUMS.stakes and the taxonomy disagree");
if (!same(ENUMS.priority ?? [], TAXONOMY.priority)) problems.push("ENUMS.priority and the taxonomy disagree");

/* ── 4  text maxima ─────────────────────────────────────────────────────────────────────────── */

const fields = new Map();
for (const line of schemaBody.split("\n")) {
  const m = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*):\s*z\./.exec(line);
  if (!m) continue;
  fields.set(m[1], { max: Number(/\.max\((\d+)\)/.exec(line)?.[1] ?? NaN), optional: /\.optional\(\)/.test(line), hasDefault: /\.default\(/.test(line) });
}
if (!fields.size) problems.push("no fields could be parsed out of the schema");

for (const [name, f] of fields) {
  if (!Number.isFinite(f.max)) continue;
  const declared = TEXT_LIMITS[name]?.max;
  if (declared == null) problems.push(`${name} has .max(${f.max}) in the schema and is absent from TEXT_LIMITS, so nothing checks it`);
  else if (declared !== f.max) problems.push(`${name}: schema says ${f.max}, TEXT_LIMITS says ${declared}`);
}
for (const name of Object.keys(TEXT_LIMITS)) {
  if (!fields.has(name)) problems.push(`TEXT_LIMITS names ${name}, which is not a field in the schema`);
}

/* ── 5  required fields ─────────────────────────────────────────────────────────────────────── */

const schemaRequired = [...fields.entries()].filter(([, f]) => !f.optional && !f.hasDefault).map(([n]) => n);
for (const name of schemaRequired) {
  if (!REQUIRED.includes(name) && !(name in TEXT_LIMITS) && !(name in ENUMS)) {
    problems.push(`${name} is required in the schema and is not named in REQUIRED, TEXT_LIMITS or ENUMS`);
  }
}

/* ── 6  the prompt names nothing the taxonomy does not have ─────────────────────────────────── */

if (existsSync(PROMPT)) {
  const promptText = readFileSync(PROMPT, "utf8");
  const STALE = ["trade-policy", "platforms", "supply-chain", "sourcing", "logistics", "old-china-hand", "platform-seller"];
  const found = STALE.filter((s) => new RegExp(`\\b${s.replace(/-/g, "[- ]")}\\b`).test(promptText));
  if (found.length) problems.push(`the writer's prompt still names retired values: ${found.join(", ")}`);
} else {
  problems.push("src/lib/writer-prompt.mjs is missing - the writer's instructions cannot be checked");
}

console.log(`  schema fields     : ${fields.size}`);
console.log(`  taxonomy categories: ${CATEGORY_SLUGS.length}  audiences: ${AUDIENCE_VALUES.length}`);
console.log(`  derived ENUMS     : ${Object.keys(ENUMS).length}`);
console.log(`  text limits       : ${Object.keys(TEXT_LIMITS).length}`);
console.log(`  required in schema: ${schemaRequired.length}`);
console.log("");

if (!problems.length) {
  console.log("RESULT: PASS - the schema derives from the taxonomy, the constraint list agrees with the");
  console.log("                 schema, and the writer's prompt names no retired value");
  process.exit(0);
}

console.log(`${problems.length} DISAGREEMENT(S) - the writer is being told something the build will reject:`);
for (const p of problems) console.log(`  ${p}`);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
