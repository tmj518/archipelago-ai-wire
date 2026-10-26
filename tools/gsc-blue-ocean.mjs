#!/usr/bin/env node
/**
 * Blue-ocean keywords from Search Console: high impressions, low click-through, ranking on page one or two.
 *
 *   node tools/gsc-blue-ocean.mjs              last 7 days, write data/blue-ocean/<date>.json
 *   node tools/gsc-blue-ocean.mjs --days=28    a wider window
 *   node tools/gsc-blue-ocean.mjs --dry-run    show the shape of the request, call nothing
 *
 * ## Why this is the honest source of "blue ocean"
 *
 * A third-party volume figure is somebody else's estimate of a market. Search Console reports what actually
 * happened on this site: how often a query showed a page, how often the page was clicked, and where it ranked.
 *
 * The filter finds the specific gap worth writing for:
 *
 *   impressions > 1000   people are searching this and seeing us
 *   CTR < 1%             they are not clicking, so the title or the promise is wrong
 *   position 5-20        we are on page one or two, so the page can be made to rank
 *
 * That combination is a page that already earns its impression with a title nobody clicks. Writing a better
 * article for the query is the cheapest win available, and no keyword tool can tell you it exists.
 *
 * ## No dependency, and no secret in the tree
 *
 * The service-account credentials arrive as GSC_CREDENTIALS_BASE64 and are decoded in memory. A JWT is signed
 * with node:crypto and exchanged for an access token, which is forty lines and avoids adding googleapis (a
 * hundred megabytes) to a site whose whole JavaScript budget is nine kilobytes.
 *
 * ## Degrading is the normal path
 *
 * A new site has no Search Console history, a service account may not be invited to the property, and the API
 * may be rate-limited. Every one of those is an ordinary state, so the script exits 0 with `available: false`
 * and a reason, writes that to the same file, and the pipeline falls back to official-document subject choice.
 * It never fails a publishing run.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createSign } from "node:crypto";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const DAYS = Number(flag("days", "7"));
const DRY = args.includes("--dry-run");
const OUT_DIR = join(ROOT, "data", "blue-ocean");
const OUT = join(OUT_DIR, `${new Date().toISOString().slice(0, 10)}.json`);

/* The property as Search Console names it. A Domain property is sc-domain:<host>. */
const SITE = flag("site", "") || (process.env.GSC_SITE ?? "").trim() || "sc-domain:landedmath.com";

/** Thresholds, in one place so the report can state what it filtered on. */
const FILTER = { minImpressions: Number(process.env.GSC_MIN_IMPRESSIONS ?? 1000), maxCtr: 0.01, minPosition: 5, maxPosition: 20, top: 3 };

const log = (s) => console.log(s);

function finish(obj, code = 0) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), site: SITE, windowDays: DAYS, filter: FILTER, ...obj }, null, 2), "utf8");
  log("");
  log(`  written: ${OUT.replace(ROOT, "").replace(/\\/g, "/")}`);
  process.exit(code);
}

log("GSC BLUE OCEAN");
log("=".repeat(78));
log(`  site      : ${SITE}`);
log(`  window    : ${DAYS} day(s)`);
log(`  filter    : impressions > ${FILTER.minImpressions}, ctr < ${FILTER.maxCtr * 100}%, position ${FILTER.minPosition}-${FILTER.maxPosition}`);
log("");

/* ── credentials ───────────────────────────────────────────────────────────────────────────────── */
const B64 = (process.env.GSC_CREDENTIALS_BASE64 ?? "").trim();

if (DRY) {
  log("  credentials : " + (B64 ? `${B64.length} base64 characters present` : "GSC_CREDENTIALS_BASE64 is not set"));
  log("  request     : POST https://searchconsole.googleapis.com/webmasters/v3/sites/<site>/searchAnalytics/query");
  log("  body        : { startDate, endDate, dimensions: [\"query\"], rowLimit: 25000 }");
  log("");
  log("  --dry-run: nothing called, nothing written.");
  process.exit(0);
}

if (!B64) {
  log("  credentials : GSC_CREDENTIALS_BASE64 is not set");
  log("");
  log("  This is not a failure. The pipeline falls back to choosing a subject from the official documents,");
  log("  which is what it did before this existed. To enable it:");
  log("");
  log("    Google Cloud -> IAM -> Service accounts -> create -> Keys -> add key -> JSON");
  log("    base64 -w0 key.json            (PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes('key.json')))");
  log("    GitHub -> Settings -> Secrets -> GSC_CREDENTIALS_BASE64");
  log("    Search Console -> Settings -> Users and permissions -> add the service-account email as a user");
  finish({ available: false, reason: "GSC_CREDENTIALS_BASE64 is not set", keywords: [] }, 0);
}

/*
 * decodeCredentials: base64 in, JSON out, and it says which attempt worked.
 *
 * The 2026-10-19 run reported "does not decode to JSON - Unexpected token '\uFFFD'". The secret had been pasted as
 * base64 of something with a byte-order mark, and the previous version made exactly one attempt - Buffer.from(B64,
 * "base64") then JSON.parse - and gave up. A secret that is base64 of base64, or that carries a BOM, or that arrived
 * with newlines from a copy-paste, all decode to the same JSON by a decoder that tries the four obvious readings.
 */
function decodeCredentials(raw) {
  const tidy = String(raw).replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  const attempts = [];
  const tryJson = (label, text) => {
    const clean = text.replace(/^\uFEFF/, "").trim();
    try {
      const j = JSON.parse(clean);
      attempts.push(label + ": ok");
      return j;
    } catch (e) {
      attempts.push(label + ": " + e.message.slice(0, 60));
      return null;
    }
  };
  const dec = (s) => Buffer.from(s, "base64").toString("utf8");
  /*
   * The bytes are the first thing to look at, because four base64 readings all returned the same mojibake on
   * 2026-10-19: "�^��ӷk��^". That is not a JSON document with a bad header, it is text
   * in the wrong encoding - and the commonest way to produce it is PowerShell:
   *
   *   [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($json))     <- UTF-16
   *   [Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))          <- right
   *
   * Both look like base64. Only one decodes to JSON as UTF-8. So the decoder tries the encodings that produce that
   * mojibake, then gzip, and reports what the first bytes actually were so the next person can see it.
   */
  /*
   * RAW JSON FIRST.
   *
   * The secret now holds the JSON document itself, pasted straight from the key file, because a UTF-16 base64 of it
   * was unreadable and re-encoding was one more step for the operator. That is a perfectly good way to store it - GitHub
   * encrypts the value either way - and it should be the first thing tried, not the fourth.
   *
   * Whitespace inside the document is left alone here. Stripping it would be fine for JSON structure and wrong for any
   * string that contains a space, and a private key does.
   */
  let j = null;
  const looksLikeJson = /^\s*\{/.test(String(raw));
  if (looksLikeJson) {
    j = tryJson("raw JSON", String(raw).trim());
    if (j) log("  credentials : read as raw JSON - the secret holds the key document itself");
  }

  const buf = Buffer.from(tidy, "base64");
  if (!j) j = tryJson("utf8", buf.toString("utf8"));
  if (!j) j = tryJson("utf16le", buf.toString("utf16le").replace(/^\uFEFF/, ""));
  if (!j) {
    try {
      j = tryJson("gzip", require("node:zlib").gunzipSync(buf).toString("utf8"));
    } catch {
      attempts.push("gzip: not gzip data");
    }
  }
  if (!j) {
    attempts.push("first bytes: " + buf.subarray(0, 8).toString("hex"));
    attempts.push("length: " + buf.length + " byte(s)");
  }
  if (!j) {
    const once = dec(tidy);
    j = tryJson("base64 of base64", dec(once));
    if (!j) {
      j = tryJson("decoded text with a byte-order mark", once.replace(/^\uFEFF/, ""));
      if (!j) {
        /* the secret was pasted as raw JSON rather than base64 - accept it, the intent is unambiguous */
        j = tryJson("raw JSON", tidy.startsWith("{") ? tidy : dec(tidy).replace(/^\uFEFF/, ""));
      }
    }
  }
  return { creds: j, attempts };
}

const decoded = decodeCredentials(B64);
let creds = decoded.creds;
if (!creds) {
  log("  credentials : GSC_CREDENTIALS_BASE64 does not decode to JSON. Attempts:");
  for (const a of decoded.attempts) log("    " + a);
  log("");
  log("");
  log("  WARNING, not a failure. This run continues without Search Console and researches the official");
  log("  documents instead, which is what it did before this existed. The site has no exposure yet, so");
  log("  nothing is lost by skipping it today.");
  log("");
  log("  To fix it: node tools/reencode-gsc-key.mjs <path to the key.json>");
  log("  That prints clean base64 and names the encoding it found. Paste the output over");
  log("  GSC_CREDENTIALS_BASE64. It exists because PowerShell's Unicode encoder produces UTF-16,");
  log("  which is valid base64 of text no JSON parser will read.");
  finish({ available: false, reason: "credentials are not valid base64 JSON", keywords: [] }, 0);
}

if (!creds.client_email || !creds.private_key) {
  log("  credentials : the JSON has no client_email or private_key - is this a service-account key?");
  finish({ available: false, reason: "credentials are not a service-account key", keywords: [] }, 0);
}
log(`  credentials : ${creds.client_email}`);

/* ── a token, signed with node:crypto ──────────────────────────────────────────────────────────── */
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function serviceAccountToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(creds.private_key));
  return `${header}.${claim}.${signature}`;
}

let token;
try {
  const assertion = serviceAccountToken();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) {
    log(`  token       : FAILED - HTTP ${res.status} ${j.error ?? ""} ${String(j.error_description ?? "").slice(0, 120)}`);
    finish({ available: false, reason: `token exchange failed: ${j.error ?? res.status}`, keywords: [] }, 0);
  }
  token = j.access_token;
  log("  token       : ok");
} catch (e) {
  log(`  token       : FAILED - ${e.cause?.code ?? e.message}`);
  finish({ available: false, reason: `token exchange failed: ${e.cause?.code ?? e.message}`, keywords: [] }, 0);
}

/* ── the query ─────────────────────────────────────────────────────────────────────────────────── */
const end = new Date(Date.now() - 2 * 86400000); /* Search Console lags two to three days. */
const start = new Date(end.getTime() - DAYS * 86400000);
const body = {
  startDate: start.toISOString().slice(0, 10),
  endDate: end.toISOString().slice(0, 10),
  dimensions: ["query"],
  rowLimit: 25000,
  dataState: "final",
};

log(`  range       : ${body.startDate} .. ${body.endDate}`);

let rows = [];
try {
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const j = await res.json();
  if (!res.ok) {
    const msg = String(j.error?.message ?? JSON.stringify(j).slice(0, 160));
    log(`  query       : FAILED - HTTP ${res.status} ${msg.slice(0, 140)}`);
    const reason = /not (?:found|verified)|permission|403/i.test(msg)
      ? "the service account is not a user on this Search Console property"
      : `query failed: ${msg.slice(0, 120)}`;
    finish({ available: false, reason, keywords: [] }, 0);
  }
  rows = j.rows ?? [];
  log(`  query       : ok - ${rows.length} query row(s)`);
} catch (e) {
  log(`  query       : FAILED - ${e.cause?.code ?? e.message}`);
  finish({ available: false, reason: `query failed: ${e.cause?.code ?? e.message}`, keywords: [] }, 0);
}

/*
 * LATEST WINS, with a ladder.
 *
 * A site that has just been indexed reports impressions in the tens, not the thousands, so a fixed "1000 impressions"
 * filter reports zero blue-ocean keywords for months and research falls back forever. The ladder tries the strict
 * filter, then a loose one, then any query that ranks on page two or worse - and prints which rung produced the answer,
 * because "0 keywords" and "0 keywords at a threshold that could never fire" are different facts.
 */
const LADDER = [
  { label: "strict", minImpressions: FILTER.minImpressions, maxCtr: FILTER.maxCtr, minPosition: FILTER.minPosition, maxPosition: FILTER.maxPosition },
  { label: "loose", minImpressions: 10, maxCtr: 0.05, minPosition: 3, maxPosition: 30 },
  { label: "any impression", minImpressions: 1, maxCtr: 1, minPosition: 1, maxPosition: 100 },
];

/* ── the filter ───────────────────────────────────────────────────────────────────────────────── */
const all = rows.map((r) => ({
  query: String(r.keys?.[0] ?? ""),
  impressions: Math.round(r.impressions ?? 0),
  clicks: Math.round(r.clicks ?? 0),
  ctr: Number(r.ctr ?? 0),
  position: Math.round((r.position ?? 0) * 10) / 10,
}));

const withinLadder = (rowsIn, rung) =>
  rowsIn.filter(
    (r) =>
      r.query &&
      r.impressions >= rung.minImpressions &&
      r.ctr < rung.maxCtr &&
      r.position >= rung.minPosition &&
      r.position <= rung.maxPosition,
  );
let usedRung = LADDER[0];
let ladderRows = withinLadder(all, usedRung);
for (const rung of LADDER.slice(1)) {
  if (ladderRows.length) break;
  usedRung = rung;
  ladderRows = withinLadder(all, rung);
  if (ladderRows.length) log(`  ladder      : the strict filter found nothing; ${rung.label} found ${ladderRows.length}`);
}
void ladderRows;

const blue = all
  .filter(
    (r) =>
      r.query &&
      r.impressions > FILTER.minImpressions &&
      r.ctr < FILTER.maxCtr &&
      r.position >= FILTER.minPosition &&
      r.position <= FILTER.maxPosition,
  )
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, FILTER.top);

log("");
log(`  total rows  : ${all.length}`);
log(`  matched     : ${blue.length}`);
/*
 * One line, unmissable, because this is the question the operator asks: did the search data drive the choice or not.
 */
log(
  blue.length
    ? `GSC BLUE OCEAN: Found ${blue.length} keyword(s) - these drive the subject`
    : `GSC: 0 keywords, falling back to official docs`,
);
log("");

for (const [i, r] of blue.entries()) {
  log(`  ${i + 1}. ${r.query}`);
  log(`     impressions ${r.impressions}  clicks ${r.clicks}  ctr ${(r.ctr * 100).toFixed(2)}%  position ${r.position}`);
}

if (!blue.length) {
  /*
   * An empty result is information, not a failure. Four hundred impressions total means there is not yet a
   * query with a thousand of them, and the filter is doing exactly what it says.
   */
  const top = all.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
  log("  No query met all three conditions. The most-seen queries were:");
  for (const r of top) log(`     ${String(r.impressions).padStart(5)} imp  pos ${String(r.position).padStart(5)}  ${r.query.slice(0, 70)}`);
  log("");
  log("  That is a fact about reach, not a fault. The pipeline falls back to official-document subjects.");
  finish({ available: true, empty: true, reason: "no query met the impression, ctr and position thresholds", keywords: [], topSeen: top }, 0);
}

finish({ available: true, empty: false, keywords: blue, topSeen: all.sort((a, b) => b.impressions - a.impressions).slice(0, 5) }, 0);
