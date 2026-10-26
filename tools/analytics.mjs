/**
 * Pull the site's own reading data and turn it into something the writer is told.
 *
 *   node tools/analytics.mjs --fetch      # query Cloudflare, append a dated snapshot
 *   node tools/analytics.mjs --report     # print what is recorded, no network
 *   node tools/analytics.mjs --brief      # the block handed to the writer, no network
 *
 * ## Why this exists, and what was wrong before
 *
 * The pipeline decided what to write from the primary documents alone: what changed, what has not been
 * covered, what the blue-ocean score says about the competition. Nothing in that decision came from
 * whether anyone read the last thirty articles. The operator asked the question directly - a month from
 * now there will be data, so will it be recorded, analysed, and fed back to the writer - and the honest
 * answer at the time was no.
 *
 * ## The two credentials, and why one of them is not enough
 *
 * `CF_ANALYTICS_TOKEN` is the beacon's site token. It is embedded in every page's HTML and it only
 * *attributes* measurements to a site; it cannot read anything. Reading needs a Cloudflare API token
 * with Account Analytics: Read, and the account id. They are separate on purpose and the script says
 * which is missing rather than reporting an authentication failure.
 *
 * ## What is recorded
 *
 * One dated JSON file per snapshot under `data/analytics/`, append-only, in the same spirit as the
 * source manifest: a measurement that was taken is never rewritten, because the value of this data is in
 * the series, and a series whose earlier points can change is not a series.
 *
 * ## What is fed to the writer, and what is deliberately not
 *
 * The brief names the topics and categories that have actually been read, ordered by pageviews, and the
 * ones that have not been read at all. It does not say "write more like X", because with one month of
 * data and thirty articles every difference is consistent with noise, and a writer told to imitate a
 * three-pageview article will imitate nothing in particular.
 *
 * The brief therefore carries the count and the window alongside every number, so the model - and the
 * person reading the notification - can see how thin the evidence is. A feedback loop that presents
 * twenty pageviews as a finding is worse than no feedback loop, because it launders noise into an
 * instruction.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
/*
 * The snapshot directory, overridable so a check can exercise the reader without writing where the writer
 * reads.
 *
 * data/analytics is the loop's real input. A test that put a synthetic snapshot there - even briefly - would
 * be a test that can teach a concurrent run about traffic that never happened. Production never sets this;
 * tools/check-readership.mjs does, and asserts it was honoured.
 */
const DIR = (process.env.ANALYTICS_DIR ?? "").trim() || join(ROOT, "data", "analytics");
const LEDGER = join(ROOT, "data", "ledger.jsonl");

const args = process.argv.slice(2);
const MODE = args.includes("--probe") ? "probe" : args.includes("--fetch") ? "fetch" : args.includes("--brief") ? "brief" : "report";

/*
 * The account id is not a secret.
 *
 * It appears in every Cloudflare dashboard URL, it grants nothing by itself, and the API rejects a request
 * without a token whatever account it names. Defaulting it means the operator sets one value instead of two,
 * which is the difference between an integration that gets finished and one that sits half-configured.
 *
 * The API token stays a secret, stays required, and is still reported when absent.
 */
const ACCOUNT = ((process.env.CF_ACCOUNT_ID ?? "").trim() || "0f3ce61ae14d143b53fdfdba8d868df4").trim();
const TOKEN = (process.env.CF_API_TOKEN ?? "").trim();
/* The beacon token, named so the error message can explain why it is not enough. */
/*
 * The beacon token is not a secret.
 *
 * It is rendered into every page's HTML by the Web Analytics snippet - the same string is in src/consts.ts as
 * the client default, and anyone who views source on the site can read it. Requiring it as an environment
 * variable meant that with CF_API_TOKEN set and this unset, the query ran with an empty siteTag and returned
 * zero rows: a working integration that reports a site nobody reads, which is the most expensive kind of wrong
 * because it looks like an answer.
 *
 * Defaulted here for the same reason as the account id: it grants nothing, it identifies the site, and the
 * alternative is a silent zero.
 */
const BEACON = ((process.env.CF_ANALYTICS_TOKEN ?? "").trim() || "be1864c080cf47f88bd1c126a8571ede").trim();
const SITE_HOST = "landedmath.com";

/** Paths are what the ledger keys on; Cloudflare reports full URLs. */
const toPath = (u) => {
  try {
    return new URL(u).pathname;
  } catch {
    return String(u);
  }
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- fetch */

async function fetchSnapshot(days = 30) {
  if (!ACCOUNT || !TOKEN) {
    console.log("ANALYTICS - cannot fetch\n");
    console.log(`  Missing: ${[!ACCOUNT && "CF_ACCOUNT_ID", !TOKEN && "CF_API_TOKEN"].filter(Boolean).join(", ")}`);
    console.log("");
    if (BEACON) {
      console.log("  CF_ANALYTICS_TOKEN is set, and it is not what this needs. That is the beacon's site");
      console.log("  token: it is printed in every page's HTML and only attributes a measurement to a");
      console.log("  site. Reading the measurements back needs a Cloudflare API token.");
    }
    console.log("");
    console.log("  CF_ACCOUNT_ID   your account id, the hex string in the dashboard URL");
    console.log("  CF_API_TOKEN    a token with Account Analytics: Read");
    console.log("                  Cloudflare dashboard -> My Profile -> API Tokens -> Create Token");
    console.log("                  -> Read analytics for an account");
    console.log("");
    console.log("  Until then nothing is recorded, and the writer is told nothing about readership.");
    return null;
  }

  /*
   * Cloudflare's RUM dataset. The adaptive groups are what the dashboard itself uses; the counts below
   * are what the free plan exposes, and a failure here is reported rather than swallowed because a
   * silent zero is indistinguishable from a site nobody reads.
   */
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${ACCOUNT}" }) {
        rumPageloadEventsAdaptiveGroups(
          limit: 200
          filter: { date_geq: "${new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)}", siteTag: "${BEACON}" }
          orderBy: [count_DESC]
        ) {
          count
          dimensions { requestPath date countryName refererHost userAgentBrowser }
        }
      }
    }
  }`;

  let json;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query }),
    });
    json = await r.json();
    if (!r.ok || json.errors) {
      console.log(`  FAILED - HTTP ${r.status}`);
      for (const e of json.errors ?? []) console.log(`      ${e.message}`);
      console.log("");
      console.log("  A 401 or 403 here means the token lacks Account Analytics: Read, or is scoped to the");
      console.log("  wrong account. A 400 naming rumPageloadEventsAdaptiveGroups usually means the free");
      console.log("  plan does not expose that dataset for this account.");
      return null;
    }
  } catch (e) {
    console.log(`  FAILED - ${e.cause?.code ?? e.name}: ${e.message}`);
    return null;
  }

  const groups = json?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
  const byPath = new Map();
  let total = 0;
  const countries = new Map();
  const referers = new Map();
  for (const g of groups) {
    const d = g.dimensions ?? {};
    const p = toPath(d.requestPath ?? "/");
    byPath.set(p, (byPath.get(p) ?? 0) + g.count);
    total += g.count;
    if (d.countryName) countries.set(d.countryName, (countries.get(d.countryName) ?? 0) + g.count);
    if (d.refererHost) referers.set(d.refererHost, (referers.get(d.refererHost) ?? 0) + g.count);
  }

  const snapshot = {
    at: new Date().toISOString(),
    site: SITE_HOST,
    windowDays: days,
    totalPageviews: total,
    pages: [...byPath.entries()].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views),
    countries: [...countries.entries()].map(([name, views]) => ({ name, views })).sort((a, b) => b.views - a.views),
    referers: [...referers.entries()].map(([host, views]) => ({ host, views })).sort((a, b) => b.views - a.views),
  };

  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${today()}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`ANALYTICS - fetched\n`);
  console.log(`  window     : last ${days} day(s)`);
  console.log(`  pageviews  : ${total}`);
  console.log(`  distinct   : ${byPath.size} path(s)`);
  console.log(`  written    : ${file.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/") + "/", "")}`);
  if (total === 0) {
    console.log("");
    console.log("  Zero pageviews. That is a real answer and not an error - it means either nobody has");
    console.log("  visited since the beacon was added, or the beacon is not reporting. The two are worth");
    console.log("  telling apart before drawing a conclusion about the content.");
  }
  return snapshot;
}

/* ---------------------------------------------------------------- read back */

function snapshots() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Join readership to the ledger, so a number of pageviews becomes a fact about a category, a subject and
 * a publication date rather than a bare path.
 */
function joined() {
  const snaps = snapshots();
  if (!snaps.length) return null;
  const latest = snaps[snaps.length - 1];

  const ledger = [];
  if (existsSync(LEDGER)) {
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        ledger.push(JSON.parse(line));
      } catch {
        /* a malformed ledger line is the ledger's problem, reported there */
      }
    }
  }
  const byPath = new Map(ledger.filter((e) => e.slug).map((e) => [`/blog/${e.slug}/`, e]));

  const articles = [];
  for (const p of latest.pages ?? []) {
    const e = byPath.get(p.path);
    if (!e) continue;
    articles.push({
      slug: e.slug,
      articleNumber: e.articleNumber ?? null,
      category: e.category ?? "",
      keyword: e.keyword ?? "",
      publishDate: e.publishDate ?? "",
      views: p.views,
    });
  }
  articles.sort((a, b) => b.views - a.views);

  const other = (latest.pages ?? []).filter((p) => !byPath.has(p.path));
  return { latest, snapshots: snaps.length, articles, other, ledger };
}

/* ---------------------------------------------------------------- the brief */

function brief() {
  const j = joined();
  if (!j) {
    return [
      "READERSHIP",
      "  No analytics snapshot has been recorded, so nothing is known about whether anything published",
      "  has been read. Do not assume a topic performs well or badly; there is no evidence either way.",
    ].join("\n");
  }
  const { latest, snapshots: snaps, articles, other } = j;
  const window = `${latest.windowDays} day(s) to ${String(latest.at).slice(0, 10)}`;
  const lines = [];
  lines.push("READERSHIP");
  lines.push(`  Measured: ${latest.totalPageviews} pageview(s) over ${window}, from ${snaps} snapshot(s).`);
  lines.push("");

  if (!articles.length) {
    lines.push("  No article has been read in this window. That is a statement about distribution, not");
    lines.push("  about the subjects: with no reader and no referrer, a topic cannot be judged by traffic.");
    if (other.length) {
      lines.push("");
      lines.push("  Non-article paths that were read:");
      for (const p of other.slice(0, 8)) lines.push(`    ${String(p.views).padStart(5)}  ${p.path}`);
    }
    return lines.join("\n");
  }

  /*
   * Category totals before articles, because one article with twenty views is not a category finding and
   * a sum across a category at least has the shape of one.
   */
  const byCat = new Map();
  for (const a of articles) {
    const c = a.category || "(uncategorised)";
    byCat.set(c, (byCat.get(c) ?? 0) + a.views);
  }
  lines.push("  By category:");
  for (const [c, v] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) lines.push(`    ${String(v).padStart(5)}  ${c}`);
  lines.push("");
  lines.push("  Most read articles:");
  for (const a of articles.slice(0, 10)) lines.push(`    ${String(a.views).padStart(5)}  #${a.articleNumber ?? "?"} ${a.category}  ${a.slug}`);
  if (articles.length > 10) {
    lines.push("");
    lines.push("  Least read articles:");
    for (const a of articles.slice(-5)) lines.push(`    ${String(a.views).padStart(5)}  #${a.articleNumber ?? "?"} ${a.category}  ${a.slug}`);
  }
  lines.push("");
  lines.push("  HOW TO USE THIS, STATED PLAINLY");
  lines.push(`  ${latest.totalPageviews} pageviews across ${articles.length} article(s) is not enough to rank`);
  lines.push("  subjects. Treat it as a description of what exists, not as evidence about what works. Do not");
  lines.push("  imitate the most-read article and do not avoid the least-read one; neither has been read by");
  lines.push("  enough people for the difference to mean anything. If a category has no views at all, that is");
  lines.push("  worth knowing and is a fact about distribution rather than about the subject.");
  return lines.join("\n");
}

/* ---------------------------------------------------------------- run */

if (MODE === "fetch") {
  await fetchSnapshot(Number(args.find((a) => a.startsWith("--days="))?.slice(7) ?? 30));
} else if (MODE === "probe") {
  /*
   * Four questions, smallest first. The first failure is the answer, and each one names what to fix.
   *
   * Cloudflare authenticates before it parses, so without a working token there is no way to check whether the
   * query shape is right. This is how the first real run stops being the only test.
   */
  console.log("ANALYTICS PROBE\n" + "=".repeat(76));
  console.log(`  account : ${ACCOUNT}`);
  console.log(`  beacon  : ${BEACON || "(CF_ANALYTICS_TOKEN not set)"}`);
  console.log("");

  if (!TOKEN) {
    console.log("  1  token          NOT SET - CF_API_TOKEN is required");
    console.log("");
    console.log("  Cloudflare dashboard -> My Profile -> API Tokens -> Create Token");
    console.log("  -> Account Analytics: Read, scoped to this account.");
    process.exit(2);
  }

  const ask = async (query) => {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query }),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok && !j.errors, errors: j.errors ?? [], data: j.data };
  };
  const explain = (e) => {
    const msg = String(e.message ?? "");
    if (/Authentication|10000|9106/i.test(msg)) return "the token is not accepted - wrong value, revoked, or not an API token";
    if (/401|403/i.test(msg)) return "the token lacks Account Analytics: Read, or is scoped to another account";
    if (/rumPageloadEventsAdaptiveGroups|unknown field/i.test(msg)) return "this account or plan does not expose the RUM dataset";
    if (/siteTag/i.test(msg)) return "siteTag is not a filter on this dataset";
    return msg.slice(0, 140);
  };

  /* 1 - is the token valid and does it see the account */
  const a = await ask(`{ viewer { accounts(filter: { accountTag: "${ACCOUNT}" }) { accountTag } } }`);
  if (!a.ok) {
    console.log("  1  token          FAILED");
    console.log("     " + explain(a.errors[0] ?? { message: `HTTP ${a.status}` }));
    process.exit(1);
  }
  const seen = a.data?.viewer?.accounts ?? [];
  console.log(`  1  token          ok - sees ${seen.length} account(s)`);

  /* 2 - is the dataset reachable at all */
  const b = await ask(`{ viewer { accounts(filter: { accountTag: "${ACCOUNT}" }) { rumPageloadEventsAdaptiveGroups(limit: 1) { count dimensions { requestPath } } } } }`);
  if (!b.ok) {
    console.log("  2  RUM dataset    FAILED");
    console.log("     " + explain(b.errors[0] ?? { message: `HTTP ${b.status}` }));
    process.exit(1);
  }
  const anyRows = (b.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []).length;
  console.log(`  2  RUM dataset    ok - ${anyRows} row(s) with no filter`);

  /* 3 - does the beacon match anything, ever */
  if (!BEACON) {
    console.log("  3  beacon         SKIPPED - CF_ANALYTICS_TOKEN (the beacon token) is not set");
    console.log("     Without it the query cannot be scoped to this site, so no pageviews can be attributed.");
    process.exit(2);
  }
  const c = await ask(`{ viewer { accounts(filter: { accountTag: "${ACCOUNT}" }) { rumPageloadEventsAdaptiveGroups(limit: 1 filter: { siteTag: "${BEACON}" }) { count } } } }`);
  if (!c.ok) {
    console.log("  3  beacon         FAILED");
    console.log("     " + explain(c.errors[0] ?? { message: `HTTP ${c.status}` }));
    process.exit(1);
  }
  const beaconRows = (c.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []).length;
  console.log(`  3  beacon         ${beaconRows ? "ok - traffic found for this site" : "no traffic for this beacon, ever"}`);

  /* 4 - is there traffic inside the window the writer is told about */
  const days = Number(/--days=(\d+)/.exec(args.join(" "))?.[1] ?? 7);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const d = await ask(`{ viewer { accounts(filter: { accountTag: "${ACCOUNT}" }) { rumPageloadEventsAdaptiveGroups(limit: 1 filter: { date_geq: "${since}", siteTag: "${BEACON}" }) { count } } } }`);
  const windowRows = d.ok ? (d.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []).length : 0;
  console.log(`  4  last ${days} day(s)     ${windowRows ? "ok - traffic inside the window" : "no traffic since " + since}`);
  console.log("");

  if (windowRows) {
    console.log("RESULT: PASS - the token, the dataset and the beacon all work. Run --fetch.");
    process.exit(0);
  }
  if (beaconRows) {
    console.log("RESULT: QUIET - the beacon has traffic, just not in this window. Widen it with --days=30.");
    process.exit(3);
  }
  console.log("RESULT: NO-DATA - everything works but this site has never been seen by RUM.");
  console.log("        The beacon script may not be on the live pages; check for cloudflareinsights in the HTML.");
  process.exit(4);
} else if (MODE === "brief") {
  console.log(brief());
} else {
  const j = joined();
  console.log("ANALYTICS\n" + "=".repeat(76));
  if (!j) {
    console.log("  no snapshots recorded yet");
    console.log("");
    console.log("  node tools/analytics.mjs --fetch   needs CF_ACCOUNT_ID and CF_API_TOKEN");
    console.log("  node tools/analytics.mjs --brief   what the writer would be told (nothing, for now)");
  } else {
    console.log(`  snapshots : ${j.snapshots}`);
    console.log(`  latest    : ${j.latest.at}  ${j.latest.totalPageviews} pageview(s) over ${j.latest.windowDays} day(s)`);
    console.log(`  articles matched to the ledger : ${j.articles.length}`);
    console.log(`  other paths                    : ${j.other.length}`);
    console.log("");
    console.log("  The writer is currently told:");
    console.log("");
    for (const l of brief().split("\n")) console.log("    " + l);
  }
}
