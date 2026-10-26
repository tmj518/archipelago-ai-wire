import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

/**
 * The search index, built once at build time.
 *
 * ## Why an index file rather than a search service
 *
 * There are thirty-odd articles and will be a few hundred. A hosted search service is a dependency, a key, a
 * latency and a monthly bill for a corpus that fits in forty kilobytes. The whole index is fetched once, on first
 * use, and filtering it is a loop over an array.
 *
 * ## What is in it, and what is not
 *
 * Title, subtitle, description, category, date, slug, and the tags. Not the body: a body index is megabytes and
 * turns a forty-kilobyte convenience into a download. A reader searching this site wants to find the article about
 * cellulose ethers, not the paragraph in it that says ethers.
 *
 * ## Why a trimmed description rather than the whole one
 *
 * The result list shows one line. A two-hundred-character description in the index is bytes spent on text that is
 * cut at render time anyway.
 *
 * `draft: true` entries are excluded for the same reason they are excluded from the sitemap: a page that is not
 * published must not be findable.
 */
export const GET: APIRoute = async () => {
  const posts = await getCollection("blog", ({ data }) => !data.draft);

  const index = posts
    .map((p) => ({
      s: p.slug,
      t: p.data.title,
      d: String(p.data.description ?? "").slice(0, 160),
      c: p.data.category,
      n: p.data.articleNumber ?? 0,
      p: String(p.data.publishDate ?? "").slice(0, 10),
      /* Tags make a keyword search work for a subject the title words never mention. */
      g: (p.data.tags ?? []).slice(0, 6).join(" "),
    }))
    .sort((a, b) => (a.p < b.p ? 1 : a.p > b.p ? -1 : 0));

  return new Response(JSON.stringify({ at: new Date().toISOString().slice(0, 10), count: index.length, items: index }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      /* Rebuilt on every deploy, so a day of staleness is free and a revalidation per visit is not. */
      "cache-control": "public, max-age=3600",
    },
  });
};
