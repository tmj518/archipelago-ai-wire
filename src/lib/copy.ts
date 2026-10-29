/**
 * Landing copy, in one place.
 *
 * The same sentence appears in the hero, the newsletter widget and the archive pages, and a claim
 * about the product has to be changed everywhere at once or it stops being true in one place.
 *
 * Rewritten 2026-10-26 with the repositioning. The previous version sold arithmetic on Chinese
 * trade documents to importers outside China; every sentence below would have been a promise to
 * the wrong reader.
 */
import { SITE } from "../consts";

/** The offer, stated once. Every component that asks for a subscription uses this. */
export const PROMISE =
  "One email a week with what changed in the world and what it means here. No daily filler.";

/** What the site is, in one sentence, for the hero subtitle and the meta description. */
export const SUBTITLE =
  "What is happening in the world, why it is happening, and what it means for Malaysia — in plain language, with a source and a date on every figure.";

/** Who it is for. Named so the right reader recognises themselves. */
export const AUDIENCE = "For everyone in Malaysia.";

/**
 * The headline.
 *
 * Two sentences rather than one slogan, because the promise has two halves and the second half is
 * the whole product: anybody can tell a Malaysian what happened in Washington; the reason to come
 * back is the sentence after it.
 */
export const HEADLINE = "Understand the world. And what it means for Malaysia";

/** What the reader actually gets, as three nouns rather than an adjective. */
export const WHAT_YOU_GET = [
  "What happened, in plain language",
  "Why it happened, and why now",
  "What it means for your work, your bills, your future",
];

/**
 * The call to action.
 *
 * One, and only one, on the first screen. "Get the weekly brief" names what arrives instead of
 * asking for a favour, which is the difference between a subscription and a donation.
 */
export const CTA = "Bookmark this site";

/** The secondary line under the button, which sets expectations about frequency. */
export const CTA_NOTE = "Save it once, come back any time. No email, no signup.";

/** Sentence used where a page needs to say what the site refuses to do. */
export const INDEPENDENCE = `Independent. No ads, no sponsors, no tracking. Published by ${SITE.name}.`;
