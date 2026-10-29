/**
 * Single source of truth for site-wide values.
 *
 * The controlled vocabularies (categories, audiences, guide topics, article sections) do NOT
 * live here any more. They live in `src/lib/taxonomy.json`, because the same lists are also
 * needed by plain-Node tools that cannot import TypeScript. This file reads that JSON and
 * exposes it with the names the rest of the site already uses, so nothing downstream changed.
 *
 * If you are about to add a category, add it to taxonomy.json. Adding it here will not reach
 * the gate, and the gate is what actually rejects an article.
 */
import taxonomy from "./lib/taxonomy.json";

/**
 * The canonical origin.
 *
 * Confirmed by the project owner on 2026-10-26 as https://www.toolsai.club. The www form is the
 * canonical one: the bare domain redirects to it (public/_redirects), so every canonical, og:url,
 * JSON-LD url and sitemap entry names the same single address. Two forms serving the same content is
 * the arrangement that splits a page's signals, and the redirect plus this constant are what prevent
 * it - neither is sufficient alone.
 *
 * PUBLIC_SITE_URL still overrides it for a preview build. That override is a deployment convenience,
 * not a second source of truth: tests/build-assertions.mjs checks the built output, so a build that
 * drifted to another origin fails rather than shipping quietly.
 */
export const SITE_URL =
  import.meta.env.PUBLIC_SITE_URL || "https://www.toolsai.club";

export const SITE = {
  url: SITE_URL,
  /*
   * The display name, in English, for "大马看世界". The tagline below it is the English rendering of
   * "看懂世界，读懂大马". Kept in one object because the logo, the <title>, the meta description and the
   * footer all read from here - a brand that lives in five strings drifts within a month.
   */
  name: "Malaysians Look at the World",
  /** Rendered as "Malaysians <em>Look at the World</em>" in the logo. */
  nameHead: "Malaysians",
  nameTail: "Look at the World",
  title: "Malaysians Look at the World — the world, explained",
  /** Kept under ~140 chars: this doubles as the meta description. */
  description:
    "What is happening in the world, why, and what it means for Malaysia — in plain language, with a source and a date on every figure.",
  /*
   * Visitor-facing newsletter UI is off while the product is content-first.
   * The components and the mailto fallback stay in the tree so switching this back on is one
   * boolean, not a rebuild. Every entry point reads this flag.
   */
  newsletterEnabled: false,
  language: "en",
  /**
   * Newsletter form target.
   *
   * Left empty until the account exists, which is why the component renders a mailto fallback
   * rather than a form: a form posting nowhere returns HTTP 405 from Cloudflare, which is worse
   * than no form. See NewsletterForm.astro.
   */
  newsletterAction: "",
};

/**
 * Cloudflare Web Analytics site token.
 *
 * A public identifier, printed in the HTML of every page and authorising nothing. Overridable so
 * a preview build can point elsewhere. The value from the previous project is deliberately NOT
 * carried over: reporting the new site's traffic into the old dashboard would corrupt both.
 */
export const CF_ANALYTICS_TOKEN = import.meta.env.CF_WEB_ANALYTICS_TOKEN || "";

/**
 * Top navigation.
 *
 * Sections first, because a first-time reader finds out what a publication covers by reading the
 * bar. The four sections are the four categories in taxonomy.json, in the same order, and the
 * order is deliberate: World is the widest frame, Malaysia Impact is the promise, and the two
 * desks after it are where most of the daily coverage lands.
 */
export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "World", href: "/category/world/" },
  { label: "Malaysia", href: "/category/malaysia-impact/" },
  { label: "Economy", href: "/category/economy/" },
  { label: "Tech & AI", href: "/category/tech-ai/" },
  { label: "Work & Family", href: "/category/work-education-family/" },
  { label: "Business", href: "/category/business-opportunities-risks/" },
  /*
   * The practical-guide collection is the one section that is not a blog category. It answers a
   * different question for the same reader - "what do I actually do about this" - and it is kept
   * as a separate collection rather than a category because it has its own schema (steps, unit,
   * lastVerified) and its own promise about dates.
   */
  { label: "Guides", href: "/guide/" },
  { label: "About", href: "/about/" },
];

/**
 * Content silos. `slug` is also the value written into a post's frontmatter (`category:`), and
 * the same list is what `tools/qa-check.mjs` validates against — through taxonomy.json, not
 * through a copy.
 */
export const CATEGORIES = taxonomy.categories as Array<{
  slug: string;
  label: string;
  navLabel: string;
  description: string;
}>;

export type CategorySlug = string;

/**
 * Who a piece is written for. Surfaced in the article header so a reader can tell in one second
 * whether it applies to them, and so search data can later be read per audience.
 *
 * The six values are the six publics the project exists to serve. They are intentionally not
 * job titles: a factory supervisor and a clerk both read as `workers`, and a small shop owner
 * reads as `entrepreneurs`.
 */
export const AUDIENCES = taxonomy.audiences as Array<{ value: string; label: string }>;

export type Audience = string;

export function audienceLabel(value: string): string {
  return AUDIENCES.find((a) => a.value === value)?.label ?? value;
}

/**
 * The byline.
 *
 * Deliberately an editorial desk rather than a person. The copy is produced with AI assistance
 * and checked by a human before publication; inventing a named foreign correspondent to make
 * that feel more authoritative would be a fabrication in the one place a reader looks to decide
 * whether to trust the page. The AI-disclosure record lives in docs/合规记录_AI标识.md.
 */
export const AUTHOR = {
  name: "Archipelago Editorial",
  initials: "AW",
  role: "Editorial desk · Kuala Lumpur",
  avatar: "",
  shortBio:
    "The editorial desk of Archipelago AI Wire. We read the primary documents, keep the numbers traceable, and explain what world events mean for people in Malaysia.",
  longBio:
    "Archipelago AI Wire exists to help Malaysians understand the world: what is happening, why it is happening, and what it means here — for jobs, prices, businesses, students and households. Every figure carries a source and a retrieval date. Drafting is AI-assisted; every piece is reviewed against the source documents before publication, and corrections are recorded on the page.",
  /*
   * Moved with the domain on 2026-10-26: an editorial address on a domain the site no longer uses is
   * a contact route that cannot work. Mail routing for toolsai.club is NOT configured yet - this is the
   * address the site will use, not one that currently delivers. Set it up before launch.
   */
  email: "editor@toolsai.club",
};

/** Footer. */
export const FOOTER_LINKS = [
  { label: "How the sources work", href: "/sources/" },
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
  { label: "Terms", href: "/terms/" },
  { label: "Privacy Policy", href: "/privacy/" },
  { label: "RSS Feed", href: "/rss.xml" },
];

/**
 * Shown at the foot of every article and in the site footer.
 *
 * Three things and no more: the basis of the content, what we are not, and what to do before
 * relying on a figure. A disclaimer nobody reads is not a disclaimer.
 */
export const DISCLAIMER =
  "Explained from publicly available official documents and data. Not a law firm, " +
  "tax adviser or investment adviser, and nothing here is legal, tax or investment " +
  "advice. Every figure is sourced and dated — check the original before you act on it.";

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}

export function categoryHref(slug: string): string {
  return `/category/${slug}/`;
}

/** 2026-09-29 -> "Sep 29, 2026" */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
