/**
 * Structured data shared by every page.
 *
 * Google's own documentation is explicit that Article and Organization have no
 * required properties, and that only BreadcrumbList does. So the point of this file is
 * not compliance — it is that a machine reading the site should be able to tell who
 * publishes it and where each page sits, which is what the operator asked for and what
 * the two competitor studies both surfaced as a gap.
 *
 * Everything here is derived from src/consts.ts so the identity cannot drift between
 * the visible page and the machine-readable one.
 */
import { AUTHOR, CATEGORIES, SITE, SITE_URL, categoryLabel } from "../consts";

/** Every JSON-LD block needs it, and forgetting it once makes the block unreadable. */
const CONTEXT = "https://schema.org";

/**
 * The publishing entity, as one stable node.
 *
 * `@id` is the important part: it lets the Article blocks reference this same
 * organisation rather than repeating a name string, which is how a search engine ties
 * a byline, a publisher and an about page into one entity instead of three.
 *
 * `logo` and `url` were both missing before. Neither is required, but a publisher with
 * no logo is a publisher a machine cannot resolve.
 */
export const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE.name,
  url: SITE_URL,
  description: SITE.description,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/og-default.png`,
    width: 1200,
    height: 630,
  },
};

/** The site itself, tied to the organisation that publishes it. */
export const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE.name,
  url: SITE_URL,
  description: SITE.description,
  inLanguage: SITE.language,
  publisher: { "@id": `${SITE_URL}/#organization` },
};

/**
 * The author as a node, pointing at the page that substantiates the byline.
 *
 * This is the honest version of an E-E-A-T fix. Google's spam policies name fabricated
 * creator profiles as a deception signal, so the answer is not a fuller invented
 * persona — it is pointing the existing pen name at the real background already written
 * on /about/. `url` is what makes the byline checkable rather than asserted.
 */
export function personNode() {
  return {
    "@type": "Person",
    "@id": `${SITE_URL}/about/#who`,
    name: AUTHOR.name,
    jobTitle: AUTHOR.role,
    description: AUTHOR.shortBio,
    url: `${SITE_URL}/about/#who`,
  };
}

/** Publisher as a reference to the shared organisation node, not a name string. */
export function publisherRef() {
  return { "@id": `${SITE_URL}/#organization` };
}

/** Titles for the path segments that are not a category and not an article. */
const STATIC_TITLES = {
  blog: "Analysis",
  calculator: "Landed-cost calculator",
  tracker: "Policy change tracker",
  markets: "By market",
  sources: "How the sources work",
  about: "About",
  contact: "Contact",
  privacy: "Privacy Policy",
};

/**
 * Build the breadcrumb trail for a path, automatically.
 *
 * Done here rather than per page so that a new page cannot forget it, which is how the
 * five pages without structured data got that way in the first place.
 *
 * The trail follows the URL: Home → section → leaf. A category hub produces
 * Home → Trade Policy, and an article produces Home → Analysis.
 *
 * @param {string} pathname
 * @param {string} [pageTitle]
 * @returns {Crumb[]}
 */
export function breadcrumbsFor(pathname, pageTitle) {
  const parts = pathname.split("/").filter(Boolean);
  /** @type {Crumb[]} */
  const trail = [{ name: "Home", url: `${SITE_URL}/` }];

  if (parts.length === 0) return trail;

  // /category/<slug>/ -> one crumb, the category label.
  if (parts[0] === "category" && parts[1]) {
    trail.push({ name: categoryLabel(parts[1]), url: `${SITE_URL}/category/${parts[1]}/` });
    return trail;
  }

  // /blog/<slug>/ -> the section, then the category, then the article.
  if (parts[0] === "blog" && parts[1]) {
    trail.push({ name: "Analysis", url: `${SITE_URL}/blog/` });
    return trail;
  }

  const label = STATIC_TITLES[parts[0]];
  if (label) {
    trail.push({ name: label, url: `${SITE_URL}/${parts[0]}/` });
    return trail;
  }

  // Unknown top-level segment: use the page title rather than inventing a name.
  trail.push({ name: pageTitle ?? parts[0], url: `${SITE_URL}/${parts[0]}/` });
  return trail;
}

/**
 * Wrap a trail as BreadcrumbList — the only structured data with required fields.
 *
 * @param {Crumb[]} crumbs
 */
export function breadcrumbList(crumbs) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

/**
 * Every page's shared block: the site, the organisation and the trail.
 *
 * The homepage gets no BreadcrumbList. A trail of one item is invalid — Google requires
 * at least two ListItems — and "Home" as the only crumb tells a machine nothing it does
 * not already know from the canonical URL. So the trail starts where a trail starts:
 * one level down.
 *
 * @param {string} pathname
 * @param {string} [pageTitle]
 */
export function siteBlocks(pathname, pageTitle) {
  const trail = breadcrumbsFor(pathname, pageTitle);
  return [
    { "@context": CONTEXT, ...WEBSITE },
    { "@context": CONTEXT, ...ORGANIZATION },
    ...(trail.length >= 2
      ? [{ "@context": CONTEXT, ...breadcrumbList(trail) }]
      : []),
  ];
}

/**
 * A page block for the hub pages.
 *
 * The five pages with no structured data were the calculator, tracker, markets,
 * sources and the category hubs. Naming them as pages with a title and a description is
 * the minimum that makes them addressable rather than anonymous.
 *
 * @param {{ type?: "WebPage" | "CollectionPage" | "AboutPage" | "ContactPage"; url: string; name: string; description: string }} opts
 */
export function webPageBlock(opts) {
  return {
    "@context": CONTEXT,
    "@type": opts.type ?? "WebPage",
    "@id": `${opts.url}#page`,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    inLanguage: SITE.language,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
}

export { CONTEXT as SCHEMA_CONTEXT };
