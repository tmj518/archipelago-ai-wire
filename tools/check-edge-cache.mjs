/**
 * Does the edge actually cache the HTML?
 *
 * Written because a cache header on Cloudflare Pages is a necessary condition and not a sufficient
 * one. `s-maxage` says how long something may be cached, not whether it may be cached at all, and
 * Pages treats HTML as dynamic until a Cache Rule in the dashboard says otherwise. The result is a
 * header that looks correct in the source and in the response, passes every gate, and does nothing
 * - `cf-cache-status: DYNAMIC` on every request - which is worse than having no header, because it
 * invites the belief that caching is handled.
 *
 * The only evidence that counts is the status header on a second request. This asks twice and
 * reports what came back, so "the caching works" is a measurement rather than an assumption.
 *
 * It exits 0 either way. The Cache Rule is a dashboard change the operator makes, not a defect to
 * fail a health check over, and a red line here would train whoever reads it to ignore the line.
 */
const BASE = process.env.SITE_URL ?? "https://landedmath.com";
const PATHS = ["/", "/topic/landed-cost/", "/advertise/"];

const head = async (url) => {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(20000) });
    const g = (k) => r.headers.get(k) ?? "";
    return {
      status: r.status,
      cacheControl: g("cache-control"),
      cfStatus: g("cf-cache-status"),
      age: g("age"),
      hsts: g("strict-transport-security"),
      setCookie: g("set-cookie"),
    };
  } catch (e) {
    return { error: e.cause?.code ?? e.message };
  }
};

console.log(`HTML EDGE CACHE — ${BASE}\n${"=".repeat(78)}`);

let hits = 0;
let misses = 0;
let dynamic = 0;
const notes = [];

for (const p of PATHS) {
  const url = BASE + p;
  /* Twice, because the first request is the one that populates the cache. */
  const first = await head(url);
  await new Promise((x) => setTimeout(x, 1500));
  const second = await head(url + (p.includes("?") ? "&" : "?") + "cbt=" + Date.now());

  if (first.error) {
    console.log(`  ${p}\n     request failed: ${first.error}`);
    continue;
  }

  const s = second.cfStatus || first.cfStatus;
  if (/HIT|EXPIRED|REVALIDATED/i.test(s)) hits++;
  else if (/MISS/i.test(s)) misses++;
  else dynamic++;

  console.log(`  ${p}`);
  console.log(`     cf-cache-status : ${s || "(absent)"}`);
  console.log(`     age             : ${second.age || first.age || "-"}${second.age ? "s" : ""}`);
  console.log(`     cache-control   : ${second.cacheControl || "-"}`);
  console.log(`     HSTS            : ${second.hsts || "(absent)"}`);
  if (second.setCookie) notes.push(`${p} sends Set-Cookie, which blocks caching outright`);
}

console.log(`\n${"=".repeat(78)}`);
console.log(`  cached at the edge : ${hits}`);
console.log(`  MISS               : ${misses}`);
console.log(`  DYNAMIC (uncacheable by policy) : ${dynamic}`);

if (dynamic > 0 && hits === 0) {
  console.log(`
  NO EDGE CACHING. The header is correct and inert.

  Two conditions must both hold for Cloudflare to cache this HTML:
    1. The response must not carry Set-Cookie.  ${notes.length ? "FAILING" : "PASSING"}
    2. A Cache Rule in the dashboard must mark these paths as cacheable. NOT DONE - this is a
       dashboard change and cannot be made from the repository.

  The rule: Cloudflare dashboard -> Caching -> Cache Rules -> Create rule
    When incoming requests match : hostname equals landedmath.com
    Then : Eligible for cache;  Edge TTL -> "Use cache-control header if present"
  The origin's s-maxage then decides the duration, which is why the header is kept.`);
} else if (hits > 0) {
  console.log("\n  Edge caching is live. Confirmed by status header, not by reading the config.");
}
