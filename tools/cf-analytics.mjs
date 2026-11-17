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
if (FORBIDDEN_HOSTS.includes(HOST)) {
  console.log("  analytics  : refusing to read another project's host");
  process.exit(0);
}

/*
 * One site, one hostname. This Cloudflare account serves several projects, and an unqualified
 * analytics query would blend another site's readers into this one's numbers. The host is exact,
 * and toolsai.club belongs to a different project that must never be read here.
 */
const HOST = "www.ghiblistyled.com";
const FORBIDDEN_HOSTS = ["toolsai.club", "www.toolsai.club"];

if (!token || !account) {
  console.log("  analytics  : UNKNOWN - CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set");
  process.exit(0);
}

const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
const query = `
query($account: String!, $since: Date!, $host: String!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      rumPageloadEventsAdaptiveGroups(
        limit: 1000
        filter: { date_geq: $since, requestHost: $host }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { requestPath }
      }
    }
  }
}`;

let rows = [];
try {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { account, since, host: HOST } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors?.length) {
    const why = body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(why);
  }
  rows = body.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
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
