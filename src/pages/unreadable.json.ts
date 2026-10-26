/**
 * /unreadable.json — the sources this site tried to read and could not.
 *
 * Mechanism 5 of the benchmark study: publish the method and publish what could not be read. The
 * sources page has described these failures in prose since it was written, and prose cannot be
 * cited, diffed, or checked. Serving the same record as JSON makes the claim "every figure is
 * traceable" auditable in the direction that matters most - it is easy to list what you read, and
 * the credibility is in listing what you could not.
 *
 * Served from data/unreadable.json rather than generated, because these are observations with
 * dates, not derived values. Nothing here should be recomputed at build time.
 */
import type { APIRoute } from "astro";

import unreadable from "../../data/unreadable.json";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(unreadable, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      /*
       * Same policy as the rest of the site's HTML: the browser revalidates, an intermediary may
       * hold it. This file changes only when a source is retested, so it is not worth a long TTL,
       * but it is worth being cacheable at all.
       */
      "cache-control": "public, max-age=0, s-maxage=604800, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
