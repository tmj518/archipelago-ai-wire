/**
 * The rules a reader would notice, in one place.
 *
 * The same array is imported by the writer prompt and by the reviewer prompt. Two copies drift: the
 * gate gets relaxed, the writer keeps aiming at the old target, and the rejection looks like a writing
 * failure when it is a stale instruction. This module exists so there is one list.
 */
export const SITE_RULES = [
  "Every number carries a source and a date. One sourced number is enough; a page of unsourced numbers is not an article.",
  "Separate what the document states, what you infer from it, and what is still unknown. Never present an inference as the source's own conclusion.",
  "Name the Malaysian channel: an industry, a job, a price, a rule, a route, a customer, or a risk that a Malaysian reader carries.",
  "Do not write about race, religion or royalty. Those subjects are quarantined because this pipeline has no human reviewer for them.",
  "No first-person results. Never 'I built', 'I made', 'my business', 'we tested'.",
  "No invented quotes, people, products or figures. If a price is uncertain, write 'see official pricing'.",
  "Explain the transmission path rather than the headline: how a decision abroad reaches a cost, a job or a choice in Malaysia.",
];

export const SITE_RULES_TEXT = SITE_RULES.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
