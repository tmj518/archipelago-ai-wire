#!/usr/bin/env node
/**
 * Keyword miner for the sourcing silo.
 *
 * One run = one complete mining round. No manual input, every parameter has a
 * default, and re-running on the same day is a no-op.
 *
 * Sources, and the role each one plays — this division was decided explicitly
 * after measuring all three from this machine:
 *
 *   Google Suggest   discovery. Free, no key, returned real US long-tails in
 *                    testing. There is no official API; the endpoint is the
 *                    one the browser autocomplete uses.
 *   Bing Webmaster   discovery + the only absolute volume figure available.
 *                    `GetKeywordStats` needs an API key.
 *   Search Console   validation ONLY, never discovery. It reports queries the
 *                    site already has impressions for, so it cannot propose a
 *                    new keyword. On a new site it returns nothing for months,
 *                    which is a normal state and not a failure.
 *
 * Google Trends is deliberately absent. It has no official API and returned
 * HTTP 429 here; pytrends is a scraper and would report a degraded batch most
 * weeks.
 *
 * HTTP goes through curl.exe rather than node fetch, for one reason: curl
 * reads %USERPROFILE%\.curlrc, which carries the local proxy and
 * ssl-no-revoke. Node's fetch honours neither, and this machine cannot reach
 * Google or Bing without them.
 *
 * Usage
 *   node tools/keyword-miner.mjs                 # full run, 100 words
 *   node tools/keyword-miner.mjs --limit=10      # pilot: 10 words
 *   node tools/keyword-miner.mjs --dry-run       # discover and score, write nothing
 *   node tools/keyword-miner.mjs --force         # re-run despite today's file
 *   node tools/keyword-miner.mjs --dump-raw      # save raw API responses
 *   node tools/keyword-miner.mjs --seeds         # print the seed list and exit
 *
 * Credentials live in .env.keywords at the repository root (gitignored):
 *   BING_API_KEY=...
 *   GSC_CREDENTIALS=C:\path\to\service-account.json
 *   GSC_SITE_URL=sc-domain:example.com
 *   FEISHU_WEBHOOK=            # left empty until scheduling is switched on
 */

import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

/**
 * Synchronous sleep. A `setTimeout` in a child node process does not block:
 * the process exits immediately and the retry fires with no delay at all.
 * Atomics.wait on a throwaway buffer is the only real sync sleep available.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "data", "keywords");
const ENV_FILE = join(ROOT, ".env.keywords");
const BLOG_DIR = join(ROOT, "src", "content", "blog");

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const a = {
    limit: 100,
    maxCandidates: 400,
    seedLimit: 20,
    retries: 4,
    dryRun: false,
    force: false,
    dumpRaw: false,
    seedsOnly: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--force") a.force = true;
    else if (arg === "--dump-raw") a.dumpRaw = true;
    else if (arg === "--seeds") a.seedsOnly = true;
    else if (arg.startsWith("--limit=")) a.limit = parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--seed-limit=")) a.seedLimit = parseInt(arg.slice(13), 10);
    else if (arg.startsWith("--retries=")) a.retries = parseInt(arg.slice(10), 10);
    else if (arg.startsWith("--max-candidates=")) a.maxCandidates = parseInt(arg.slice(17), 10);
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv);

// ------------------------------------------------------------------ logging

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const DATE = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const STAMP = `${DATE}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const ISO_DATE = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

mkdirSync(OUT_DIR, { recursive: true });
const LOG_PATH = join(OUT_DIR, `run_${DATE}.log`);

const metrics = {
  started: Date.now(),
  bingCalls: 0,
  suggestCalls: 0,
  gscCalls: 0,
  retries: 0,
  failures: 0,
  /** Per-call failures during discovery; set by expand(). */
  googleFails: 0,
  bingSuggestFails: 0,
  /** True when the shortlist order carries no signal. See the sort above. */
  rankingDegenerate: false,
  degraded: [],
};

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n", "utf8");
}

function logStep(name, fn) {
  const t0 = Date.now();
  const result = fn();
  log(`  step ${name}: ${Date.now() - t0} ms`);
  return result;
}

/** Write the failure marker the spec requires, then exit non-zero. */
function bail(reason) {
  const marker = join(OUT_DIR, `keywords_${STAMP}.failed`);
  const detail = [
    `run: ${STAMP}`,
    `reason: ${reason}`,
    `metrics: ${JSON.stringify(metrics)}`,
    "",
    "No CSV was written. Fix the cause and re-run; a same-day re-run is only",
    "blocked when a successful CSV for that day already exists.",
  ].join("\n");
  writeFileSync(marker, detail, "utf8");
  log(`FAILED: ${reason}`);
  log(`marker written: ${marker}`);
  process.exit(1);
}

// -------------------------------------------------------------- credentials

function loadEnv() {
  const env = { ...process.env };
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();

// -------------------------------------------------------------- http via curl

/**
 * curl reads .curlrc, which carries the proxy and ssl-no-revoke. node fetch
 * reads neither, and Google and Bing are unreachable here without both.
 */
function httpGet(url, { accept = "application/json", timeout = 30, ua } = {}) {
  const cmd = [
    "-4", "-sS", "--max-time", String(timeout),
    "-H", `Accept: ${accept}`,
    "-A", ua || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "-w", "\n%{http_code}",
    url,
  ];
  const raw = execFileSync("curl.exe", cmd, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const idx = raw.lastIndexOf("\n");
  const body = raw.slice(0, idx);
  const status = parseInt(raw.slice(idx + 1).trim(), 10);
  return { status, body };
}

/**
 * Retries with backoff. Not optional here: the proxy path drops 25-50% of
 * requests, so a single attempt per call loses a large share of the batch.
 * `attempts` defaults to args.retries so --retries reaches every caller.
 */
function getWithRetry(url, opts = {}, attempts = args.retries) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = httpGet(url, opts);
      if (r.status >= 200 && r.status < 300) return r;
      if (r.status === 429) {
        lastErr = new Error(`HTTP 429 rate limited`);
      } else if (r.status >= 400 && r.status < 500) {
        // A 4xx will not fix itself on retry, except 429.
        return r;
      } else {
        lastErr = new Error(`HTTP ${r.status}`);
      }
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts) {
      metrics.retries++;
      sleepSync(i * 1500);
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------ google suggest

/** No official API. This is the endpoint the browser autocomplete calls. */
function suggest(seed, { gl = "us", hl = "en" } = {}) {
  metrics.suggestCalls++;
  const url =
    "https://suggestqueries.google.com/complete/search?client=firefox" +
    `&q=${encodeURIComponent(seed)}&hl=${hl}&gl=${gl}`;
  const r = getWithRetry(url, { accept: "application/json" });
  if (r.status !== 200) throw new Error(`suggest HTTP ${r.status}`);
  let parsed;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    throw new Error("suggest returned non-JSON");
  }
  const list = Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : [];
  return list.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
}

// --------------------------------------------------------------- bing stats

/**
 * Bing GetKeywordStats. The response shape is not documented in a form I could
 * verify, so field names are probed and the raw payload can be dumped with
 * --dump-raw on the first run rather than guessed at.
 */
function bingStats(keyword) {
  const key = env.BING_API_KEY;
  if (!key) return null;
  metrics.bingCalls++;
  const url =
    "https://ssl.bing.com/webmaster/api.svc/json/GetKeywordStats" +
    `?q=${encodeURIComponent(keyword)}&apikey=${encodeURIComponent(key)}`;
  const r = getWithRetry(url, { accept: "application/json" });

  if (args.dumpRaw) {
    const rawDir = join(OUT_DIR, "raw");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, `bing_${STAMP}.jsonl`), JSON.stringify({ keyword, ...r }) + "\n", {
      flag: "a",
    });
  }

  if (r.status !== 200) return null;
  let data;
  try {
    data = JSON.parse(r.body);
  } catch {
    return null;
  }
  const rows = data.d ?? data;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;

  // Probe the field names rather than assume them.
  const pick = (names) => {
    for (const n of names) if (row[n] !== undefined && row[n] !== null) return row[n];
    return null;
  };
  const volume = pick(["BroadImpression", "Impressions", "MonthlyVolume", "Volume", "SearchVolume"]);
  const competition = pick(["Competition", "CompetitionIndex", "KeywordDifficulty"]);

  return {
    volume: volume === null ? null : Number(volume),
    competition: competition === null ? null : Number(competition),
    raw: row,
  };
}

// ------------------------------------------------------- search console (GSC)

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/**
 * Service-account auth without the googleapis dependency: sign a JWT with the
 * key from the JSON file and exchange it for an access token. node:crypto does
 * RS256 natively, and googleapis would add tens of megabytes for one call.
 */
function gscAccessToken() {
  const path = env.GSC_CREDENTIALS;
  if (!path || !existsSync(path)) return null;
  const creds = JSON.parse(readFileSync(path, "utf8"));
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: iat + 3600,
      iat,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const jwt = `${signingInput}.${b64url(signer.sign(creds.private_key))}`;

  const body = `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`;
  const raw = execFileSync(
    "curl.exe",
    ["-4", "-sS", "--max-time", "30", "-X", "POST",
     "-H", "Content-Type: application/x-www-form-urlencoded",
     "-d", body, "https://oauth2.googleapis.com/token"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  if (!parsed.access_token) throw new Error(`token exchange failed: ${raw.slice(0, 200)}`);
  return parsed.access_token;
}

/**
 * Pull every query the site already ranks for, once. Querying per candidate
 * would be one API call each for a set that is usually empty on a new site.
 */
function gscQueries() {
  const site = env.GSC_SITE_URL;
  if (!site) return null;
  const token = gscAccessToken();
  if (!token) return null;

  metrics.gscCalls++;
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const payload = JSON.stringify({
    startDate: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10),
    endDate: ISO_DATE,
    dimensions: ["query"],
    rowLimit: 25000,
  });
  const raw = execFileSync(
    "curl.exe",
    ["-4", "-sS", "--max-time", "60", "-X", "POST",
     "-H", `Authorization: Bearer ${token}`,
     "-H", "Content-Type: application/json",
     "-d", payload, url],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  const set = new Set();
  for (const row of parsed.rows ?? []) {
    if (row.keys?.[0]) set.add(String(row.keys[0]).toLowerCase().trim());
  }
  return set;
}

// -------------------------------------------------------------------- seeds

/**
 * Seeds come from what the silo already covers plus a standing list, so the
 * miner grows the existing topic cluster rather than wandering.
 *
 * Tags are qualified before use. Frontmatter tags are single words ("copper",
 * "solar"), and Ask-Suggest about a bare material name returns the consumer's
 * question — the first pilot produced "cost copper iud" and "cost copper roof"
 * that way. A tag becomes "china <tag>" so the expansion stays on trade.
 */
function loadSeeds() {
  const seeds = new Set();
  const shortTags = new Set();

  for (const file of readdirSync(BLOG_DIR)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(join(BLOG_DIR, file), "utf8");
    if (!/^category:\s*"sourcing"/m.test(raw)) continue;

    const kw = /^target_keyword:\s*"(.+?)"/m.exec(raw);
    if (kw) seeds.add(kw[1].toLowerCase());

    for (const t of /^tags:\s*\[(.+?)\]/m.exec(raw)?.[1]?.split(",") ?? []) {
      const tag = t.trim().replace(/^"|"$/g, "").toLowerCase();
      if (tag.length <= 3) continue;
      // Keep multi-word tags as-is; qualify bare nouns so Suggest stays on trade.
      if (tag.includes(" ")) seeds.add(tag);
      else shortTags.add(tag);
    }
  }

  for (const t of shortTags) seeds.add(`china ${t} export`);

  // Standing seeds for the silo: the questions a buyer asks before paying.
  const standing = [
    "china supplier verification",
    "chinese factory audit",
    "china export documents",
    "china import duty",
    "chinese supplier payment terms",
    "alibaba supplier scam",
    "china trading company vs factory",
    "china product certification",
    "china export licence",
    "china customs declaration",
    "incoterms china",
    "china sample order",
  ];
  for (const s of standing) seeds.add(s);

  // A seed with no actor produces results with no actor. "tariff schedule" on
  // its own returned "tariff schedule 2026-27" and "2025-26", which are Indian
  // and Pakistani fiscal-year budget documents — a search tied to another
  // country's domestic tax calendar. Prefixing the actor keeps the expansion
  // inside this site's subject.
  const ACTORS = [
    "china", "chinese", "import", "importing", "export", "exporting",
    "supplier", "factory", "manufacturer", "alibaba", "customs", "fob",
    "cif", "incoterm", "sourcing", "wholesale",
  ];
  const qualified = new Set();
  for (const s of seeds) {
    qualified.add(ACTORS.some((a) => s.includes(a)) ? s : `china ${s}`);
  }

  return [...qualified];
}

// ------------------------------------------------------------ candidate pool

/**
 * Two independent discovery engines on purpose.
 *
 * This proxy path drops 25-50% of requests, and the loss is on the path rather
 * than at any one provider — measured, Bing and Cloudflare fail at similar
 * rates to Google. Two engines on different domains therefore fail
 * independently, which roughly squares the chance of losing a seed entirely.
 *
 * Role assignment follows the agreed definition of hit_count: a Bing hit and a
 * Suggest hit each score one, and GSC validation scores the third.
 */
function bingSuggest(seed, { mkt = "en-US" } = {}) {
  metrics.bingCalls++;
  const url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(seed)}&mkt=${mkt}`;
  const r = getWithRetry(url, { accept: "application/json" });
  if (r.status !== 200) throw new Error(`bing suggest HTTP ${r.status}`);
  let parsed;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    throw new Error("bing suggest returned non-JSON");
  }
  const list = Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : [];
  return list.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
}

/** Modifiers that surface intent-bearing long-tails rather than more of the same. */
const MODIFIERS = ["", "how to", "cost", "requirements"];

function expand(seeds) {
  const candidates = new Map(); // keyword -> {suggest, bing, seeds}
  const useSeeds = seeds.slice(0, args.seedLimit);
  log(`  expanding ${useSeeds.length} seeds via Google Suggest + Bing Suggest`);
  let googleFails = 0;
  let bingFails = 0;
  let rejected = 0;

  for (const seed of useSeeds) {
    if (candidates.size >= args.maxCandidates) break;
    for (const mod of MODIFIERS) {
      const q = mod ? `${mod} ${seed}` : seed;

      const record = (list, engine) => {
        for (const kw of list) {
          if (kw.length < 8 || kw.split(" ").length < 2) continue;
          if (!isRelevant(kw)) {
            rejected++;
            continue;
          }
          const entry = candidates.get(kw) ?? { suggest: false, bing: false, seeds: new Set() };
          entry[engine] = true;
          entry.seeds.add(seed);
          candidates.set(kw, entry);
        }
      };

      try {
        record(suggest(q), "suggest");
      } catch (e) {
        googleFails++;
        metrics.failures++;
        if (googleFails <= 3) log(`    google suggest failed "${q.slice(0, 40)}": ${e.message.split("\n")[0].slice(0, 60)}`);
      }
      try {
        record(bingSuggest(q), "bing");
      } catch (e) {
        bingFails++;
        metrics.failures++;
        if (bingFails <= 3) log(`    bing suggest failed "${q.slice(0, 40)}": ${e.message.split("\n")[0].slice(0, 60)}`);
      }

      if (candidates.size >= args.maxCandidates) break;
    }
  }
  log(`  ${candidates.size} candidates passed the relevance filter (rejected ${rejected}; google failures ${googleFails}, bing ${bingFails})`);
  // Publish the per-call failure counts so the end-of-run summary can report
  // them. They were local to this function, and the summary's "source failures"
  // counter only counts failures that reached a selected row — so a run with 26
  // failed suggest calls reported zero source failures and looked clean.
  metrics.googleFails = googleFails;
  metrics.bingSuggestFails = bingFails;
  return candidates;
}

// --------------------------------------------------------------- relevance

/**
 * Populated once seeds are loaded. isRelevant uses it to drop seed echoes:
 * Suggest returns the query itself as its first suggestion, and a seed is the
 * starting point rather than a finding.
 */
let seedSet = new Set();

/**
 * The pilot run made this filter necessary.
 *
 * Seeds were being taken from frontmatter tags, and tags are single words like
 * "copper", "solar", "batteries". Asking Suggest to expand a bare material
 * name returns the consumer's question, not the importer's: the first pilot
 * produced "cost copper iud", "how to rechrome" and "cost copper roof", none of
 * which belong in a sourcing silo.
 *
 * A candidate now has to contain at least one trade anchor. That keeps
 * "landed cost vs fob" and "china export duty rates" and drops everything that
 * merely shares a material noun with a seed.
 */
const ANCHORS = [
  "china", "chinese", "import", "importer", "importing", "export", "exporter",
  "exporting", "supplier", "suppliers", "vendor", "factory", "factories",
  "manufacturer", "customs", "duty", "duties", "tariff", "tariffs", "tax",
  "rebate", "fob", "cif", "incoterm", "incoterms", "sourcing", "wholesale",
  "alibaba", "shipment", "shipping", "freight", "landed", "clearance",
  "declaration", "inspection", "audit", "certification", "compliance",
  "hs code", "hts", "moq", "quotation", "procurement", "trade", "tariff code",
];

/**
 * Homographs and intent classes that pass the anchor test but do not belong.
 *
 * Four classes came out of the second pilot, each visible in its output:
 *   dictionary intent — "export duty meaning", "landed cost meaning". These
 *     are the exact pages the SERP gate already treats as junk, and a searcher
 *     after a definition is not a buyer.
 *   software products — "landed cost netsuite". A product name is not a topic.
 *   domestic rules elsewhere — "export duty in india". The searcher is in India
 *     dealing with Indian rules, not importing from China.
 *   unrelated consumer nouns — "copper iud", "copper roof".
 */
const BLOCKLIST = [
  // dictionary / translation intent
  "meaning", "definition", "define", "synonym", "pronunciation", "translate",
  "in hindi", "in urdu", "in tamil", "in telugu", "in bengali", "in marathi",
  // software and SaaS products
  "netsuite", "oracle", "quickbooks", "sap ", "erp software", "excel template",
  "shopify app", "api documentation",
  // generic consumer noise
  "iud", "rechrome", "roof", "jewelry", "jewellery", "recipe", "song",
  "lyrics", "movie", "game", "minecraft", "roblox", "wedding", "ring",
  "dental", "surgery", "ivf", "pregnant",
];

/** A searcher writing "in <country>" is asking about that country's own rules. */
const DOMESTIC_ELSEWHERE =
  /\b(in|under) (india|pakistan|bangladesh|nigeria|kenya|ghana|nepal|sri lanka|tanzania|uganda)\b/;

function isRelevant(keyword) {
  const k = keyword.toLowerCase();
  // Seeds echo back from Suggest. They are the starting point, not a finding,
  // and they are too broad to target: "export duty" and "landed cost" both
  // surfaced as candidates in the second pilot.
  if (seedSet.has(k)) return false;
  if (BLOCKLIST.some((b) => k.includes(b))) return false;
  if (DOMESTIC_ELSEWHERE.test(k)) return false;
  if (!ANCHORS.some((a) => k.includes(a))) return false;
  // Three words minimum: a two-word candidate is almost always the generic
  // head term ("export duty", "tariff schedule") rather than a long-tail.
  if (k.split(" ").length < 3) return false;
  // A trailing single letter is the tail of a truncated suggestion.
  if (/\s[a-z]$/.test(k)) return false;
  return true;
}

// ------------------------------------------------------------------- intent

const TRANSACTIONAL_ROOTS = [
  "buy", "price", "cost", "wholesale", "supplier", "suppliers", "manufacturer",
  "factory", "factories", "vendor", "quote", "quotation", "order", "fee", "fees",
  "rate", "rates", "duty", "duties", "tariff", "how much",
];

function classifyIntent(keyword) {
  const k = keyword.toLowerCase();
  return TRANSACTIONAL_ROOTS.some((r) => k.includes(r)) ? "交易" : "信息";
}

// ------------------------------------------------------------------- dedup

function seenKeywords() {
  const seen = new Set();
  for (const file of readdirSync(OUT_DIR)) {
    if (!/^keywords_\d{8}_\d{4}\.csv$/.test(file)) continue;
    const lines = readFileSync(join(OUT_DIR, file), "utf8").split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const first = line.split(",")[0].replace(/^"|"$/g, "").trim().toLowerCase();
      if (first) seen.add(first);
    }
  }

  // Site pages, so a new keyword cannot cannibalise one already targeted.
  for (const file of readdirSync(BLOG_DIR)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(join(BLOG_DIR, file), "utf8");
    const kw = /^target_keyword:\s*"(.+?)"/m.exec(raw);
    if (kw) seen.add(kw[1].toLowerCase());
  }
  return seen;
}

// --------------------------------------------------------------------- main

log(`keyword miner start  run=${STAMP}  limit=${args.limit}  dryRun=${args.dryRun}`);

// Idempotency: one successful CSV per day. --force is the documented escape.
const todays = readdirSync(OUT_DIR).filter((f) => f.startsWith(`keywords_${DATE}_`) && f.endsWith(".csv"));
if (todays.length && !args.force && !args.dryRun) {
  log(`today already mined (${todays.join(", ")}) — no-op. Use --force to override.`);
  process.exit(0);
}

const seeds = logStep("load seeds", loadSeeds);
seedSet = new Set(seeds.map((s) => s.toLowerCase()));
log(`  ${seeds.length} seeds`);

if (args.seedsOnly) {
  seeds.forEach((s) => console.log(s));
  process.exit(0);
}

const candidates = logStep("expand", () => expand(seeds));
if (candidates.size === 0) bail("no candidates discovered — Suggest returned nothing");

// Bing: volume and competition. Absence is a degraded batch, not a failure,
// but the batch is labelled so single-source data cannot masquerade as three.
let bingAvailable = true;
let gscAvailable = true;

if (!env.BING_API_KEY) {
  bingAvailable = false;
  metrics.degraded.push("bing (no BING_API_KEY)");
  log("  WARNING: BING_API_KEY not set — monthly_volume and competition will be '-'");
}

let gscSet = null;
try {
  gscSet = logStep("gsc fetch", gscQueries);
  if (gscSet === null) {
    gscAvailable = false;
    metrics.degraded.push("gsc (no credentials configured)");
    log("  note: GSC not configured — source_gsc false for every row");
  } else {
    log(`  GSC returned ${gscSet.size} queries with impressions`);
  }
} catch (e) {
  gscAvailable = false;
  metrics.degraded.push(`gsc (${e.message})`);
  log(`  WARNING: GSC failed: ${e.message}`);
}

const seen = logStep("dedup", seenKeywords);
log(`  ${seen.size} keywords already mined or targeted by a page`);

const scored = [];
let bingFailures = 0;
for (const [keyword, meta] of candidates) {
  if (seen.has(keyword)) continue;

  let stats = null;
  if (bingAvailable) {
    try {
      stats = bingStats(keyword);
    } catch (e) {
      bingFailures++;
      if (bingFailures <= 3) log(`    bing failed for "${keyword}": ${e.message}`);
    }
  }

  // A Bing hit counts whether it came from Bing Suggest or from a volume
  // figure in GetKeywordStats. An earlier version only counted the latter, so
  // with no API key configured every Bing discovery scored zero.
  const sourceBing = meta.bing || (stats !== null && stats.volume !== null);
  const sourceSuggest = meta.suggest;
  const sourceGsc = gscSet !== null && gscSet.has(keyword);

  scored.push({
    keyword,
    source_bing: sourceBing,
    source_suggest: sourceSuggest,
    source_gsc: sourceGsc,
    hit_count: [sourceBing, sourceSuggest, sourceGsc].filter(Boolean).length,
    monthly_volume: stats?.volume ?? null,
    competition: stats?.competition ?? null,
    intent: classifyIntent(keyword),
    status: "未使用",
    found_date: ISO_DATE,
    used_date: "-",
    note: "",
  });
}

if (bingFailures > 3) log(`    ...and ${bingFailures - 3} more bing failures`);

if (scored.length === 0) bail("every candidate was already mined or targeted by an existing page");

// Rank: hit count first, then volume, then shortest keyword (broader intent).
scored.sort((a, b) => {
  if (b.hit_count !== a.hit_count) return b.hit_count - a.hit_count;
  const av = a.monthly_volume ?? -1;
  const bv = b.monthly_volume ?? -1;
  if (bv !== av) return bv - av;
  return a.keyword.length - b.keyword.length;
});

// Does the ranking actually discriminate, or is it falling through to the last
// tiebreaker?
//
// hit_count is out of three, and with GSC unconfigured no row can exceed two;
// with no Bing key, monthly_volume is null for every row. When both of those
// hold, every comparison reaches `a.keyword.length - b.keyword.length`, so the
// shortlist is ordered by how short the keyword is. That is not a ranking, and
// it is not visible in any of the counters — the run reports zero failures and
// looks healthy while the output carries no signal about which keyword matters.
//
// This surfaced when the first full candidate pool was written: 395 rows at
// hit_count 1 or 2, none at 3, and 373 of them at 1.
const distinctHits = new Set(scored.map((r) => r.hit_count)).size;
const anyVolume = scored.some((r) => r.monthly_volume !== null && r.monthly_volume !== undefined);
const rankingDegenerate = distinctHits === 1 || (!anyVolume && distinctHits <= 2);

if (rankingDegenerate) {
  log("");
  log("  !! RANKING IS DEGENERATE — the shortlist order carries no signal.");
  log(`     distinct hit_count values: ${distinctHits}; volume data present: ${anyVolume}`);
  log("     Every comparison falls through to 'shorter keyword first'. Do not");
  log("     treat the top of this list as the best opportunities. To fix, supply");
  log("     BING_API_KEY (absolute volume) and GSC credentials (a third source,");
  log("     which is what lifts hit_count above 2).");
  log("");
  metrics.rankingDegenerate = true;
}

// ------------------------------------------------------------------- output

/**
 * CSV cell escaping, used by both the candidate pool and the shortlist.
 *
 * Declared before its first use, not beside the shortlist writer. `const` is not
 * hoisted in any usable sense: the pool is written earlier in the file, so
 * placing this next to the shortlist produced
 * "ReferenceError: Cannot access 'csvCell' before initialization" — twice, since
 * the first attempt simply moved it from after the pool to still-after the pool.
 */
const csvCell = (v) => {
  const s = v === null || v === undefined ? "-" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const selected = scored.slice(0, args.limit);

log(`  scored ${scored.length} candidates, selected ${selected.length}`);
const dist = {};
for (const r of selected) dist[r.hit_count] = (dist[r.hit_count] ?? 0) + 1;
log(`  hit_count distribution: ${JSON.stringify(dist)}`);

// Keep the whole scored pool, not just the twelve that made the cut.
//
// The first run of this tool scored 139 candidates and kept 12, discarding the
// other 127 permanently — they were never written anywhere, only counted in a
// log line. That is the wrong trade for a tool whose output is a list a human
// picks from: the selected twelve are ranked by hit_count, which on a degraded
// batch (no volume data, no GSC) is a weak signal, so the ranking is not
// trustworthy enough to justify throwing the rest away. A later run also only
// reports what it re-discovers, so a discarded candidate has to be found again.
//
// The pool file is a working file, not the deliverable. The CSV stays the
// fifteen-row shortlist.
const poolPath = join(OUT_DIR, `candidates_${STAMP}.csv`);
{
  const poolLines = [
    ["keyword", "hit_count", "source_bing", "source_suggest", "source_gsc",
     "monthly_volume", "competition", "intent", "seeds"].join(","),
  ];
  for (const r of scored) {
    poolLines.push([
      r.keyword, r.hit_count, r.source_bing, r.source_suggest, r.source_gsc,
      r.monthly_volume ?? "-", r.competition ?? "-", r.intent,
      [...(r.seeds ?? [])].join(" "),
    ].map(csvCell).join(","));
  }
  writeFileSync(poolPath, "\uFEFF" + poolLines.join("\n") + "\n", "utf8");
  log(`  candidate pool : ${scored.length} rows -> ${poolPath.split(/[\\/]/).pop()}`);
  log(`  shortlist      : ${selected.length} of ${scored.length} kept in the CSV`);
}

if (args.dryRun) {
  log("dry run — no shortlist written");
  console.log("\nTop 10 preview:");
  for (const r of selected.slice(0, 10)) {
    console.log(`  ${r.hit_count}  ${String(r.monthly_volume ?? "-").padStart(7)}  ${r.intent}  ${r.keyword}`);
  }
  process.exit(0);
}

// ------------------------------------------------------------------- output

const COLUMNS = [
  "keyword", "source_bing", "source_suggest", "source_gsc", "hit_count",
  "monthly_volume", "competition", "intent", "status", "found_date",
  "used_date", "note",
];


const csvPath = join(OUT_DIR, `keywords_${STAMP}.csv`);
const lines = [COLUMNS.join(",")];
for (const r of selected) {
  lines.push([
    r.keyword,
    r.source_bing, r.source_suggest, r.source_gsc,
    r.hit_count,
    r.monthly_volume ?? "-",
    r.competition ?? "-",
    r.intent, r.status, r.found_date, r.used_date, r.note,
  ].map(csvCell).join(","));
}
// BOM so Excel and WPS render the Chinese values correctly. Node parsers
// tolerate it; the dedup reader strips it by splitting on the first comma.
writeFileSync(csvPath, "\uFEFF" + lines.join("\n") + "\n", "utf8");

const degraded = metrics.degraded.length > 0;
const seconds = ((Date.now() - metrics.started) / 1000).toFixed(1);
log("");
log(`done in ${seconds}s`);
log(`  csv            : ${csvPath}`);
log(`  rows           : ${selected.length}`);
log(`  suggest calls  : ${metrics.suggestCalls}`);
log(`  bing calls     : ${metrics.bingCalls}`);
log(`  gsc calls      : ${metrics.gscCalls}`);
log(`  retries        : ${metrics.retries}`);
log(`  source failures: ${metrics.failures + bingFailures}`);
// Per-call failures were invisible in the first run. The summary reported
// "source failures: 0" while the log carried 26 individual "suggest failed"
// lines, because this counter only tallies failures that reached a selected
// row. A batch can therefore look clean while a quarter of its seeds never
// answered, and the row count alone does not reveal it. Report both.
log(`  call failures  : google ${metrics.googleFails}, bing suggest ${metrics.bingSuggestFails},` +
    ` bing stats ${bingFailures}`);
log(`  calls made     : suggest ${metrics.suggestCalls}, bing ${metrics.bingCalls}`);
if (metrics.googleFails > 0 || metrics.bingSuggestFails > 0) {
  log("  NOTE: individual discovery calls failed and were retried a limited number");
  log("  of times. Expansions for those queries are missing from the pool, so a");
  log("  re-run will surface candidates this run never saw. This is a partial");
  log("  batch, not a clean one, even when every selected row looks complete.");
}
log(`  DEGRADED       : ${degraded ? metrics.degraded.join("; ") : "no — all three sources answered"}`);
if (metrics.rankingDegenerate) {
  log("  DEGRADED       : ranking is degenerate — see the warning above. The");
  log("                   shortlist is ordered by keyword length, not by demand.");
}
if (degraded) {
  log("  This batch is marked degraded. hit_count is out of 3 but the missing");
  log("  source contributes 0 to every row, so cross-source ranking is not");
  log("  comparable with a non-degraded batch.");
}

// Placeholder for the scheduling step. Left empty on purpose: the spec says to
// wire notification only after the manual runs are stable for 2-3 weeks.
if (env.FEISHU_WEBHOOK) {
  log("  feishu webhook configured, notification not yet implemented");
}
