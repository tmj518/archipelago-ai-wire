/**
 * Landing copy, in one place.
 *
 * The same sentence appears in the hero, the newsletter widget and the archive pages, and a claim
 * about the product has to be changed everywhere at once or it stops being true in one place.
 *
 * Rewritten 2026-10-26 with the repositioning. The previous version sold arithmetic on Chinese
 * trade documents to importers outside China; every sentence below would have been a promise to the
 * wrong reader.
 */
import { SITE } from "../consts";

/** The offer, stated once. Every component that asks for a subscription uses this. */
export const PROMISE =
  "One email a week with what changed in the world and what it means here. No daily filler.";

/** What the site is, in one sentence, for the hero subtitle and the meta description. */
export const SUBTITLE =
  "Understand what is changing, why it matters, and what it means for your work, business and future.";

/** Who it is for. Named so the right reader recognises themselves. */
export const AUDIENCE = "For everyone in Malaysia.";

/**
 * The headline.
 *
 * Two sentences rather than one slogan, because the promise has two halves and the second half is
 * the whole product: anybody can tell a Malaysian what happened in Washington; the reason to come
 * back is the sentence after it.
 *
 * Shortened again on 2026-10-26: the previous line ran to two long clauses on a phone and pushed the
 * first article below the fold, which is the opposite of what a homepage is for.
 */
export const HEADLINE = "Global changes. Malaysian consequences.";

/** What the reader actually gets, as three nouns rather than an adjective. */
export const WHAT_YOU_GET = [
  "What happened, in plain language",
  "Why it happened, and why now",
  "What it means for your work, your bills, your future",
];

/**
 * The primary call to action.
 *
 * It names the destination rather than a favour: a reader who presses it lands on the newest piece
 * of work, not on a subscription form. The newsletter is the second button, not the first.
 */
export const CTA = "Read the latest analysis";

/** The secondary action: the newsletter, and only the newsletter. */
export const CTA_SECONDARY = "Get the weekly brief";

/** The line under the buttons, which sets expectations about frequency. */
export const CTA_NOTE = "Free. One email a week. Unsubscribe in one click.";

/**
 * The line above the headline.
 *
 * It read "Independent · no ads · no tracking". The advertising half is true - the placeholder slots
 * were removed - but a first-time reader cannot check either claim, and a slogan nobody can verify
 * is decoration. What can be checked is stated instead: the desk starts from source documents, and
 * every article can be audited against that.
 */
export const KICKER = "Independent · source-led · no advertising";

/** Sentence used where a page needs to say what the site refuses to do. */
export const INDEPENDENCE = `Independent. No ads, no sponsors, no tracking. Published by ${SITE.name}.`;
