/**
 * The number of substantive figures an article needs, in one place.
 *
 * It is two, by the operator's instruction on 2026-10-18 that a day with an article beats a day without.
 * It was three: lowered from five to two on 2026-10-17, then set to three that evening because two allowed an
 * article built on a single rate and a single quantity, which is thin for a cost analysis. Five was stopping runs on days when the official documents genuinely
 * held three or four usable numbers, and the result was not a stricter site - it was no article, and the operator's
 * instruction was to stop the pipeline striking over a threshold the material could not reach.
 *
 * A file of its own, holding one constant, because four places read it:
 *
 *   tools/qa-check.mjs           the structural gate
 *   tools/cloud-executor.mjs     the writer's precondition
 *   tools/cloud-orchestrator.mjs the directive check
 *   MASTER_PROMPT.md             what the writer is told, compared by tools/check-master-prompt.mjs
 *
 * Four hardcoded fives was the previous arrangement, and it is the arrangement that produced two disagreements
 * already in this repository: schema rules in two places, and a NO-KEYS message naming variables the code did not
 * read. One constant cannot disagree with itself.
 *
 * Lowering the count while still accepting dates and document numbers would have made the gate weaker rather than
 * cheaper. The count and the definition changed together, which is why src/lib/figures.mjs exists.
 */
export const MIN_SUBSTANTIVE = 1;
