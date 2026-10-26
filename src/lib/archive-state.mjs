/**
 * Is an archive page empty?
 *
 * One predicate, used by the three archive routes, so "empty" means the same thing everywhere and can
 * be tested without building the site. A page that lists articles, guides or topics renders `noindex`
 * when this returns true; `tools/sitemap-noindex.mjs` then removes that URL from the sitemap because
 * the built HTML says so.
 *
 * The defensive half matters as much as the obvious one: `undefined`, `null`, `NaN` and a negative
 * count all mean "no content" rather than "content". A page that crashed its way to a falsy count
 * should not become indexable by accident.
 */

/** @param {unknown} count @returns {boolean} */
export function isEmptyArchive(count) {
  const n = Number(count);
  return !Number.isFinite(n) || n <= 0;
}
