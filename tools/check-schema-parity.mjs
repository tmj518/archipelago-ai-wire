/**
 * Prove that the constraint list and the content schema agree.
 *
 * `src/lib/schema-rules.mjs` states the frontmatter constraints so the writer's prompt, the pre-build
 * validator and this check all read one list. A list that nothing verifies is how the last two failures
 * happened: three text limits were enforced while seventeen fields existed, and a draft whose `stakes`
 * was "high" passed every check and failed the build.
 *
 * So both sides are read as text and compared. Text, not execution, because the schema is a TypeScript
 * module that imports Astro and cannot be loaded from a plain Node script without a build.
 *
 * It compares three things and each has caught or would have caught a real defect:
 *
 *   text maxima      the schema's `.max(n)` against TEXT_LIMITS. A field added to the schema with a
 *                    limit and not added here is reported, which is the `stakes` failure one level up.
 *   enum members     the schema's `z.enum([...])` against ENUMS. This is the `stakes` failure exactly.
 *   required fields  fields with no `.optional()` and no `.default()` against REQUIRED. A required field
 *                    that the writer is not told about can be omitted legally from the model's point of
 *                    view and illegally from the build's.
 *
 * It deliberately does not try to check everything Zod can express. It checks the constraint kinds that
 * have actually caused a failure here, and it says so, rather than implying a completeness it does not
 * have.
 *
 *   node tools/check-schema-parity.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "src", "content.config.ts");
const RULES = join(ROOT, "src", "lib", "schema-rules.mjs");

console.log("SCHEMA PARITY\n" + "=".repeat(78));

if (!existsSync(SCHEMA) || !existsSync(RULES)) {
  console.log("RESULT: FAIL - cannot read src/content.config.ts or src/lib/schema-rules.mjs");
  process.exit(1);
}

const schemaText = readFileSync(SCHEMA, "utf8");
const rulesText = readFileSync(RULES, "utf8");

/*
 * Only the blog collection's shape. The schema file holds one collection today, and restricting to the
 * z.object block keeps the revision sub-schema out of the comparison - it has its own fields and its own
 * rules, and folding them together would produce false mismatches.
 */
const schemaStart = schemaText.indexOf("schema: z.object({");
const schemaBody = schemaStart >= 0 ? schemaText.slice(schemaStart, schemaText.indexOf("\n});", schemaStart)) : "";

/** Parse the schema's top-level field declarations into { name, max, enumValues, optional, hasDefault }. */
function parseSchemaFields(body) {
  const fields = new Map();
  for (const line of body.split("\n")) {
    const m = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*):\s*z\./.exec(line);
    if (!m) continue;
    const name = m[1];
    const rest = line.slice(line.indexOf("z."));
    fields.set(name, {
      max: Number(/\.max\((\d+)\)/.exec(rest)?.[1] ?? NaN),
      enumValues: (() => {
        const e = /z\.enum\(\[([^\]]*)\]\)/.exec(rest);
        return e ? [...e[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
      })(),
      optional: /\.optional\(\)/.test(rest),
      hasDefault: /\.default\(/.test(rest),
    });
  }
  return fields;
}

/** Parse the rules file's exported objects. */
function parseRules(text) {
  const grab = (name) => {
    const i = text.indexOf(`export const ${name} = {`);
    if (i < 0) return null;
    let depth = 0;
    let j = text.indexOf("{", i);
    const start = j;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return text.slice(start, j + 1);
  };
  const textLimits = {};
  const tl = grab("TEXT_LIMITS");
  if (tl) {
    for (const m of tl.matchAll(/(\w+):\s*\{\s*max:\s*(\d+)/g)) textLimits[m[1]] = Number(m[2]);
  }
  const enums = {};
  const en = grab("ENUMS");
  if (en) {
    for (const m of en.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) enums[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  const required = (() => {
    const m = /export const REQUIRED = \[([^\]]*)\]/.exec(text);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  })();
  return { textLimits, enums, required };
}

const fields = parseSchemaFields(schemaBody);
const rules = parseRules(rulesText);
const problems = [];

if (!fields.size) problems.push("no fields could be parsed out of the schema - the parser is looking for the wrong shape");

/* --- text maxima: every schema max must be declared, with the same number --- */
for (const [name, f] of fields) {
  if (!Number.isFinite(f.max)) continue;
  const declared = rules.textLimits[name];
  if (declared == null) problems.push(`${name} has .max(${f.max}) in the schema and is absent from TEXT_LIMITS, so nothing checks it`);
  else if (declared !== f.max) problems.push(`${name}: schema says ${f.max}, TEXT_LIMITS says ${declared}`);
}
for (const name of Object.keys(rules.textLimits)) {
  if (!fields.has(name)) problems.push(`TEXT_LIMITS names ${name}, which is not a field in the schema`);
}

/* --- enums: the exact set, in the same order --- */
for (const [name, f] of fields) {
  if (!f.enumValues) continue;
  const declared = rules.enums[name];
  if (!declared) problems.push(`${name} is an enum in the schema (${f.enumValues.join(", ")}) and is absent from ENUMS, so nothing checks it`);
  else if (declared.join("|") !== f.enumValues.join("|")) {
    problems.push(`${name}: schema allows ${f.enumValues.join(", ")}, ENUMS allows ${declared.join(", ")}`);
  }
}

/* --- required fields: no .optional() and no .default() --- */
const schemaRequired = [...fields.entries()].filter(([, f]) => !f.optional && !f.hasDefault).map(([n]) => n);
for (const name of schemaRequired) {
  if (!rules.required.includes(name) && !(name in rules.textLimits) && !(name in rules.enums)) {
    problems.push(`${name} is required in the schema and is not named in REQUIRED, TEXT_LIMITS or ENUMS`);
  }
}

console.log(`  schema fields    : ${fields.size}`);
console.log(`  text limits      : ${Object.keys(rules.textLimits).length}`);
console.log(`  enums            : ${Object.keys(rules.enums).length}`);
console.log(`  required in schema: ${schemaRequired.length}`);
console.log("");

if (!problems.length) {
  console.log("RESULT: PASS - the constraint list and the content schema agree on every limit, enum and");
  console.log("                 required field that this check understands");
  process.exit(0);
}

console.log(`${problems.length} DISAGREEMENT(S) - the writer is being told something the build will reject:`);
for (const p of problems) console.log(`  ${p}`);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
