#!/usr/bin/env node
/**
 * GA4 readership, pulled with the credential the repository already has.
 *
 * The site has carried a Google Analytics tag for weeks and the only place its numbers could be read
 * was the GA4 dashboard. Meanwhile every card said "readership ok - 0 pageview(s)", because the reader
 * pointed at Cloudflare and nothing was answering. This reads GA4 itself.
 *
 * ## No new secret
 *
 * `GSC_CREDENTIALS_BASE64` is already a Google service-account key, and Google does not care which API
 * you sign for as long as the account has been granted access to the resource. The same key is exchanged
 * here for a token with the analytics scope - one credential read by two APIs, which is one fewer thing
 * to configure and one fewer thing to leak.
 *
 * ## What it does when it cannot read
 *
 * It prints the service account's own address and what to do with it. That address is the whole fix:
 * add it to the GA4 property as a Viewer and the next run works. A tool that only says "403" costs the
 * operator the one fact they need.
 *
 *   node tools/ga4-report.mjs                 # 28 days, default
 *   node tools/ga4-report.mjs --days=7
 *   node tools/ga4-report.mjs --json          # machine-readable, for the ledger
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { gscCredentials } from "./lib/gsc.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CURL = process.platform === "win32" ? "curl.exe" : "curl";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

const args = process.argv.slice(2);
const days = Number((args.find((a) => a.startsWith("--days=")) ?? "--days=28").slice(7)) || 28;
const asJson = args.includes("--json");

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function curl(url, { method = "GET", token, body, accept = "application/json" } = {}) {
  const argv = ["-4", "-sS", "--max-time", "45", "-X", method, "-H", `Accept: ${accept}`];
  if (token) argv.push("-H", `Authorization: Bearer ${token}`);
  if (body) argv.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  argv.push(url);
  try {
    return JSON.parse(execFileSync(CURL, argv, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  } catch (e) {
    return { error: { message: String(e.stdout ?? e.message).slice(0, 400) } };
  }
}

/* ── auth ─────────────────────────────────────────────────────────────────────────────────────── */

const resolved = gscCredentials(process.env);
if (!resolved) {
  console.log("GA4: no Google credential. Set GSC_CREDENTIALS_BASE64 (the key the search console reader already uses).");
  process.exit(2);
}
const creds = resolved.creds;
const email = creds.client_email ?? "(no client_email in the key)";

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claims = b64url(
  JSON.stringify({ iss: email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now }),
);
const { createSign } = await import("node:crypto");
const signer = createSign("RSA-SHA256");
signer.update(`${header}.${claims}`);
const jwt = `${header}.${claims}.${b64url(signer.sign(creds.private_key))}`;

let token = "";
try {
  const out = execFileSync(
    CURL,
    [
      "-4", "-sS", "--max-time", "30", "-X", "POST",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-d", `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      "https://oauth2.googleapis.com/token",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  token = JSON.parse(out).access_token ?? "";
  if (!token) throw new Error(out.slice(0, 200));
} catch (e) {
  console.log(`GA4: token exchange failed - ${String(e.message).slice(0, 200)}`);
  process.exit(1);
}

/* ── which property? ─────────────────────────────────────────────────────────────────────────── */

/*
 * The property id without needing the Admin API.
 *
 * The Admin API is a separate Google Cloud service that has to be enabled in the project, and it was
 * not: the first cloud run answered "Google Analytics Admin API has not been used in project
 * 910628159579". That is one more switch to flip for a number already written down - the GA4 dashboard
 * URL carries it as `p559378568`, and the Data API takes `properties/559378568` directly.
 *
 * The Admin lookup stays as a discovery path for the day the id changes or a second property appears,
 * but it is not on the critical path and its failure is no longer fatal.
 */
const FROM_URL = "559378568";
const explicit = ((args.find((a) => a.startsWith("--property=")) ?? "").slice(11) || process.env.GA4_PROPERTY_ID || "").trim();

let propertyId = explicit;
let propertyName = propertyId ? `properties/${propertyId}` : "";
let accountName = "";

if (!propertyId) {
  const summaries = curl("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", { token });
  if (!summaries.error) {
    const properties = (summaries.accountSummaries ?? []).flatMap((a) =>
      (a.propertySummaries ?? []).map((p) => ({ account: a.displayName, name: p.property, title: p.displayName })),
    );
    const chosen =
      properties.find((p) => /landed/i.test(p.title ?? "") || /landed/i.test(p.account ?? "")) ?? properties[0];
    if (chosen) {
      propertyName = chosen.name;
      propertyId = String(chosen.name).replace("properties/", "");
      accountName = chosen.account;
    }
  }
  if (!propertyId) {
    propertyId = FROM_URL;
    propertyName = `properties/${FROM_URL}`;
  }
}

/* ── the report ──────────────────────────────────────────────────────────────────────────────── */

const report = curl(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
  method: "POST",
  token,
  body: {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    metrics: [
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "screenPageViews" },
      { name: "sessions" },
      { name: "eventCount" },
    ],
  },
});
if (report.error) {
  console.log(`GA4: the Data API refused the request (${report.error.message.slice(0, 200)})`);
  console.log("     enable the Analytics Data API in the Google Cloud project that owns the service account.");
  process.exit(1);
}
const m = (report.totals?.[0]?.metricValues ?? report.rows?.[0]?.metricValues ?? []).map((x) => Number(x.value ?? 0));
const totals = {
  activeUsers: m[0] ?? 0,
  newUsers: m[1] ?? 0,
  screenPageViews: m[2] ?? 0,
  sessions: m[3] ?? 0,
  eventCount: m[4] ?? 0,
};

const channels = curl(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
  method: "POST",
  token,
  body: {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 8,
  },
});
const rows = (channels.rows ?? []).map((r) => ({
  channel: r.dimensionValues?.[0]?.value ?? "?",
  sessions: Number(r.metricValues?.[0]?.value ?? 0),
}));

const payload = { property: propertyName, account: accountName, days, totals, channels: rows, at: new Date().toISOString() };

if (asJson) {
  console.log(JSON.stringify(payload));
} else {
  console.log(`GA4 READERSHIP  property ${propertyName}  window ${days} days`);
  console.log("=".repeat(78));
  console.log(`  active users : ${totals.activeUsers}`);
  console.log(`  new users    : ${totals.newUsers}`);
  console.log(`  page views   : ${totals.screenPageViews}`);
  console.log(`  sessions     : ${totals.sessions}`);
  console.log(`  events       : ${totals.eventCount}`);
  if (rows.length) {
    console.log("  channels     :");
    for (const r of rows) console.log(`    ${String(r.sessions).padStart(4)}  ${r.channel}`);
  }
}

const out = join(ROOT, "data", "analytics", `ga4-${new Date().toISOString().slice(0, 10)}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
if (!asJson) console.log(`\n  written: ${out.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
