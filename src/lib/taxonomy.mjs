/**
 * The Node-side reader for src/lib/taxonomy.json.
 *
 * ## Why a JSON file and a reader, instead of exporting the arrays from here
 *
 * The vocabulary has to be readable by two runtimes that share no module system:
 *
 *   the Astro build   src/consts.ts, a TypeScript file
 *   the plain tools   tools/qa-check.mjs, tools/check-master-prompt.mjs - run by bare
 *                     `node`, with no bundler, no TypeScript and no aliasing
 *
 * A `.ts` file cannot be imported by the second group and a `.mjs` file with types cannot be
 * read by the first without configuration. JSON is the one format both consume natively, so the
 * data lives there and this module is the thin reader the tools use.
 *
 * ## What this replaces
 *
 * Before this file, `CATEGORY_ENUM` was written out twice inside qa-check.mjs, `CATEGORIES` and
 * `AUDIENCES` lived in src/consts.ts, the same lists were repeated in MASTER_PROMPT.md §7, and
 * `information_gain` had a fifth copy in content.config.ts. The handoff document records that
 * this class of duplication has already cost the project twice ("the schema rules lived in two
 * places and disagreed"). One file, one reader, and a parity check in check-master-prompt.mjs.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The raw vocabulary, exactly as written. */
export const TAXONOMY = JSON.parse(readFileSync(join(HERE, "taxonomy.json"), "utf8"));

/** The blog's content silos, as slugs. Feeds both the Zod enum and the gate. */
export const CATEGORY_SLUGS = TAXONOMY.categories.map((c) => c.slug);

/** Who a piece is written for. Single value per article, so the article header can print it. */
export const AUDIENCE_VALUES = TAXONOMY.audiences.map((a) => a.value);

/** The guide collection's clusters. */
export const GUIDE_TOPIC_SLUGS = TAXONOMY.guideTopics.map((t) => t.slug);

/** A guide can serve several readers at once, so this one is used inside an array. */
export const GUIDE_AUDIENCE_VALUES = TAXONOMY.guideAudiences;

export const PERSONA_VALUES = TAXONOMY.personas;
export const INFORMATION_GAIN_VALUES = TAXONOMY.informationGain;
export const SEARCH_INTENT_VALUES = TAXONOMY.searchIntent;
export const STAKES_VALUES = TAXONOMY.stakes;
export const PRIORITY_VALUES = TAXONOMY.priority;

/**
 * The headings qa-check requires, in the order a finished article carries them.
 *
 * `What it means for Malaysia` is the addition that defines the 2026-10-26 repositioning: the
 * site is no longer a cost desk for foreign importers, so the Malaysian consequence gets its own
 * section rather than being a paragraph buried inside `So what`.
 */
export const SECTIONS = TAXONOMY.sections;

/** Human label for a category slug, for headers and breadcrumbs. */
export function categoryLabel(slug) {
  return TAXONOMY.categories.find((c) => c.slug === slug)?.label ?? slug;
}

/** Human label for an audience value. */
export function audienceLabel(value) {
  return TAXONOMY.audiences.find((a) => a.value === value)?.label ?? value;
}

/** Human label for a guide topic. */
export function guideTopicLabel(slug) {
  return TAXONOMY.guideTopics.find((t) => t.slug === slug)?.label ?? slug;
}
