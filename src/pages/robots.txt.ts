import type { APIContext } from "astro";

import { SITE } from "../consts";

/** Generated rather than static so the sitemap URL follows `site` config. */
export function GET({ site }: APIContext) {
  const base = (site ?? new URL(SITE.url)).href.replace(/\/$/, "");

  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${base}/sitemap-index.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
