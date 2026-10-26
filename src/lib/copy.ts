/**
 * Landing copy, in one place.
 *
 * The project specification carries a verbatim English landing block, and the benchmark it
 * was modelled on keeps its copy in one file rather than scattered through components. Two
 * reasons that matters here beyond tidiness: the same sentence appears in the hero, the
 * newsletter widget and the archive pages, and a claim about the product has to be changed
 * everywhere at once or it stops being true in one place.
 *
 * Two deliberate departures from the specification's wording, both recorded rather than
 * silently applied.
 *
 * The headline. The spec's draft is "Understand China's trade policy in 5 minutes", copied
 * from the benchmark whose product summarises other people's reporting. This one does
 * arithmetic on primary documents and asks the reader for commercial inputs, so a
 * five-minute promise is one the product would not keep. What it does promise is that the
 * number is the point and the working is shown, which is both true and more specific.
 *
 * The cadence. The spec's social-proof line mentions a weekly brief. There is no email
 * sending yet, so the copy names the cadence that exists - when a tracked change moves a
 * per-unit cost - rather than the one that is planned.
 */
import { SITE } from "../consts";

/** The offer, stated once. Every component that asks for a subscription uses this. */
export const PROMISE =
  "One email when a tracked change actually moves your per-unit cost. No daily filler.";

/** What the site is, in one sentence, for the hero subtitle and the meta description. */
export const SUBTITLE =
  "What a published change costs you per unit, per container, per tonne — with the source and the retrieval date on every figure, and a calculation you can check.";

/** Who it is for. Named so the right reader recognises themselves. */
export const AUDIENCE = "For importers, brands and sourcing teams.";

/**
 * The headline.
 *
 * A verb phrase plus a concrete payoff, which is the benchmark's shape. The payoff is the
 * invoice rather than a reading time, because the invoice is what the reader came for and it
 * is the one thing this product does that a summary cannot.
 */
export const HEADLINE = "China's trade rules, converted into your landed cost";

/** What the reader actually gets, as three nouns rather than an adjective. */
export const WHAT_YOU_GET = [
  "Every analysis, in full",
  "Every figure, with its source and date",
  "Every calculation, shown so you can check it",
];

/**
 * The call to action.
 *
 * One, and only one, on the first screen - the benchmark keeps a single button and the
 * specification repeats the rule twice. "Get the change alerts" names what arrives instead of
 * asking for a favour, which is the difference between a subscription and a donation.
 */
export const CTA = "Get the change alerts";

/** The secondary line under the button, which sets expectations about frequency. */
export const CTA_NOTE = "Free. One email when something actually changes. Unsubscribe in one click.";

/** Sentence used where a page needs to say what the site refuses to do. */
export const INDEPENDENCE = `Independent analysis. No ads, no sponsors, no tracking. Published by ${SITE.name}.`;
