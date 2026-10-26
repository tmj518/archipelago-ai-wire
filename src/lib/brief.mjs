/**
 * Group published posts by the day they went out, for the /brief/ archive.
 *
 * The date is the key because that is what the benchmark's archive uses and because it is
 * what makes the URL predictable. Posts are grouped by `publishDate` from their frontmatter
 * rather than by file order, so the archive cannot disagree with the articles themselves.
 *
 * `publishDate` arrives as a Date, not a string: the content schema declares it
 * `z.coerce.date()`. Astro rejects a Date as a route parameter, and interpolating one into a
 * URL produces a full timestamp, so it is normalised to `YYYY-MM-DD` here - in one place,
 * because both the index and the dated pages read this.
 *
 * Written as a module rather than inline in the page so that the index and the dated pages
 * cannot drift apart: both call this, so both see the same grouping.
 */
import { readingTime } from "./post.ts";

const EMOJI_FALLBACK = "•";

/** A Date or a date string into `YYYY-MM-DD`, in UTC so the day cannot shift by timezone. */
export function isoDay(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * @param {import("./post.ts").Post[]} posts published posts
 * @returns {{date: string, items: Array<{slug: string, title: string, category: string, description: string, minutes: number}>}[]}
 *          newest first
 */
export function briefsFor(posts) {
  const byDate = new Map();

  for (const post of posts) {
    const date = isoDay(post.data.publishDate);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      slug: post.id,
      title: post.data.title,
      category: post.data.category,
      description: post.data.description,
      minutes: readingTime(post.body),
      number: post.data.articleNumber ?? 0,
    });
  }

  return [...byDate.entries()]
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => a.number - b.number),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export { EMOJI_FALLBACK };
