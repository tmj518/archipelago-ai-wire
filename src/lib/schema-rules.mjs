/**
 * The content schema's constraints as plain JavaScript, so every runtime can read them.
 *
 * This was a TypeScript file and tools/cloud-executor.mjs imported it directly, using Node's type
 * stripping. That feature was experimental until 23.6 and the writer therefore depended on an
 * experimental loader; on the runner the import failed and the run reported "the writer produced
 * nothing" with no reason attached.
 *
 * The list lives here in JavaScript. src/lib/schema-rules.ts re-exports it for the Astro side, so both
 * read one file. tools/check-schema-parity.mjs proves this list and src/content.config.ts still agree.
 */
import { TAXONOMY, CATEGORY_SLUGS, AUDIENCE_VALUES } from "./taxonomy.mjs";

/**
 * The content schema's constraints, in one place, for everything that has to agree with it.
 *
 * ## Why this file exists
 *
 * The constraints were described in three places that could not check each other: the Zod schema, the
 * instructions in the writer's prompt, and a hand-written list in `tools/cloud-executor.mjs` that
 * validated the frontmatter before the build could. The third was written from the first two by reading
 * them, which is the failure mode this whole file exists to remove.
 *
 * It went wrong twice in one day and both times the same way:
 *
 *   The subtitle limit was enforced, and `stakes` was not - three fields were listed and seventeen exist.
 *   A draft whose `stakes` was "high" passed every check, entered the collection, and failed the *build*
 *   with `Invalid option: expected one of "priced"|"directional"`. The reviewer then reported "no
 *   parseable verdict" because it had been handed a file that could not compile.
 *
 *   Before that, the subtitle limit itself was written to exactly 160 with no margin, so an article that
 *   was legal when generated became illegal when revised.
 *
 * ## What is enforceable and what is not
 *
 * A constraints list can only be checked against the schema if something does the checking, so
 * `tools/check-schema-parity.mjs` reads both and fails when they disagree - a new field in the schema
 * with a constraint, or a value here that the schema would reject. That check is in preflight, so this
 * file cannot silently drift again, which is the only property that makes it worth having.
 *
 * `max` is not the enforced limit. A value is written to `target` (a margin below `max`) so that a later
 * revision can lengthen a sentence by a word without breaking the build. The margin is deliberate and
 * asymmetric: being three characters under a limit costs nothing, and being three over costs a build.
 */

/** Text fields with a maximum length. `target` is what the writer is asked for, `max` is the schema's. */
export const TEXT_LIMITS = {
  title: { max: 120, target: 110 },
  subtitle: { max: 160, target: 147 },
  description: { max: 300, target: 275 },
};

/**
 * Fields whose value must be one of a fixed set.
 *
 * `category`, `audience`, `stakes` and `priority` are DERIVED from src/lib/taxonomy.json, not written
 * out here. They were written out here, as a fifth copy of the vocabulary, and survived the
 * 2026-10-26 repositioning intact: the file went on telling the A-line writer that `trade-policy` and
 * `importer` were the legal values for a site that had replaced both. Keeping them in a constant is
 * how a copy stays alive long after the thing it copied has moved.
 */
export const ENUMS = {
  stakes: TAXONOMY.stakes,
  priority: TAXONOMY.priority,
  category: CATEGORY_SLUGS,
  audience: AUDIENCE_VALUES,
};

/** Fields the schema requires. A missing one fails the build, not just the article. */
export const REQUIRED = ["title", "description", "publishDate", "category", "stakes"];

/**
 * Named nested objects. The schema has repeated shapes - figures and revisions - and a validator that
 * only sees the top level would accept a figure with no source.
 */
export const NESTED = {
  figures: ["value", "period", "source", "retrieved"],
};

/**
 * The instruction text for the writer, generated from the lists above.
 *
 * It is generated rather than written so the prompt cannot disagree with the validator. The previous
 * prompt stated three limits and the validator checked three limits, and both were incomplete in the
 * same way - which reads as consistency and is not.
 */
export function limitsForPrompt() {
  const lines = ["Frontmatter fields, and the limits that break the build when exceeded:"];
  for (const [f, { max, target }] of Object.entries(TEXT_LIMITS)) {
    lines.push(`  ${f.padEnd(14)} at most ${max} characters. Aim for ${target} or fewer.`);
  }
  lines.push("");
  lines.push("Fields whose value must be exactly one of these words. A different word fails the build:");
  for (const [f, values] of Object.entries(ENUMS)) {
    lines.push(`  ${f.padEnd(14)} ${values.map((v) => `"${v}"`).join(" | ")}`);
  }
  lines.push("");
  lines.push(`Required: ${REQUIRED.join(", ")}.`);
  lines.push("");
  lines.push("Character counts are real counts, not words. A subtitle of 147 is safe; 161 stops the whole");
  lines.push("site from building, not just this article.");
  return lines.join("\n");
}

/**
 * Check a parsed frontmatter object. Returns a list of human-readable violations.
 *
 * Takes an object rather than the file text so that the caller decides how to parse, and so this can be
 * tested without a file. It checks only what the schema would reject or what the limits describe; body
 * structure is the gate's business, not this file's.
 */
export function violationsOf(fields) {
  const out = [];
  if (!fields || typeof fields !== "object") return ["no frontmatter could be parsed"];

  for (const f of REQUIRED) {
    const v = fields[f];
    if (v == null || String(v).trim() === "") out.push(`${f} is required and is missing or empty`);
  }

  for (const [f, { max }] of Object.entries(TEXT_LIMITS)) {
    const v = fields[f];
    if (v == null) continue;
    /* Code points, because Zod counts characters and String.length counts two for a Chinese character. */
    const n = [...String(v)].length;
    if (n > max) out.push(`${f} is ${n} characters and the schema allows ${max}`);
  }

  for (const [f, values] of Object.entries(ENUMS)) {
    const v = fields[f];
    if (v == null || String(v).trim() === "") continue; /* a default applies, or REQUIRED already flagged it */
    const clean = String(v).trim().replace(/^["']|["']$/g, "");
    if (!values.includes(clean)) {
      out.push(`${f} is "${clean}" and the schema allows only ${values.map((x) => `"${x}"`).join(", ")}`);
    }
  }

  return out;
}

/**
 * Violations that a rewrite of the field can fix, paired with what to ask for.
 *
 * A wrong enum value and an over-long string are both mechanical. A missing required field is not: it
 * means the article does not have the information, and asking the model to invent a `publishDate` is
 * asking it to fabricate. So the two are separated here rather than handed to the writer together.
 */
export function repairable(fields) {
  return violationsOf(fields).filter(
    (v) => !/ is required and is missing/.test(v),
  );
}
