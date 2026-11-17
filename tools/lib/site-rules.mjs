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
  "Name the Malaysian channel - and it may be any of these and more: an industry, a job, a wage, a price, a tax, a rule or a licence, a shipping route, a supplier, a customer, a competitor, a funding market, a technology that changes what a firm here can do, a currency, a subsidy, a school, a hospital, a household cost, or a risk a Malaysian carries without choosing it. Any sector and any country qualify; what is refused is a story with no channel at all.",
  "Do not write about race, religion or royalty. Those subjects are quarantined because this pipeline has no human reviewer for them.",
  "No first-person results. Never 'I built', 'I made', 'my business', 'we tested'.",
  "No invented quotes, people, products or figures. If a price is uncertain, write 'see official pricing'.",
  "Explain the transmission path rather than the headline: how a decision abroad reaches a cost, a job or a choice in Malaysia.",
];

export const SITE_RULES_TEXT = SITE_RULES.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
