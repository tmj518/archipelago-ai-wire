import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
// `z` from "astro:content" is deprecated and goes away in Astro 8.
import { z } from "astro/zod";

import taxonomy from "./lib/taxonomy.json";
import { AUDIENCES, CATEGORIES, type Audience, type CategorySlug } from "./consts";

/**
 * The blog collection.
 *
 * Frontmatter mirrors the fields spec §4.1 / §5.1 require of every article:
 *  - `sources`   -> 信源清单, rendered as a footnote so no URLs sit in the body
 *  - `category`  -> the silo, also drives /category/<slug>/ pages
 *  - `priority`  -> the P0/P1/P2 triage used by the homepage hero
 *  - `featured`  -> which post gets the hero slot
 */
const categorySlugs = CATEGORIES.map((c) => c.slug) as [
  CategorySlug,
  ...CategorySlug[],
];

const audienceValues = AUDIENCES.map((a) => a.value) as [Audience, ...Audience[]];

export const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string().max(120),
    /**
     * The positioning line, not a summary. Spec decision 1 (2026-10-03): the
     * title carries the hook that earns the click, and `subtitle` carries the
     * target keyword that earns the ranking. It renders visibly under the
     * <h1> and it goes into the <title> tag, so the keyword reaches the SERP.
     *
     * Keep it to one sentence, with the target keyword in it, and without the
     * hook's rhetoric. It is not the same thing as `description`, which is the
     * longer card excerpt and the meta description.
     */
    subtitle: z.string().max(160).optional(),
    /** Doubles as <meta name="description"> and the card excerpt. */
    description: z.string().max(300),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    /**
     * The date a human should look at this piece again: the date its central
     * fact is expected to change, not its publish date.
     *
     * Every article here is dated and sourced, which is a strength until one of
     * its dates passes. Ten of the first fourteen published pieces carried a
     * future deadline and seven fell inside three months. An article whose
     * central fact has expired is worse than one never written, because it still
     * ranks and still reads as current.
     *
     * Set by hand rather than derived from the body, because a date in prose is
     * not always a deadline — article 14 mentions a Commission review due in
     * 2028 as context, not as an expiry. `tools/review-dates.mjs` extracts
     * candidates and reports what is due; `qa-check` requires the field to
     * exist, so the decision cannot be skipped by forgetting it. Evergreen
     * pieces get a quarterly date.
     */
    reviewBy: z.coerce.date().optional(),
    /**
     * What an out-of-date fact in this piece costs: `priced` when the article
     * states a per-unit money figure the reader could act on — price a
     * contract, book freight, choose a route — and `directional` when it only
     * describes a direction or a process, where being stale means being old
     * rather than being wrong in a way that costs money.
     *
     * This exists because a flat review rule treated all fourteen pieces as
     * equally urgent, which both overstates the maintenance bill and buries the
     * nine that matter. Nine of the first fourteen published pieces state a
     * per-unit figure; five are directional. The gate requires a `priced` piece
     * to be reviewed within 180 days, and does not constrain the rest.
     */
    stakes: z.enum(["priced", "directional"]).default("directional"),
    /**
     * What actually changed after publication, newest last.
     *
     * This is the visible half of the review clock, and the distinction between
     * the two is the whole point. `reviewBy` says when someone should look;
     * `revisions` says what they found and changed. Only this one is shown to
     * readers and only this one reaches `dateModified` in the structured data.
     *
     * The reason to keep them apart is that a date-only edit is not maintenance.
     * Google's stated position is that changing dates without changing content
     * does not improve rankings, and date churn is a pattern it treats as
     * manipulation. So the process rule attached to this field: a review ends
     * with either a revision recorded here, or an explicit decision that nothing
     * needed to change. It never ends with only a bumped date.
     *
     * The export-rebate article carried a prose correction at its foot from
     * 2 October 2026 before this field existed. That note was the right instinct
     * expressed the only way available at the time; structured, it renders in a
     * fixed place, states the same thing machine-readably, and can be checked.
     */
    revisions: z
      .array(
        z.object({
          date: z.coerce.date(),
          /** What changed, in the reader's terms. */
          note: z.string().min(20).max(600),
        }),
      )
      .default([]),
    category: z.enum(categorySlugs),
    /** Who the piece is for; surfaced in the article header. */
    audience: z.enum(audienceValues).default("both"),
    tags: z.array(z.string()).default([]),
    /** P0 = industry-level, P1 = sector-level, P2 = watchlist. */
    priority: z.enum(["P0", "P1", "P2"]).optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    /**
     * The article's number in publication order, written down rather than derived.
     *
     * Deriving it by sorting on publishDate is unstable: eight articles share one
     * date, the tie is broken by slug, so renaming or adding a file renumbers pieces
     * that are already published and already cited in the ledger. Two pieces both
     * reported themselves as number 21 before this field existed.
     */
    articleNumber: z.number().int().positive().optional(),
    /** Official sources by name only — spec §4.3 forbids URLs in the body. */
    sources: z.array(z.string()).default([]),

    // ---- v1.3 fields: the machine-checkable half of the QA gate ----------
    /** The long-tail query this piece is written to win. */
    target_keyword: z.string().optional(),
    search_intent: z
      .enum(["informational", "transactional", "comparison"])
      .optional(),
    /**
     * What this piece has that the top 3 results do not. If none of these can
     * be claimed honestly, the piece does not get published.
     */
    information_gain: z
      .enum(taxonomy.informationGain as [string, ...string[]])
      .optional(),
    /**
     * Every figure in the body, with the five parts the spec requires:
     * value + unit + period + named source + retrieval date. A number that
     * cannot fill all five does not go in the article.
     */
    figures: z
      .array(
        z.object({
          value: z.string(),
          unit: z.string().default(""),
          period: z.string(),
          source: z.string(),
          /*
           * A date, either way it arrives.
           *
           * On 2026-10-21 a writer emitted `retrieved: 2026-10-21` without quotes. YAML reads that as a
           * date object, `z.string()` rejected it, and the whole site stopped building - 49 articles
           * frozen because of one missing pair of quotes in one header.
           *
           * The guide collection got this treatment first. The blog needs it more: the blog is written
           * every day by a model, and this is the failure that has actually happened. Accepting both
           * shapes and normalising cannot make a currently-valid article invalid; it only removes a way
           * for a valid one to arrive broken.
           */
          retrieved: z
            .union([z.string(), z.date()])
            .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))
            .pipe(z.string()),
        }),
      )
      .default([]),
    heroImage: z.string().optional(),
    heroImageAlt: z.string().optional(),

    // ---- Video (spec v1.3 §15 / roadmap §5.2) ----------------------------
    /**
     * YouTube video id only — never the full URL, and never the file. Spec
     * v1.2 §6 keeps video out of the repository, and an id is enough for the
     * embed and for the VideoObject structured data.
     */
    youtube_id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/, "must be an 11-character YouTube video id")
      .optional(),
    /** Shown above the player; falls back to the article title. */
    videoTitle: z.string().optional(),
    /** ISO 8601 duration, e.g. PT4M13S. Feeds VideoObject.uploadDate/duration. */
    videoDuration: z.string().optional(),
  }),
});

/**
 * The guide collection: the same site, a second promise.
 *
 * `/blog/` answers "what happened in the world, and what does it mean for Malaysia". It is written
 * by the news pipeline, its figures all carry a retrieval date, and every claim is a number or a
 * named document. That promise is the site's only real asset and this file does not touch it - the
 * `blog` schema above is unchanged.
 *
 * `/guide/` answers a different question for the same Malaysian reader: "the thing that changed -
 * what do I actually do about it, what does it cost me, and when was that checked". The unit
 * changes (a month, an application, a form) and so does the evidence (a fee schedule, a checklist, a
 * deadline), but the standard does not: no claim without a source, no guide without a date it was
 * last checked.
 *
 * WHY THIS IS A SEPARATE COLLECTION AND NOT A CATEGORY
 *
 * A `guide` inside `blog` would inherit `figures`, `revisions`, `priority`, `featured`, `tags` and the
 * article QA gates - a structure built for policy analysis and wrong for a how-to. More importantly it
 * would enter every count the homepage prints ("51 analyses, 438 sourced figures"), so one guide would
 * silently dilute a promise that took 51 articles to earn. Separate collections keep two promises
 * instead of averaging them.
 */
const guideDate = z
  .union([z.string(), z.date()])
  /*
   * An unquoted `2026-10-21` is a YAML date, not a string, and demanding a string is exactly how the
   * whole site failed to build on 2026-10-21: `retrieved` arrived as an object and Astro rejected the
   * entry. A guide is written by a model and a model forgets quotes, so the schema accepts either and
   * normalises to YYYY-MM-DD rather than turning a formatting lapse into a failed deploy.
   */
  .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"));

export const guide = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guide" }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),

    /** Which cluster the guide belongs to. Also the /guide/ index grouping. */
    topic: z.enum(taxonomy.guideTopics.map((t) => t.slug) as [string, ...string[]]),

    /** Who is asking. One guide can serve several, but the answer differs by unit. */
    audience: z
      .array(z.enum(taxonomy.guideAudiences as [string, ...string[]]))
      .min(1),

    /**
     * The unit the costs are expressed in - "one month", "one application", "one move".
     *
     * This is the field that keeps the two halves of the site coherent: blog prices a container or a
     * tonne, a guide prices a month or an application, and both answer "per your unit".
     */
    unit: z.string().max(80),

    /** The date every figure in this guide was last checked. Required, by design. */
    lastVerified: guideDate,
    /** When it must be re-checked: lastVerified + 180 days. Computed by the writer tool. */
    reviewBy: guideDate.optional(),

    /**
     * The figures, when the authority publishes any.
     *
     * This used to be `.min(1)`: a guide without a sourceable figure was rejected outright, which turned
     * "the ministry has not published this fee" into "no article today". A procedural guide - what to
     * bring, in what order, what goes wrong - is still worth publishing for a reader standing at a
     * counter, and the alternative was a yellow card.
     *
     * What is NOT allowed is inventing the missing number. An empty array is an honest statement that
     * the figure does not exist yet; the page says so in words, and the writer is still forbidden from
     * putting any figure in the prose that is not in this array.
     */
    figures: z
      .array(
        z.object({
          value: z.string(),
          unit: z.string().default(""),
          period: z.string(),
          source: z.string(),
          retrieved: guideDate,
        }),
      )
      .default([]),

    /** Ordered actions, at least five. A guide is a procedure, not an essay. */
    steps: z
      .array(z.object({ action: z.string(), detail: z.string().default("") }))
      .min(5, "a guide needs at least five ordered steps"),

    persona: z.enum(taxonomy.personas as [string, ...string[]]).default("malaysian-explainer"),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, guide };
