#!/usr/bin/env node
/**
 * Read what people actually opened, so selection stops being a guess.
 *
 * A gate can say an article is well-formed; only readers say whether it was worth writing. This pulls
 * the last 28 days of page views per path from Cloudflare's analytics and writes them to
 * data/readership.json, which the subject chooser reads.
 *
 *   node tools/cf-analytics.mjs            # fetch and write
 *   node tools/cf-analytics.mjs --dry-run  # print only
 *
 * Needs CLOUDFLARE_API_TOKEN with Account Analytics:Read and CLOUDFLARE_ACCOUNT_ID. Without them it
 * exits 0 and says UNKNOWN rather than inventing numbers.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const dryRun = process.argv.includes("--dry-run");

/*
 * One site, one hostname. This Cloudflare account serves several projects, and an unqualified
 * analytics query would blend another site's readers into this one's numbers. The host is exact,
 * and toolsai.club belongs to a different project that must never be read here.
 */
const HOST = "www.ghiblistyled.com";
const FORBIDDEN_HOSTS = ["toolsai.club", "www.toolsai.club"];

if (FORBIDDEN_HOSTS.includes(HOST)) {
  console.log("  analytics  : refusing to read another project's host");
  process.exit(0);
}

if (!token || !account) {
  console.log("  analytics  : UNKNOWN - CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set");
  process.exit(0);
}

/* The adaptive dataset wants a full timestamp, not a date: "not an iso8601" was the error. */
const since = new Date(Date.now() - 28 * 864e5).toISOString();

/* Zone-level numbers cover the whole site; the RUM dataset only sees pages that carry the beacon. */
async function zoneId() {
  if (process.env.CLOUDFLARE_ZONE_ID) return process.env.CLOUDFLARE_ZONE_ID;
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${HOST.replace(/^www\./, "")}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`);
  const zone = (body.result ?? [])[0];
  if (!zone) throw new Error("zone not found");
  return zone.id;
}

const query = `
query($zone: String!, $since: Time!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(limit: 100, orderBy: [sum_requests_DESC]) {
        sum { requests }
        dimensions { date }
      }
      httpRequestsAdaptiveGroups(
        limit: 1000
        filter: { datetime_geq: $since }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { clientRequestPath }
      }
    }
  }
}`;

let rows = [];
try {
  const zone = await zoneId();
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { zone, since } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors?.length) {
    const why = body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(why);
  }
  const z = body.data?.viewer?.zones?.[0] ?? {};
  rows = (z.httpRequestsAdaptiveGroups ?? []).map((r) => ({ count: r.count, dimensions: { requestPath: r.dimensions?.clientRequestPath } }));
  console.log(`  total      : ${(z.httpRequests1dGroups ?? []).reduce((a, g) => a + (g.sum?.requests ?? 0), 0)} request(s) in 28 days`);
} catch (e) {
  console.log(`  analytics  : UNKNOWN - ${String(e.message).slice(0, 200)}`);
  process.exit(0);
}

const readership = {};
for (const row of rows) {
  const path = String(row.dimensions?.requestPath ?? "");
  const m = /^\/blog\/([a-z0-9-]+)\/?$/.exec(path);
  if (!m) continue;
  readership[m[1]] = (readership[m[1]] ?? 0) + Number(row.count ?? 0);
}

const articles = Object.entries(readership).sort((a, b) => b[1] - a[1]);
console.log(`  analytics  : ${articles.length} article(s) read in the last 28 days`);
for (const [slug, views] of articles.slice(0, 5)) console.log(`      ${String(views).padStart(6)}  ${slug}`);

const out = {
  note: "Page views per slug over 28 days, read from Cloudflare analytics. Empty means the query returned nothing, not that nobody reads.",
  window_days: 28,
  source: "cloudflare:rum",
  updated: new Date().toISOString().slice(0, 10),
  readership,
};

if (dryRun) {
  console.log("  dry run    : not written");
  process.exit(0);
}

const path = join(ROOT, "data", "readership.json");
if (existsSync(path)) {
  try {
    const prior = JSON.parse(readFileSync(path, "utf8"));
    if (prior?.readership && Object.keys(readership).length === 0) {
      console.log("  analytics  : query returned nothing; keeping the previous numbers");
      process.exit(0);
    }
  } catch {}
}
writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`  wrote      : data/readership.json`);
