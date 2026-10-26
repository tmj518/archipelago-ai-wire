#!/usr/bin/env node
/**
 * Tell the search engines that a URL changed.
 *
 * ## What is possible, and what is not
 *
 * There is no public Google API for submitting an ordinary article for indexing. The
 * Indexing API exists and accepts only two types - JobPosting and BroadcastEvent - and Google's
 * documentation says explicitly that using it for other content is against its terms. A tool
 * that "submits to Google" for a blog post either does not do that or is doing something the
 * site could be penalised for. This one does not.
 *
 * What does exist:
 *
 *   IndexNow   A shared endpoint Bing and Yandex run. One POST with a key and a URL list, no
 *              account, no OAuth. This is the only real-time submission channel available to a
 *              static site, and it is the reason this script exists.
 *   Sitemap    For Google. The site's sitemap now carries an accurate `lastmod` on every URL,
 *              which is Google's documented way to learn that a page changed without being
 *              asked to fetch it. Google's sitemap ping endpoint was retired in 2023, so the
 *              file simply has to be found, which robots.txt already declares.
 *
 * So the daily run does three things and no more: it refreshes the sitemap dates, it pings
 * IndexNow for whatever changed, and it records what it did. Anything else would be claiming a
 * channel that does not exist.
 *
 * ## Usage
 *
 *   node tools/submit-urls.mjs --changed        submit URLs whose lastmod is today
 *   node tools/submit-urls.mjs --url=/brief/    submit one path
 *   node tools/submit-urls.mjs --dry-run        report without sending
 *
 * The key file lives at `public/<key>.txt` and contains the key itself, which is how IndexNow
 * verifies ownership: the endpoint fetches that URL and compares. `INDEXNOW_KEY` overrides it.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SITEMAP = join(ROOT, "dist", "sitemap-0.xml");
const LOG_DIR = join(ROOT, "logs");
const LOG = join(LOG_DIR, "submissions.jsonl");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const EXPLICIT = args.filter((a) => a.startsWith("--url=")).map((a) => a.slice(6));

/** The IndexNow key: from the environment, or from the key file already in public/. */
function indexNowKey() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY;
  const pub = join(ROOT, "public");
  if (!existsSync(pub)) return null;
  for (const f of readdirSync(pub)) {
    const m = /^([a-f0-9]{8,128})\.txt$/i.exec(f);
    if (m) return m[1];
  }
  return null;
}

/** Read the sitemap and return [{ url, lastmod }]. */
function readSitemap() {
  if (!existsSync(SITEMAP)) return [];
  const xml = readFileSync(SITEMAP, "utf8");
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    url: /<loc>([^<]+)<\/loc>/.exec(m[1])?.[1] ?? "",
    lastmod: /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])?.[1] ?? null,
  })).filter((u) => u.url);
}

const today = new Date().toISOString().slice(0, 10);
const entries = readSitemap();

let targets;
if (EXPLICIT.length) {
  targets = EXPLICIT.map((p) => ({ url: `https://landedmath.com${p}`, lastmod: today }));
} else if (args.includes("--changed")) {
  // Anything whose content date is today. This is what the daily run submits: an article
  // published today, or one corrected today.
  targets = entries.filter((e) => e.lastmod === today);
} else {
  targets = [];
}

console.log("SUBMISSION\n" + "=".repeat(74));
console.log(`  sitemap entries        : ${entries.length}`);
console.log(`  with a lastmod of today: ${entries.filter((e) => e.lastmod === today).length}`);
console.log(`  to submit this run     : ${targets.length}`);
for (const t of targets) console.log(`     ${t.lastmod ?? "-"}  ${t.url}`);

if (!targets.length) {
  console.log("\n  nothing changed today; nothing to submit.");
  console.log("  (Google is not pinged here - see the header. The sitemap carries the date.)");
  process.exit(0);
}

const key = indexNowKey();
if (!key) {
  console.log("\n  IndexNow key not configured, so nothing was sent.");
  console.log("  To enable real-time submission to Bing and Yandex:");
  console.log("    1. generate a key:  node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\"");
  console.log("    2. write it to public/<key>.txt containing exactly that key");
  console.log("    3. set INDEXNOW_KEY to the same value");
  console.log("  Until then the sitemap is doing the work for every engine.");
  process.exit(0);
}

const payload = {
  host: "landedmath.com",
  key,
  keyLocation: `https://landedmath.com/${key}.txt`,
  urlList: targets.map((t) => t.url),
};

console.log(`\n  endpoint : https://api.indexnow.org/indexnow`);
console.log(`  key file : ${payload.keyLocation}`);
console.log(`  urls     : ${payload.urlList.length}`);

let status = 0;
let body = "";
if (DRY) {
  console.log("\n  --dry-run: not sent");
} else {
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    status = r.status;
    body = (await r.text()).slice(0, 200);
    // 200 = accepted, 202 = accepted pending key verification. Both are success.
    console.log(`\n  response : HTTP ${status} ${status === 200 ? "(accepted)" : status === 202 ? "(accepted, key pending)" : "(see body)"}`);
    if (body) console.log(`  body     : ${body}`);
  } catch (e) {
    status = -1;
    body = e.cause?.code ?? e.message;
    console.log(`\n  request failed: ${body}`);
  }
}

/* Record it, so "did the automation run" is answerable without reading a transcript. */
try {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(
    LOG,
    JSON.stringify({
      at: new Date().toISOString(),
      event: "indexnow",
      status,
      dryRun: DRY,
      urls: payload.urlList,
      note: status === 200 || status === 202 ? "accepted" : body,
    }) + "\n",
    { flag: "a" },
  );
  console.log(`  logged to ${LOG.replace(ROOT, ".")}`);
} catch {
  /* a log that cannot be written is not worth failing the run over */
}

process.exit(status === 200 || status === 202 || DRY || status === 0 ? 0 : 1);
