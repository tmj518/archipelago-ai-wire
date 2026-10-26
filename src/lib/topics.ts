/**
 * Tag slugs, and the floor that decides when a tag deserves a hub page.
 *
 * These live in their own module because Astro compiles `getStaticPaths` into a separate chunk that
 * cannot see anything declared at module scope in the page file itself. Declaring `slugify` in the
 * page frontmatter - above the function, even - failed the build with "slugify is not defined",
 * while the same function imported from here works in both the path generator and the template.
 *
 * The floor is deliberately not 1. A hub holding a single article is a category by another name,
 * and the benchmark study that motivated topic pages warned they are worth little until a site has
 * enough articles to cluster. Two is where a hub starts to be a hub, and the number of pages then
 * grows on its own as the corpus does, with no list to maintain.
 */
export const MIN_CLUSTER = 2;

/** A URL-safe slug from a tag, which is written for humans and may contain anything. */
export const slugify = (tag: string): string =>
  tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface Hub {
  slug: string;
  tag: string;
  count: number;
}

/**
 * Every hub the corpus supports, with its article count.
 *
 * One function, called from the route generator, the homepage index and the article footer, so the
 * three cannot disagree about which hubs exist. A disagreement produces a link to a page that was
 * never generated, which is the defect the two-article floor and the shared slugify exist to stop.
 *
 * Only tags whose slug survives the floor are returned; a tag on a single article is dropped here
 * rather than filtered at each call site, so no caller can accidentally link to a missing page.
 */
export function buildHubs(posts: { data: { tags?: string[] } }[]): Map<string, Hub> {
  const bySlug = new Map<string, Hub>();
  for (const p of posts) {
    for (const tag of p.data.tags ?? []) {
      const slug = slugify(tag);
      if (!slug) continue;
      const cur = bySlug.get(slug);
      if (cur) cur.count++;
      else bySlug.set(slug, { slug, tag, count: 1 });
    }
  }
  for (const [slug, hub] of [...bySlug]) if (hub.count < MIN_CLUSTER) bySlug.delete(slug);
  return bySlug;
}

/**
 * The hubs an article belongs to, most-populated first.
 *
 * A hub the article's own tags produce is a real relation - the article is in that cluster by
 * definition. Nothing here invents a topical link, which is why an article with one qualifying tag
 * gets one hub link rather than three filled from somewhere else.
 */
export function hubsFor(tags: string[] | undefined, hubs: Map<string, Hub>): Hub[] {
  const seen = new Set<string>();
  const out: Hub[] = [];
  for (const tag of tags ?? []) {
    const slug = slugify(tag);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const hub = hubs.get(slug);
    if (hub) out.push(hub);
  }
  return out.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

