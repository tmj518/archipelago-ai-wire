import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

import { SITE } from "../consts";
import { published } from "../lib/post";

/** Footer links to /rss.xml — this is what feeds that link. */
export async function GET(context: APIContext) {
  const posts = published(await getCollection("blog"));

  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site ?? SITE.url,
    trailingSlash: false,
    customData: "<language>en-us</language>",
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishDate,
      link: `/blog/${post.id}/`,
      categories: [post.data.category, ...post.data.tags],
    })),
  });
}
