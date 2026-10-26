/**
 * Single source of truth for site-wide values.
 * Anything the spec (项目规范_英文内容站_v1.0.md) defines about identity,
 * navigation or the author persona lives here — not scattered in components.
 */

/** Production domain (registered 2026-10-01).
 *  Everything SEO-related — canonical, sitemap, RSS, og:image — derives from
 *  this single value, so changing it here is enough. */
/**
 * The canonical origin, with www, because that is the domain Cloudflare serves as primary.
 *
 * This was the bare domain and both forms answered HTTP 200 with identical content - two live URLs for
 * every page, which is the duplicate-content arrangement that splits signals between them. Only the
 * bare form redirected, and it redirected to www, which made bare the wrong choice for canonical.
 *
 * Two changes belong together and neither is sufficient alone: this constant, so every canonical, og:url,
 * JSON-LD url and sitemap entry names www; and the 301 in public/_redirects, so the bare form stops
 * answering 200 at all. A canonical that names a URL the server does not redirect to is a suggestion,
 * and search engines are entitled to ignore it.
 */
export const SITE_URL = "https://www.landedmath.com";

export const SITE = {
  url: SITE_URL,
  name: "Landed Math",
  /** Rendered as "Landed <em>Math</em>" in the logo. */
  nameHead: "Landed",
  nameTail: "Math",
  title: "Landed Math — China trade policy, converted into landed cost",
  /** Kept under ~140 chars: this doubles as the meta description. */
  description:
    "Independent analysis of China trade policy and supply chains, converted into per-unit landed cost for sellers and importers worldwide.",
  // The "No tracking · No ads · Independent analysis" tagline was removed from
  // the footer on 2026-10-03. None of the three claims was false, but the line
  // read as marketing, and the substantive version of it already lives on
  // /privacy/ ("No tracking scripts. No advertising networks. No third-party
  // analytics"). The footer now carries the disclaimer and the copyright only.
  language: "en",
  /**
   * Newsletter form target.
   *
   * Provider decided 2026-10-07: Buttondown. Spec §P8 listed Buttondown,
   * ConvertKit and MailerLite with Buttondown marked cheapest. AdSense was
   * rejected the same day because it conflicts with the privacy page's "no
   * advertising networks" promise, so the path is free content → email
   * subscribers → paid subscription, and this form is the only capture point for
   * step two. Subscriber count is the first KPI.
   *
   * Left empty until the account exists, which is why the component renders a
   * mailto fallback rather than a form: a form posting nowhere returns HTTP 405
   * from Cloudflare, which is worse than no form. See NewsletterForm.astro.
   *
   * TO ENABLE: create the Buttondown account, then set this to
   *
   *   "https://buttondown.com/api/emails/embed-subscribe/<username>"
   *
   * The embed endpoint takes a POST with the field named `email`, which is what
   * the component already sends — no other change is needed. Free tier covers the
   * first 100 subscribers; beyond that it is about $90 a year at ~1,000, the
   * project's first real operating cost, and it starts exactly when subscriber
   * count starts to matter.
   */
  newsletterAction: "",
};

/**
 * Cloudflare Web Analytics beacon token.
 *
/**
 * Cloudflare Web Analytics site token.
 *
 * Committed rather than read from the environment, and the reasoning changed after watching the
 * environment variable fail in exactly the way that costs an afternoon.
 *
 * The token is a public identifier. It is printed in the HTML of every page, in an attribute any
 * visitor can read, and it authorises nothing: it tells Cloudflare which site a measurement belongs
 * to. Treating it as a secret bought no safety and cost a real one - the variable was never set, so
 * the build emitted no beacon on any of 135 pages and the analytics dashboard stayed empty. Nothing
 * failed, nothing warned, and the only symptom was silence on a page nobody had opened yet.
 *
 * The previous comment argued that an absent token keeps a fork from reporting into this dashboard.
 * That is true and it was weighed: a fork shipping this file reports its own traffic here. The trade
 * is accepted because a metric that silently does not exist is worse than a fork's pageviews, and
 * because the token is not a credential.
 *
 * Chosen over GA4 deliberately (进度日志 §2): Cloudflare Web Analytics sets no cookies, so it needs no
 * consent banner and no GDPR cookie notice. GA4 would.
 *
 * Overridable, so the Pages project or a preview build can point somewhere else.
 */
export const CF_ANALYTICS_TOKEN = import.meta.env.CF_WEB_ANALYTICS_TOKEN || "be1864c080cf47f88bd1c126a8571ede";

/**
 * spec §3 — top navigation.
 *
 * The five category links were removed here on 2026-10-08 and put back the same day, on the
 * operator's instruction: "do not take the five category links out of the navigation, you
 * have made the front end look cheap". That is the right call and the reasoning in the
 * original edit was wrong. Trimming to the benchmark's four items assumes a reader arrives
 * knowing what a "silo" is; a commercial news blog puts its sections in the bar because that
 * is how a first-time reader finds out what the publication covers. Malaysiakini, the
 * reference the front-end brief names, lists its sections.
 *
 * So the rule is: sections in the bar, tools beside them, and the order puts the sections
 * first because they are what the publication is.
 */
export const NAV_LINKS = [
  { label: "Home", href: "/" },
  // Sections first: five of them, matching the five categories the articles carry.
  { label: "Trade Policy", href: "/category/trade-policy/" },
  { label: "Platforms", href: "/category/platforms/" },
  { label: "Supply Chain", href: "/category/supply-chain/" },
  { label: "Sourcing", href: "/category/sourcing/" },
  { label: "Logistics", href: "/category/logistics/" },
  /*
   * The sixth section, and the only one that is not a blog category.
   *
   * /guide/ answers a different question for a different reader - what it costs to move to, work in
   * or visit China, per month or per application rather than per container. It sits after the five
   * trade silos on purpose: the trade sections are the site's established business, and a nav that
   * leads with the newest thing tells every returning reader that the thing they came for moved.
   */
  { label: "Guides", href: "/guide/" },
  // Then the tools and the archive, which have no other route to them.
  { label: "Briefs", href: "/brief/" },
  { label: "Calculator", href: "/calculator/" },
  { label: "Tracker", href: "/tracker/" },
  { label: "By market", href: "/markets/" },
  { label: "Pricing", href: "/pricing/" },
  { label: "About", href: "/about/" },
];

/**
 * spec §5 — one entry per content silo. `slug` is also the value used in
 * post frontmatter (`category:`), so the two can never drift apart.
 *
 * The first three serve platform sellers (US/EU). `sourcing` and `logistics`
 * were added 2026-10-01 for the emerging-market importer audience — decision
 * recorded in the v1.3 revision doc, §7.1.
 */
export const CATEGORIES = [
  {
    slug: "trade-policy",
    label: "Trade Policy",
    navLabel: "Trade Policy",
    description:
      "Tariffs, duties, anti-dumping cases and export controls — translated into landed-cost math.",
  },
  {
    slug: "platforms",
    label: "Platforms",
    navLabel: "Platforms",
    description:
      "Amazon, Temu, TikTok Shop and D2C: rule changes, fee changes and what they cost sellers.",
  },
  {
    slug: "supply-chain",
    label: "Supply Chain",
    navLabel: "Supply Chain",
    description:
      "Factories, freight, lead times and industrial data — the part of the story nobody prices in.",
  },
  {
    slug: "sourcing",
    label: "Sourcing & Suppliers",
    navLabel: "Sourcing",
    description:
      "Finding, vetting and negotiating with Chinese suppliers — factories versus trading companies, samples, MOQ, inspection and the terms that protect your deposit.",
  },
  {
    slug: "logistics",
    label: "Logistics & Customs",
    navLabel: "Logistics",
    description:
      "Freight, documentation and clearance in the destination market — what it takes to move goods from a Chinese factory to your door, and who pays for which leg.",
  },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

/**
 * Who a piece is written for. Surfaced in the article header so a reader can
 * tell in one second whether it applies to them, and so GSC data can later be
 * read per audience.
 */
export const AUDIENCES = [
  { value: "platform-seller", label: "Platform sellers" },
  { value: "importer", label: "Importers & buyers" },
  { value: "both", label: "Both audiences" },
] as const;

export type Audience = (typeof AUDIENCES)[number]["value"];

export function audienceLabel(value: string): string {
  return AUDIENCES.find((a) => a.value === value)?.label ?? value;
}

/** spec v1.2 §11 — pen name, role and location. */
export const AUTHOR = {
  name: "V",
  initials: "V",
  role: "China Supply Chain Analyst · Shenzhen",
  avatar: "", // e.g. "/images/author.jpg" once a real photo exists
  shortBio:
    "China Supply Chain Analyst, based in Shenzhen. Reads China's trade policy in the original and translates it into landed cost for sellers and importers worldwide.",
  longBio:
    "China Supply Chain Analyst, based in Shenzhen. Trade policy, platform rules and factory-level cost shifts, converted into landed cost for sellers in the US and EU and for importers across emerging markets. No agency, no sponsorship, no agenda.",
  /** TODO(user): enable Cloudflare Email Routing so this address actually delivers. */
  email: "hello@landedmath.com",
};

/** spec §3 — footer. */
export const FOOTER_LINKS = [
  // The benchmark surfaces its sourcing documentation from the footer under a
  // "Data sources" heading. Same placement here, because that is where a reader
  // goes to ask whether the numbers can be trusted.
  { label: "How the sources work", href: "/sources/" },
  { label: "Instruments", href: "/instrument/" },
  { label: "Briefs", href: "/brief/" },
  { label: "Pricing", href: "/pricing/" },
  /*
   * The commercial page, in the footer rather than the top navigation.
   *
   * It sits beside Pricing because that is where a reader already thinking about money is. Without
   * this link the page would exist only in the sitemap, and this project has already published
   * pages that nothing linked to - the defect the orphan check exists to catch.
   */
  { label: "Licensing and sponsorship", href: "/advertise/" },
  // The whitelisting page lives here rather than in the top navigation because it is
  // support, not a destination: you reach it when an email did not arrive, or from the
  // footer of one that did. Without this link it existed only in the sitemap, and a page
  // nothing links to is not published.
  { label: "Make sure emails arrive", href: "/whitelist/" },
  { label: "Terms", href: "/terms/" },
  { label: "Refunds", href: "/refund/" },
  { label: "Privacy Policy", href: "/privacy/" },
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
  { label: "RSS Feed", href: "/rss.xml" },
];

/**
 * Shown at the foot of every article and in the site footer.
 *
 * The earlier version read "Independent analysis, not financial or legal
 * advice" — seven words that miss the two risks this site actually carries. It
 * did not say we are not a customs broker, and it did not tell the reader to
 * check a figure against the document it came from. Both matter because the
 * articles are quantitative: a reader can act on a number.
 *
 * Kept short on purpose. A disclaimer nobody reads is not a disclaimer, so
 * this covers three things and stops — the basis of the content, what we are
 * not, and what to do before relying on a figure.
 */
export const DISCLAIMER =
  "Analysis of publicly available official documents. Not a customs broker, " +
  "law firm or tax adviser, and nothing here is legal, tax or investment " +
  "advice. Every figure is sourced and dated — check the original before you " +
  "act on it.";

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}

export function categoryHref(slug: string): string {
  return `/category/${slug}/`;
}

/** 2026-09-29 -> "Sep 29, 2026" (matches the prototype's date style). */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
