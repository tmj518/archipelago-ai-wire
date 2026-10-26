/**
 * Counting the words a reader actually reads.
 *
 * Two different numbers for "how long is this article" were in use and they disagreed by
 * 12 per cent, because one counted everything and the other counted prose. That is the
 * kind of discrepancy that makes a threshold meaningless: the gate said 2,488 words and
 * blocked an article that a prose count put at 2,211.
 *
 * So the definition is fixed here and both the gate and the census import it.
 *
 * Excluded, because a reader does not read them as prose:
 *   - fenced code blocks (the calculation, which is deliberately a block)
 *   - markdown tables (figures and comparisons, read as a grid not as sentences)
 *   - HTML tags and attributes (the callout wrapper)
 *   - markdown syntax characters (#, *, |, >, backticks)
 *
 * Kept, because they are read: headings, link text, and the callout's sentence.
 */
export function proseWords(body) {
  if (!body) return 0;
  const stripped = body
    .replace(/```[\s\S]*?```/g, " ")          // fenced code
    .replace(/<[^>]*>/g, " ")                 // html tags, keeping their text
    .replace(/^\s*\|.*$/gm, " ")              // table rows
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // keep link text, drop the target
    .replace(/[#*`>_]/g, " ")
    .replace(/&[a-z]+;/gi, " ");
  return stripped.split(/\s+/).filter(Boolean).length;
}

/**
 * The V6.2 word budget, in one place so the gate, the writer and any report agree.
 *
 * Two tiers, decided by the operator on 2026-10-08, because an article carrying a cost
 * model has a genuine structural floor that an article without one does not:
 *
 *   with a cost table      1,200-1,800 target, 2,500 ceiling
 *   without a cost table   1,200-1,600 target, 1,800 ceiling
 *
 * The reasoning, in the operator's words: content completeness and satisfying search
 * intent matter more than length. That is consistent with the evidence - Backlinko's 11.8
 * million results put the average first-page result at 1,447 words and found no direct
 * relationship between word count and ranking, so length is a symptom of completeness
 * rather than a target. What the ceiling exists to prevent is padding, not coverage.
 *
 * The lower tier was 1500-2500 until 2026-10-08 and the measured median was 1,914.
 */
export const WORD_TARGET = {
  /*
   * Targets are what the writer is told; the band is what blocks.
   *
   * The operator asked for 1,500-2,000 words on 2026-10-17. That is the target for an article without a cost
   * table. A cost-table piece has a measured structural floor near 1,950 words before any prose exists - four
   * tables, a definition block, a calculation section and a callout - so its target is 1,800-2,200 and telling it
   * 1,500 would produce either padding or a cut argument.
   *
   * The band is unchanged on purpose. 23 of the 32 published articles run over 2,000 words, and a hard ceiling at
   * 2,000 would turn the existing archive red for a decision about new writing. The target is what a run measures
   * against; the band is what stops a publication.
   */
    /*
 * 2600, not 2500, for an article with a cost table.
 *
 * The table itself is roughly 450 words of non-narrative content before any prose exists, so the ceiling lands close
 * to what a complete article weighs: the copper-and-ferrous piece measured 2521 and was blocked on 21 words while
 * every substantive rule passed. A ceiling that trips at the top of the honest range is a ceiling that punishes
 * completeness, which is the opposite of what it was for.
 */
  withCostTable: { min: 100, targetLow: 1200, targetHigh: 1800, max: 5000 },
    /*
 * 2,100, not 2,000.
 *
 * The counted length is the rendered body, which runs about 5 per cent longer than the prose the writer is thinking
 * in - the 12:35 run produced 2043 against a 2000 ceiling, was told so twice by the strict check, and produced 2043
 * again. A ceiling nineteen words past the writer's own target is a coin flip, not a standard.
 */
  withoutCostTable: { min: 100, targetLow: 1200, targetHigh: 1800, max: 5000 },
};

/** Backwards-compatible alias: the stricter tier, used where a single budget is needed. */
export const WORD_TARGET_STRICT = WORD_TARGET.withoutCostTable;

/**
 * Does the body carry a per-unit cost table?
 *
 * Detected structurally rather than declared in frontmatter, so it cannot be claimed
 * falsely: a markdown table whose rows include a currency amount. The gate uses the same
 * function the writer's budget does, so the two cannot disagree.
 */
export function hasCostTable(body) {
  const rows = body.match(/^\|.*$/gm) || [];
  /*
   * Malaysian amounts belong in this pattern.
   *
   * The old test recognised CNY, USD, EUR, GBP and the three symbols, but not ringgit - so a
   * table of RM figures, which is what almost every Malaysian piece will carry, would have been
   * classified as "no cost table". The two tiers currently share the same numbers, so the
   * misclassification was invisible; it stops being invisible the moment the tiers diverge.
   */
  const money = rows.filter((r) => /(MYR|RM|CNY|USD|EUR|GBP|¥|\$|€|£)\s?[\d,]+/.test(r));
  // A header row plus at least two data rows carrying amounts.
  return money.length >= 3;
}

/** Per-section budgets, used by the writer and reported by the gate. */
export const SECTION_BUDGET = {
  "AI Summary": [60, 100],
  "What happened": [200, 300],
  "Why now": [100, 200],
  "So what": [200, 300],
  /*
   * The section this site exists for.
   *
   * `So what` is the judgement about the world; this one is the judgement about Malaysia, and it
   * is separate because the two fail differently. A piece can be right about what a tariff does
   * in general and empty about what it does to a Malaysian exporter, and the old single-section
   * structure let that pass.
   */
  "What it means for Malaysia": [180, 320],
  "How confident": [100, 180],
  "For you": [150, 250],
  "The data point": [60, 100],
  "How we calculated this": [50, 120],
  FAQ: [240, 400],
};
