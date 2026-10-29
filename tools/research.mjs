/**
 * Autonomous research: fetch sources, propose a subject, extract figures, verify them, write a
 * directive.
 *
 *   node tools/research.mjs                       full run, writes data/directive.json
 *   node tools/research.mjs --dry-run              fetch and propose, write nothing
 *   node tools/research.mjs --budget=0.50          hard ceiling in estimated USD for this run
 *   node tools/research.mjs --sources=2            how many candidate pages to fetch
 *   node tools/research.mjs --ledger               show the subject ledger
 *
 * ## The order, and why it is this order
 *
 *   1. Fetch candidate pages and ARCHIVE them. Nothing is proposed before the documents exist
 *      locally, because a subject proposed from a model's memory is a subject nobody has read.
 *   2. The model reads the archives and proposes one subject with five to eight figures, each
 *      carrying `evidence` - a verbatim excerpt - and `evidence_from`, the archive path.
 *   3. tools/check-evidence.mjs verifies every excerpt against the archive, mechanically.
 *   4. Only then is a directive written.
 *
 * Step 3 is the one that makes this safe to run unattended. Without it, the model that writes a
 * figure also certifies the figure, which is the arrangement that produces confident wrong numbers.
 * With it, an invented number cannot pass, because inventing the accompanying excerpt is the same work
 * as reading the file.
 *
 * ## Duplicate detection
 *
 * Every published article contributes a row to `data/ledger.jsonl`: its slug, keyword, category,
 * source hosts and figure values. A proposed subject that shares a host and a keyword stem with an
 * existing row is rejected before any writing happens. This is what stops a pipeline that runs every
 * day from writing the same article twice with different phrasing.
 *
 * ## The budget
 *
 * Calls are metered in `logs/usage.jsonl` by tools/lib-llm.mjs. This module sums the run's own spend
 * and stops before the next call when the ceiling is reached, so a runaway loop costs a known amount
 * rather than whatever it happens to consume. The default ceiling is deliberately small: research
 * that cannot finish within it is research that was not ready.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { askJson, available, summary as providerSummary, usageToday } from "./lib-llm.mjs";
import { CATEGORY_SLUGS, AUDIENCE_VALUES } from "../src/lib/taxonomy.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DRY = args.includes("--dry-run");
const BUDGET = Number(flag("budget", "0.40"));
/*
 * Six sources and four articles each, not four and two.
 *
 * "articles: 6 followed from the listings" was the line that explained a week of NO-SUBJECT: six archived articles, of
 * which the same two or three carried a rate, meant the subject pool was exhausted after two articles. The documents
 * were always there - the follow-up depth was not.
 */
const MAX_SOURCES = Number(flag("sources", "6"));

const SOURCES_DIR = join(ROOT, "data", "sources");
const LEDGER = join(ROOT, "data", "ledger.jsonl");
const DIRECTIVE = join(ROOT, "data", "directive.json");

/* ---------------------------------------------------------------- the ledger */

export function loadLedger() {
  if (!existsSync(LEDGER)) return [];
  try {
    return readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

if (args.includes("--ledger")) {
  /* Built on demand: the ledger is derived from the corpus, so asking to see it when it does not yet
     exist should show it rather than report that it is absent. */
  const rows = existsSync(LEDGER) ? loadLedger() : buildLedger();
  console.log(`SUBJECT LEDGER — ${rows.length} row(s)\n${"=".repeat(88)}`);
  if (!rows.length) console.log("  (the corpus produced no rows, which means no published articles were found)");
  for (const r of rows) {
    console.log(`  #${String(r.articleNumber ?? "?").padStart(2)}  ${String(r.category ?? "").padEnd(12)} ${r.slug}`);
    console.log(`        keyword : ${r.keyword || "(none)"}`);
    console.log(`        sources : ${(r.sourceNames ?? []).slice(0, 2).map((s) => String(s).slice(0, 62)).join(" | ") || "(none)"}`);
    console.log(`        figures : ${(r.values ?? []).slice(0, 6).join(" ") || "(none)"}`);
  }
  process.exit(0);
}

/**
 * Build the ledger from the corpus. Idempotent: it is derived, never hand-edited.
 *
 * The obvious key would be the source host, and it cannot be used: not one of the thirty-six articles
 * contains a URL. Sources are named strings - "General Administration of Customs of the PRC,
 * Announcement No. 74 of 2026" - which is deliberate, since the site cites instruments rather than
 * links, and a link rots while an instrument number does not.
 *
 * So the ledger carries what is actually there: the keyword, the source names as written, and every
 * figure value. Two proposals that name the same instrument and report the same numbers are the same
 * subject, and that is what the duplicate check compares.
 */
export function buildLedger() {
  const blog = join(ROOT, "src", "content", "blog");
  const rows = [];
  for (const f of readdirSync(blog).filter((x) => x.endsWith(".md"))) {
    const t = readFileSync(join(blog, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? "";
    if (/^draft:\s*true/m.test(fm)) continue;
    const slug = f.replace(/\.md$/, "");
    const sourceBlock = fm.split(/^sources:\s*$/m)[1]?.split(/^\w+:/m)[0] ?? "";
    const sourceNames = [...sourceBlock.matchAll(/^\s{2}-\s*"?(.+?)"?\s*$/gm)].map((m) => m[1].trim()).filter(Boolean);
    const values = [...new Set([...fm.matchAll(/^\s{2}- value:\s*"?(.+?)"?\s*$/gm)].map((m) => m[1].trim()))];
    rows.push({
      articleNumber: Number(/^articleNumber:\s*(\d+)/m.exec(fm)?.[1] ?? 0),
      slug,
      keyword: (/^target_keyword:\s*"?(.+?)"?\s*$/m.exec(fm)?.[1] ?? "").trim(),
      category: (/^category:\s*"?(.+?)"?\s*$/m.exec(fm)?.[1] ?? "").trim(),
      publishDate: (/^publishDate:\s*"?(.+?)"?\s*$/m.exec(fm)?.[1] ?? "").trim(),
      sourceNames,
      values,
      tags: (/^tags:\s*\[(.*?)\]/m.exec(fm)?.[1] ?? "").replace(/["\s]/g, "").split(",").filter(Boolean),
    });
  }
  rows.sort((a, b) => a.articleNumber - b.articleNumber);
  mkdirSync(join(ROOT, "data"), { recursive: true });
  writeFileSync(LEDGER, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return rows;
}

/*
 * Words that describe the reader or the beat rather than a subject.
 *
 * A title on this site is built from an audience word (importer, supplier, buyer), a beat word (sourcing, landed
 * cost, supply chain) and a subject. Only the subject distinguishes one article from another, so only the subject
 * may score. The first version of this list had the beat's regulatory vocabulary - duty, tariff, price - and not
 * the words the titles are actually made of, which is why two of them were enough to reject an unrelated subject.
 */
const STOP = new Set([
  "duty", "duties", "rate", "rates", "2026", "2027", "2025", "2028", "china", "chinese", "the", "and", "for", "from",
  "anti", "dumping", "tariff", "tariffs", "cost", "costs", "price", "prices", "import", "imports", "importing",
  "trade", "export", "exports", "exporting",
  /* The audience. Every article here is for one of these. */
  "importer", "importers", "exporter", "exporters", "supplier", "suppliers", "buyer", "buyers", "seller", "sellers",
  "manufacturer", "manufacturers", "shipper", "shippers", "platform", "platforms", "merchant", "merchants",
  /* The beat. */
  "sourcing", "source", "sources", "supply", "chain", "chains", "landed", "margin", "margins", "logistics",
  "shipment", "shipments", "customs", "clearance", "compliance", "policy", "policies", "measure", "measures",
  "sector", "sectors", "industry", "industries", "market", "markets", "year", "annual", "monthly", "quarter",
  "analysis", "insight", "insights", "guide", "update", "report", "reports", "data",
]);
const stems = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));

/** Words that identify an institution across the ways it gets written. */
const ORG_STOP = new Set(["general", "administration", "ministry", "commission", "state", "council", "national", "bureau", "department", "republic", "peoples", "people", "official", "notice", "announcement", "regulation", "customs", "the", "and", "for", "from"]);
const orgTokens = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    /* A year is not an institution. "2026" is four characters and was not on the stop list, so every article
       published that year shared it. */
    .filter((w) => w.length > 3 && !ORG_STOP.has(w) && !/^\d+$/.test(w));

/**
 * Overlap between a proposal and the corpus.
 *
 * Three signals, weighted by how much each actually means. A shared figure value is the strongest:
 * two articles reporting 17.45 per cent about the same product are the same article. A shared keyword
 * stem is next. A shared institution is weakest on its own - many subjects come from the same ministry
 * - so it counts for one.
 *
 * The threshold is four, and it is now hard to reach without a shared figure. A shared value counts three and a
 * shared subject stem two; a shared institution counts one. With the beat's vocabulary excluded, two stems means
 * two words about the same subject rather than two words about the same audience - which is the case this exists to
 * catch: the same number, or the same subject, under a different headline.
 */
/*
 * Values and stems that are shared by everything, and so prove nothing.
 *
 * On 2026-10-18 the check rejected three genuinely new subjects in a row: EU pea-protein duties against a CBAM
 * downstream article, EU FDI screening against an EAEU oil-pipe case, a p-nitrotoluene platform piece against the
 * cellulose-ethers AD760 article. Each pair shares a "figure" of 100 or a year, and the weighted sum crossed four.
 *
 * A number every release contains is not evidence that two articles are the same article.
 */
const COMMON_VALUES = new Set(["100", "1000", "10000", "100000", "50", "10", "20", "30", "40", "60", "70", "80", "90",
  "2024", "2025", "2026", "2027", "2028", "2029", "2030", "1", "2", "3", "5", "15", "25"]);
const informativeValue = (v) => v.length >= 3 && !COMMON_VALUES.has(v);

function duplicateScore(proposal, ledger) {
  const pk = new Set(stems(proposal.keyword ?? ""));
  const pv = new Set((proposal.figures ?? []).map((f) => String(f.value ?? "").replace(/[$,%\s]/g, "").toLowerCase()).filter(informativeValue));
  const po = new Set((proposal.sources ?? []).flatMap((s) => orgTokens(s)));
  const pn = new Set((proposal.sourceHosts ?? []).flatMap((h) => orgTokens(h)));

  let best = { score: 0, against: null, why: [] };
  for (const row of ledger) {
    /* Rows written before the split above are not published subjects and must not block one. */
    if (row?.proposedNotYetPublished || row?.articleNumber == null) continue;
    const rk = new Set(stems(row.keyword));
    const rv = new Set((row.values ?? []).map((v) => String(v).replace(/[$,%\s]/g, "").toLowerCase()).filter(informativeValue));
    const ro = new Set((row.sourceNames ?? []).flatMap((s) => orgTokens(s)));

    const sharedKw = [...pk].filter((w) => rk.has(w));
    const sharedVals = [...pv].filter((v) => rv.has(v));
    const sharedOrg = [...po, ...pn].filter((w) => ro.has(w));

    /*
     * STRONG EVIDENCE ONLY: a shared NUMBER, or nothing.
     *
     * The operator's rule, 2026-10-18: two subjects are the same subject when the same figure or the same case number
     * appears in both, or when the same product and the same institution and the same measure line up. Sharing a
     * keyword - 'duty', 'screening', 'importer', 'platform' - is not evidence; this beat has a hundred articles and
     * they will all share those words.
     *
     * The old formula let three stems plus an institution cross four. That is how a subject about EU FDI screening
     * notification timelines was called a duplicate of a cellulose-ethers anti-dumping case.
     */
    const sameMeasure = sharedKw.filter((w) => /^(ad|vd|safeguard|duty|tariff|quota|subsidy|screening|registration|licence|certificate|threshold|rebate)/.test(w)).length;
    const strong = sharedVals.length >= 1 || (sameMeasure >= 2 && sharedOrg.length >= 1);
    const score = strong ? sharedVals.length * 3 + sameMeasure * 2 + sharedOrg.length : 0;
    if (score > best.score) {
      best = {
        score,
        against: row.slug,
        why: [
          sharedVals.length ? `shared figure value(s): ${sharedVals.slice(0, 5).join(", ")}` : "",
          sharedKw.length ? `shared keyword stems: ${sharedKw.slice(0, 5).join(", ")}` : "",
          sharedOrg.length ? `shared institution(s): ${[...new Set(sharedOrg)].slice(0, 5).join(", ")}` : "",
        ].filter(Boolean),
      };
    }
  }
  return best;
}

/* ---------------------------------------------------------------- candidate sources */

/*
 * Pages worth fetching, chosen because they are index-shaped: a listing that changes daily and links
 * to the documents behind it. A single document is only useful once a subject is chosen; a listing is
 * what a subject gets chosen from.
 *
 * The first URL of each pair answers from a data-centre address in the tests run so far; the second is
 * the fallback for the sites that raise 412 against some request patterns. A failure is recorded and
 * the next candidate is tried, because a research run that dies on one blocked site is a research run
 * that dies every day.
 */
/*
 * REACHABLE-FIRST ORDER.
 *
 * The loop below stops once MAX_SOURCES pages have been archived, and on 2026-10-18 five of the first seven
 * candidates returned zero bytes from the runner: cacs trade remedy, tariff commission, statistics bureau, tax
 * administration and customs. They are Chinese ministry sites, and they answer a residential address while refusing
 * a datacenter one.
 *
 * The consequence was not a failed fetch, it was a failed subject: the pages that archived held policy releases and
 * council news, none of which carries a per-unit rate, so research reported infeasible while the two candidates that
 * publish rates for a living - the EU Official Journal and the US Federal Register API - were never reached, because
 * the loop had already stopped.
 *
 * So the sources that answer from anywhere come first.
 *
 * Reordered again on 2026-10-26 for the Malaysian project. The rule that survived both versions is
 * the one worth keeping: a source that publishes the number in its own body comes before a source
 * that publishes commentary about the number.
 *
 * Measured from this machine on 2026-10-26 by tools/check-source-reachability.mjs: 15 of 18 hosts
 * answer. imf.org refused one path (/en/News, 403) and serves another (/en/Publications, 200), which
 * is why the entry below names the path rather than the host. worldbank.org reset the connection
 * and is listed with its data host instead.
 */
const CANDIDATES = [
  ["https://www.bnm.gov.my/pr", "bank-negara", "policy rate, reserves, exchange rate - English, the figures sit in the page body"],
    ["https://www.bernama.com/bm/rss/news.rss", "bernama", "national news agency, RSS, dated items with body text"],
    ["https://www.malaymail.com/feed/rss/malaysia", "malay-mail", "English-language daily, RSS with full body text"],
    ["https://www.freemalaysiatoday.com/feed/", "fmt", "independent outlet, RSS with body text"],
    ["https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416", "cna-asia", "regional coverage of Asia, RSS"],
  ["https://www.dosm.gov.my/portal-main/home", "dosm", "CPI, trade, GDP, employment - the monthly releases the index is built from"],
  ["https://www.mida.gov.my/media-release/feed/", "mida", "investment approvals as RSS, with ringgit amounts in the release body"],
  ["https://www.mof.gov.my/portal/en/news/speech", "ministry-of-finance", "the budget speech in English, on its own page rather than behind a language toggle"],
  ["https://www.miti.gov.my/index.php/pages/view/10936", "miti", "trade measures and trade performance; titles in HTML, figures in the linked PDF"],
  ["https://www.imf.org/en/publications", "imf", "WEO, Article IV and regional outlooks; the site also serves index.md and index.json per page"],
  ["https://www.federalreserve.gov/newsevents/pressreleases.htm", "federal-reserve", "the world-side rate decisions that move the ringgit"],
  ["https://www.ecb.europa.eu/press/html/index.en.html", "ecb", "euro-area decisions and the exchange-rate channel"],
  ["https://www.wto.org/english/news_e/news_e.htm", "wto", "trade notices, disputes and notifications"],
  /*
   * Analysis comes after the numbers, and is labelled as analysis.
   *
   * ISEAS and ISIS Malaysia are the two sources that supply the reasoning for `Why now` and
   * `So what`. They are not figure sources: a piece built from their sentences and no statistical
   * release is an opinion column with a byline it has not earned.
   */
  ["https://www.iseas.edu.sg/category/articles-commentaries/iseas-perspective/iseas-perspective-2026/", "iseas", "regional analysis: what a world event means for Southeast Asia"],
  ["https://www.isis.org.my/", "isis-malaysia", "strategic analysis from a Malaysian standpoint"],
  /*
   * Included to keep measuring a known-weak source rather than pretending it is fine.
   *
   * JKDM answers 200 with an English shell and puts the rates in Malay PDFs; the Securities
   * Commission listing is client-rendered and returns an empty list to a plain fetch. Both are
   * reachable and neither is reliably quotable.
   */
  ["https://mysst.customs.gov.my/", "customs-sst", "sales-and-service tax; English shell, Malay guidance documents"],
  ["https://www.sc.com.my/resources/media/media-release", "securities-commission", "regulator releases; listing is client-rendered"],
];

if (!available().length) {
  console.log("RESEARCH\n" + "=".repeat(84));
  console.log(providerSummary());
  console.log("\n  No provider key, so no subject can be proposed. Nothing was fetched and nothing written.");
  process.exit(78);
}

console.log(`RESEARCH  ${new Date().toISOString()}\n${"=".repeat(84)}`);
console.log(providerSummary());
console.log(`  budget   : $${BUDGET.toFixed(2)}`);
console.log(`  fetches  : up to ${MAX_SOURCES}`);
console.log("");

const started = usageToday();

/* ---------------------------------------------------------------- 1. fetch and archive */

const day = new Date().toISOString().slice(0, 10);
mkdirSync(join(SOURCES_DIR, day), { recursive: true });

const fetched = [];
for (const [url, label, why] of CANDIDATES) {
  if (fetched.length >= MAX_SOURCES) break;
  let out = "";
  try {
    out = execFileSync(process.execPath, [join(ROOT, "tools", "store-source.mjs"), `--url=${url}`, `--label=research-${label}`], { encoding: "utf8", timeout: 120000 });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  let ok = /^\s+ok\s/m.test(out);
  const file = /archived: (\S+)/.exec(out)?.[1] ?? null;
  const bytes = Number(/ok\s+\d+\s+(\d+) bytes/.exec(out)?.[1] ?? /FAIL\s+\d+\s+(\d+) bytes/.exec(out)?.[1] ?? 0);
  console.log(`  ${ok ? "ok  " : "skip"}  ${label.padEnd(24)} ${String(bytes).padStart(8)}B  ${ok ? "archived" : "not usable (recorded anyway)"}`);
  if (ok && file) fetched.push({ url, label, why, file: file.replace(/\\/g, "/"), bytes });
}

/*
 * The second hop: an index page is a table of contents, not a document.
 *
 * Everything below the fold of a listing is the actual document - the notice with the rate, the release with the
 * figure. The listing is read for its links, up to two articles per source are archived alongside it, and the
 * model receives the articles.
 *
 * The shape test is deliberate: four or more consecutive digits in the path, and a path deeper than the index. A
 * navigation link - index.html, more.html, #, / - has neither, so it falls out without a list of patterns per
 * site. Eight candidate sources would otherwise be eight parsers to break when a site is redesigned.
 */
/*
 * The registrable domain, near enough for the sources this site reads.
 *
 * Two-level public suffixes (gov.cn, com.cn, org.cn, net.cn) make the last three labels the domain; everywhere else
 * the last two. A full public suffix list would be more correct and would be wrong the moment it went stale, and
 * these are Chinese ministry domains - the three cases above cover them, and a mistake here fails closed (a link
 * is skipped) rather than open.
 */
/*
 * Decode an archived page using the charset it declares, then the usual fallbacks.
 *
 * The score is the number of replacement characters, because a page decoded with the wrong charset produces a
 * lot of them and the right one produces none. Trying the declared charset first means the common case costs one
 * pass; the alternatives exist because ministry sites declare gb2312 while serving gb18030.
 */
function decodeHtml(buf) {
  const head = buf.subarray(0, 4096).toString("latin1");
  const declared = (/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? "").toLowerCase();
  const candidates = [declared, "utf-8", "gb18030", "gbk"].filter(Boolean);
  let best = null;
  let bestBad = Infinity;
  for (const enc of candidates) {
    let text;
    try {
      text = new TextDecoder(enc, { fatal: false }).decode(buf);
    } catch {
      continue;
    }
    const bad = (text.match(/\uFFFD/g) ?? []).length;
    if (bad < bestBad) {
      best = text;
      bestBad = bad;
    }
    if (bad === 0) break;
  }
  return best ?? buf.toString("latin1");
}

function registrable(host) {
  const parts = String(host ?? "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  if (/^(?:gov|com|org|net|edu)\.cn$/.test(last2)) return parts.slice(-3).join(".");
  return last2;
}

const ARTICLE_HINT = /\/\d{4,}|\d{6,}|\d{4}-\d{2}/;

function articleLinks(indexFile, baseUrl, limit) {
  let html = "";
  try {
    html = readFileSync(join(ROOT, indexFile), "latin1");
  } catch {
    return [];
  }
  /* An RSS or Atom feed is already a list of articles; its <link> elements are the
     candidates. Treating a feed like an HTML index found nothing, which is why four feeds
     were added and none produced a candidate. */
  if (/<item[\s>]|<entry[\s>]/i.test(html)) {
    const feedOut = [];
    const seenFeed = new Set();
    for (const m of html.matchAll(/<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)) {
      const inner = m[1];
      const lm = /<link[^>]*href=["']([^"']+)["']/i.exec(inner) || /<link>\s*([^<\s]+)\s*<\/link>/i.exec(inner);
      if (!lm) continue;
      const href = lm[1].replace(/&amp;/g, "&").trim();
      if (!href || seenFeed.has(href)) continue;
      seenFeed.add(href);
      feedOut.push(href);
      if (feedOut.length >= limit) break;
    }
    if (feedOut.length) return feedOut;
  }
  const base = new URL(baseUrl);
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    /* The escaped ampersand is how a query string arrives; leaving it in produces a 404, not a decoded URL. */
    const raw = m[1].replace(/&amp;/g, "&").replace(/&#38;/g, "&");
    let abs;
    try {
      abs = new URL(raw, base).toString();
    } catch {
      continue;
    }
    /* A ministry publishes across subdomains; the registrable domain is the boundary, not the origin. */
    if (registrable(new URL(abs).hostname) !== registrable(base.hostname)) continue;
    if (abs === baseUrl) continue;
    if (/\.(?:css|js|png|jpe?g|gif|svg|ico|pdf|zip|docx?|xlsx?)(?:$|\?)/i.test(abs)) continue;
    if (!ARTICLE_HINT.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
    if (out.length >= limit) break;
  }
  return out;
}

const articles = [];
for (const page of fetched) {
  const links = articleLinks(page.file, page.url, 4);
  for (const link of links) {
    if (articles.length >= MAX_SOURCES * 2) break;
    const label = `${page.label.replace(/^research-/, "")}-article`;
    let out = "";
    try {
      out = execFileSync(process.execPath, [join(ROOT, "tools", "store-source.mjs"), `--url=${link}`, `--label=research-${label}`], {
        encoding: "utf8",
        timeout: 120000,
      });
    } catch (e) {
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    let ok = /^\s+ok\s/m.test(out);
    const file = /archived: (\S+)/.exec(out)?.[1] ?? null;
    const bytes = Number(/ok\s+\d+\s+(\d+) bytes/.exec(out)?.[1] ?? 0);
    console.log(`  ${ok ? "ok  " : "skip"}  ${label.padEnd(24)} ${String(bytes).padStart(8)}B  ${ok ? "article archived" : "not usable"}`);
    /*
     * A 200 and 128 KB says nothing about whether this is an article: MITI answered with a
     * navigation menu that archived cleanly and could not support a sentence. Drop the chrome,
     * then let length, numbers and navigation density decide.
     */
    if (ok && file) {
      let text = "";
      try {
        const raw = readFileSync(join(ROOT, file), "utf8");
        text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      } catch { text = ""; }
      const digits = (text.match(/\d+(?:\.\d+)?/g) ?? []).length;
      const navHits = (text.match(/\b(menu|home|contact|sitemap|privacy|terms|login|search|careers|procurement|tender|directory|archive|subscribe|download|print|share)\b/gi) ?? []).length;
      const navDensity = text.length ? (navHits * 1000) / text.length : 0;
      if (text.length < 2500 || digits < 5 || navDensity > 2.2) {
        ok = false;
        console.log(`       rejected: ${text.length} chars, ${digits} numbers, nav ${navDensity.toFixed(1)}/1k`);
      }
    }

    if (ok && file) articles.push({ url: link, label, why: `an article linked from ${page.label}`, file: file.replace(/\\/g, "/"), bytes });
  }
}

if (articles.length) {
  /*
   * Articles first in the corpus. The model reads the first three entries, and a listing in that position is what
   * produced "no figure to write from".
   */
  fetched.unshift(...articles);
  console.log(`\n  articles : ${articles.length} followed from the listings`);
} else {
  console.log("");
  console.log("  articles : none found behind the listings. A listing alone cannot support an article with five");
  console.log("             cost figures, so the model is told to report that rather than write from navigation.");
}

if (!fetched.length) {
  console.log("");
  console.log("  Nothing was fetched. Research stops here rather than proposing a subject from memory.");
  console.log("  Run node tools/check-source-reachability.mjs to see which sources answer from this machine,");
  console.log("  and in Actions run the probe workflow to see whether a data-centre address fares differently.");
  process.exit(1);
}

/* ---------------------------------------------------------------- 2. the model proposes */

const ledger = existsSync(LEDGER) ? loadLedger() : buildLedger();
console.log(`\n  ledger: ${ledger.length} published subject(s) to avoid repeating`);

/*
 * The archives are passed as text with their paths. The model is told to quote from them and to give
 * the path it quoted from; the checker verifies both, so a quotation from memory fails.
 */
/*
 * Two kinds of document arrive now, and they are not interchangeable.
 *
 * A listing names subjects and dates. An article carries the rates, thresholds and amounts that a per-unit cost
 * needs. Saying so is not a nicety: yesterday the model received three listings, correctly reported that no
 * cost figures could be drawn from them, and wrote nothing. It was right about its input, and the
 * input was the wrong kind.
 */
const CORPUS_NOTE = [
  "TWO KINDS OF DOCUMENT ARE BELOW, and only one of them can carry an article.",
  "",
  "  A LISTING IS A TABLE OF CONTENTS. It gives subject names, dates and document numbers. It cannot supply",
  "  rates, thresholds or amounts, so nothing in it may be used as a figure.",
  "",
  "  AN ARTICLE IS THE DOCUMENT ITSELF. Its body carries the percentages, amounts and deadlines. Every figure",
  "  you propose must come from an article, and never from a listing's headline.",
  "",
  "If the corpus holds listings only, say so and report infeasible - that is the correct answer and it is worth",
  "more than an article assembled from navigation text.",
].join("\n");

const corpus = fetched
  .slice(0, 5)
  .map((f) => {
    const p = join(ROOT, f.file);
    let body = "";
    try {
      /*
       * Decoded by charset rather than read as latin1. Latin1 kept the digits and destroyed every word around
       * them, so the writer received pages where the figures existed and were unreadable - which reads as
       * evidence and cannot be used.
       */
      body = decodeHtml(readFileSync(p))
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 18000);
    } catch {}
    return `--- SOURCE: ${f.file}\nURL: ${f.url}\nWHY IT MATTERS: ${f.why}\n\n${body}\n`;
  })
  .join("\n");

const covered = ledger
  .slice(-40)
  .map((r) => `  #${r.articleNumber} ${r.slug} — keyword "${r.keyword}"`)
  .join("\n");

/*
 * Which sections the operator's rule says are behind.
 *
 * The rule is one to three articles per section per week, and the orchestrator computes which sections
 * have none yet. Those are passed here because the subject is chosen in this module and nowhere else -
 * a rule checked but not acted on is a report, not a rule.
 *
 * It is a preference and not a constraint, and the wording says so. If today's documents do not support
 * an article in the section that is behind, forcing one produces exactly the thing the quality rule
 * exists to prevent: a summary with no arithmetic in it, which is what search engines demote. So the
 * model is told that favouring a section is worth a little and damaging the article is worth more.
 */
const behind = (process.env.UNCOVERED_SECTIONS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/*
 * The section that most needs an article today.
 *
 * Behind sections are ordered by how long they have gone without one, and the orchestrator passes them in
 * that order. The first is the primary instruction rather than a suggestion: the previous version listed
 * the behind sections and let the model choose, and it chose a covered section while four had nothing.
 *
 * The fallback is part of the instruction, not a silent failure. If today's documents do not support a
 * subject in the primary section, the honest answer is another section - forcing an article out of
 * material that does not carry cost figures produces the commodity summary this site exists not to
 * publish.
 */
/*
 * Queries that earn impressions and no clicks.
 *
 * Read from the newest file in data/blue-ocean/, which tools/gsc-blue-ocean.mjs writes. Absent on a new property,
 * on a property the service account cannot see, or on a week where nothing cleared the thresholds - all ordinary,
 * all handled by an empty list.
 */
function blueOcean() {
  const dir = join(ROOT, "data", "blue-ocean");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const latest = files[files.length - 1];
  if (!latest) return null;
  try {
    const j = JSON.parse(readFileSync(join(dir, latest), "utf8"));
    return Array.isArray(j.keywords) && j.keywords.length ? j : null;
  } catch {
    return null;
  }
}
const blue = blueOcean();

const BLUE_OCEAN_NOTE = blue
  ? [
      "BLUE OCEAN — QUERIES THAT ALREADY EARN IMPRESSIONS AND NO CLICKS",
      "",
      "These are real queries, measured on this site, with over a thousand impressions, under one percent click",
      "rate and a ranking between 5 and 20. A reader is seeing us and not clicking, which is a title or a promise",
      "problem on a page that can rank.",
      "",
      ...blue.keywords.map((k) => `  - ${k.query}   ${k.impressions} impressions, ctr ${(k.ctr * 100).toFixed(2)}%, position ${k.position}`),
      "",
      "If the documents below support one of these, it takes precedence over a subject nobody is searching for.",
      "It is still a preference and not an instruction: a query with no documents behind it is a query, not a",
      "subject, and writing it anyway is how you get a page that ranks for the wrong thing.",
    ].join("\n")
  : "";

const PRIMARY_SECTION = behind[0] ?? "";
const sectionBlock = behind.length
  ? `
SECTION COVERAGE — the operator's rule is one to three articles per section per week

These sections have had no net-new article this week: ${behind.join(", ")}

THE SECTION THIS WEEK IS THINNEST, AND THAT IS A PREFERENCE:
  It is never a reason to report infeasible. If the only document that touches the thin section is one whose
  figures are national aggregates, propose a subject from any other section instead. Reaching for the thin
  section is worth something; publishing nothing to protect it is worth less than nothing.

YOUR PRIMARY SECTION TODAY: ${PRIMARY_SECTION}

Choose a subject in ${PRIMARY_SECTION} if the documents below genuinely support one. This is the section
the operator's rule says is furthest behind, so it takes precedence over a subject in a covered section.
Your "category" field must be "${PRIMARY_SECTION}" if you take it.

If the documents do not support a ${PRIMARY_SECTION} subject - no evidence of the kind the piece needs (a rate, an
amount, a percentage, a quantity - not a date and not a document number) that appear
verbatim, or no cost consequence an importer can act on - then choose what they do support and say so in
"angle". Forcing an article out of material that cannot carry it produces the commodity summary this site
exists not to publish, and one week's gap in a section costs less than that.

Prefer a subject in one of them when the documents below genuinely support it. A subject in a covered
section that the documents support well is better than a subject in a behind section that they support
thinly: an article without two citable cost figures and a cost consequence is the commodity summary this
site exists not to publish, and publishing one costs more than a week's gap in a section. Say which
section your subject belongs to in "category", and if the documents do not support the section that is
behind, choose what they do support.
`
  : "";

const prompt = `You are choosing today's subject for Archipelago AI Wire, a Malaysian publication that helps
ordinary Malaysians understand the world: what happened, why it is happening, and what it means for Malaysia.

Below are source documents, fetched and archived today. Their paths are real; quote from them.

WHAT MAKES A SUBJECT WORTH WRITING
  - a change with a date: something that took effect, expires, or was announced
  - a Malaysian consequence that can be NAMED: an industry, a kind of job, a price, a procedure, a group of
    people, an institution. "It could affect the Malaysian economy" is not a consequence; it is a sentence
    without a subject, and it is rejected.
  - evidence of one of two kinds: at least two figures that appear verbatim in these documents,
    OR one dated change in a named official document (a rate, a rule, a tariff, a threshold, a
    publication) even when it carries no quotable number. A policy change with a date is evidence;
    a page of numbers without one is not
  - it is not already covered. The recently published subjects are listed below.

WHAT IS REJECTED
  - a subject whose numbers are not in the documents below
  - a subject that repeats one of the listed articles, even under a different title
  - a subject with no Malaysian carrier. A carrier is a link a reader can follow: a trade route,
    an input price, a job, a cost, a rule that binds a Malaysian firm or household. The document
    may state it, or you may derive it - but a derived link must be written as analysis, in plain
    words, with the steps named, and never presented as the source's own conclusion. Only when no
    such chain can be described at all: return feasible=false with reason_if_not="no Malaysian carrier described".
  - a subject that rests on race, religion or royalty. Those are reportable subjects, but this pipeline has no
    named human reviewer, and the gate quarantines them. Do not propose one automatically.
${BLUE_OCEAN_NOTE ? BLUE_OCEAN_NOTE + "\n\n" : ""}${sectionBlock}
THE SOURCES

${corpus}

ALREADY PUBLISHED — do not repeat these
${covered}

Return ONLY a JSON object:
{
  "feasible": true or false,
  "reason_if_not": "one sentence, when feasible is false",
  "slug": "kebab-case, distinctive",
  "title_idea": "a plain declarative headline",
  "keyword": "the phrase a Malaysian reader would search",
  "category": "${CATEGORY_SLUGS.join(" | ")}",
  "audience": "${AUDIENCE_VALUES.join(" | ")}",
  "angle": "what the reader can decide or do differently after reading, in one sentence",
  "sourceHosts": ["hostnames you used"],
  "figures": [
    { "value": "as it appears in the document",
      "unit": "what it measures",
      "period": "when it applies",
      "source": "the instrument or publisher, named",
      "retrieved": "${day}",
      "evidence": "a verbatim excerpt copied from the document, which must contain the value",
      "evidence_from": "the SOURCE path above, exactly as written" }
  ],
  "sources": ["the instruments or publishers, one line each"]
}

Give five to eight figures. Every one needs an evidence excerpt that literally contains the value and
literally appears in the document it names. If the documents do not support any of the three evidence types, set
feasible to false and say so — that is a correct and useful answer, not a failure.`;

/*
 * Up to three proposals, each told what the last one lost to.
 *
 * A single proposal that the duplicate check rejects ended the run, which is the wrong response to a working check:
 * the corpus is deep, and the next subject a model names is usually a different one. The retry carries the rejected
 * keyword and slug so the second attempt is a different subject rather than the same one reworded - which is what
 * the duplicate check would reject again.
 *
 * The evidence check and the verification below run on the accepted proposal only, so a retry costs one model call
 * and no fetches.
 */
const PROPOSAL_ATTEMPTS = 3;
const rejectedSubjects = [];
let r = null;
let proposal = null;
/** The duplicate score of the accepted proposal, for the directive's _research block. */
let acceptedDupScore = null;

for (let attempt = 1; attempt <= PROPOSAL_ATTEMPTS; attempt++) {
  const retryNote = rejectedSubjects.length
    ? [
        "",
        "ALREADY REJECTED — do not propose these again, and do not reword them:",
        ...rejectedSubjects.map((x, i) => `  ${i + 1}. ${x.keyword}`),
        "",
        "Choose a different subject. A different product, a different measure, or a different institution.",
      ].join("\n")
    : "";

  console.log(
    `  proposing a subject from ${Math.min(fetched.length, 5)} archived document(s)` +
      (attempt > 1 ? ` (attempt ${attempt} of ${PROPOSAL_ATTEMPTS})` : "") +
      "...",
  );

  r = await askJson({
    role: "planner",
    system:
      "You select subjects for a trade-cost publication from documents supplied to you. You quote only " +
      "from those documents and you say so when they do not support an article. You never supply a " +
      "number that is not literally in a document you were given.",
    messages: [{ role: "user", content: prompt + retryNote }],
    maxTokens: 8192,
  });

  const spentHere = usageToday().usd - started.usd;
  if (!r.ok || !r.json) {
    console.log(`\n  FAILED - ${r.error ?? r.parseError ?? "unparseable response"}`);
    if (r.raw) console.log(`  raw head: ${String(r.raw).slice(0, 400)}`);
    console.log(`  spent   : ~${spentHere.toFixed(4)}`);
    process.exit(1);
  }

  const candidate = r.json;
  console.log(`  spent   : ~${spentHere.toFixed(4)}  (ceiling ${BUDGET.toFixed(2)})`);
  console.log(`  model   : ${r.provider}/${r.model}`);
  console.log("");
  console.log(`  feasible: ${candidate.feasible}`);

  if (candidate.feasible === false) {
    /* The documents do not support anything. A retry would ask the same question of the same material. */
    proposal = candidate;
    break;
  }

  /*
   * AN EXISTING SLUG IS A DUPLICATE, and this check has to live here.
   *
   * The orchestrator already refuses to overwrite a published file, and it is right to. But that refusal happens after
   * research has finished, so research never learns: on 2026-10-19 it proposed
   * eu-fdi-screening-2025-notification-rates-importer-compliance-2026 three times, scored it zero every time because
   * the keyword overlap was low, and the run ended DUPLICATE-SUBJECT with nothing written. The retry loop cannot help
   * if the only thing it knows how to count is keyword overlap.
   *
   * The collection is the authority - a slug that exists verbatim is the strongest possible duplicate, and it costs
   * one stat() to know.
   */
  const slugTaken = Boolean(candidate.slug) && existsSync(join(ROOT, "src", "content", "blog", `${candidate.slug}.md`));
  const checkDup = slugTaken
    ? { score: 99, why: [`the slug ${candidate.slug} is already in src/content/blog`], against: candidate.slug }
    : duplicateScore(candidate, ledger);
  if (slugTaken) console.log(`  slug already published: ${candidate.slug} - retrying with another subject`);
  console.log(`  slug    : ${candidate.slug}`);
  console.log(`  keyword : ${candidate.keyword}`);
  console.log(`  duplicate check: score ${checkDup.score}${checkDup.against ? ` against ${checkDup.against}` : ""}`);
  if (checkDup.why?.length) for (const w of checkDup.why) console.log(`      ${w}`);

  if (checkDup.score < 6) {
    proposal = candidate;
    /* The score that let it through, kept for the directive's provenance line. */
    acceptedDupScore = checkDup;
    break;
  }

  console.log("");
  console.log("  REJECTED as a duplicate - trying another subject rather than ending the day.");
  rejectedSubjects.push({ keyword: candidate.keyword, slug: candidate.slug, score: checkDup.score, proposal: candidate });
  proposal = null;
}

const spent = usageToday().usd - started.usd;

/*
 * Nothing published matches, so publish the narrowest version anyway.
 *
 * The operator's instruction on 2026-10-18, after two days of DUPLICATE-SUBJECT: a pipeline that refuses every day
 * because its own filter is nervous is worse than one that publishes a narrower article. The qualifier is the current
 * date, which is honest - the article is about what the documents say now - and it makes the slug unique, so a
 * published URL is never overwritten.
 */
/*
 * ALL SUBJECTS DUPLICATE means no article today, and that is the correct answer.
 *
 * This block used to append today's date to the slug and publish the last rejected proposal anyway. On 2026-10-20 it
 * produced eu-fdi-screening-notification-surge-2026-2026-10-19 - the same title, the same subject, a second URL for a
 * page that already existed. Two URLs competing for one keyword is self-competition in search, and the operator's rule
 * is the one that was already written down: a day without an article beats a duplicate.
 *
 * A date in the slug is only honest when the date is what changed - a new announcement, a new rate. research cannot
 * know that, so it does not get to pretend.
 */
if (!proposal && rejectedSubjects.length) {
  console.log("");
  console.log(`  ALL_SUBJECTS_DUPLICATE - all ${PROPOSAL_ATTEMPTS} proposals are already published.`);
  for (const r of rejectedSubjects) console.log(`    - ${r.slug} (score ${r.score})`);
  console.log("");
  console.log("  No directive was written. Publishing a near-duplicate under a new slug would compete with");
  console.log("  the existing article for the same keyword, which is worse for the site than a quiet day.");
  console.log("  Exit 2 tells the pipeline to report DUPLICATE-SUBJECT: yellow, not a failure.");
  process.exit(2);
}

if (!proposal) {
  console.log("");
  console.log("  No proposal was produced at all - the model returned nothing usable three times.");
  process.exit(1);
}

if (proposal.feasible === false) {
  console.log(`  reason  : ${proposal.reason_if_not}`);
  console.log("");
  console.log("  The documents do not support an article today. That is the answer, and no directive was");
  console.log("  written. A day without a qualifying subject is a day without an article.");
  process.exit(0);
}
console.log(`  slug    : ${proposal.slug}`);
console.log(`  keyword : ${proposal.keyword}`);
console.log(`  category: ${proposal.category}`);
console.log(`  figures : ${(proposal.figures ?? []).length}`);

/* ---------------------------------------------------------------- 3. duplicate check */

/*
 * The duplicate check now runs inside the proposal loop, so a rejection retries instead of ending the run. Nothing
 * to check here: `proposal` is a subject that already cleared it.
 */

/* ---------------------------------------------------------------- 4. verify the evidence */

mkdirSync(join(ROOT, "data", "tmp"), { recursive: true });
const probePath = join(ROOT, "data", "tmp", "research-proposal.json");
writeFileSync(probePath, JSON.stringify(proposal, null, 2), "utf8");

let evidenceOut = "";
let evidenceCode = 0;
try {
  evidenceOut = execFileSync(process.execPath, [join(ROOT, "tools", "check-evidence.mjs"), `--directive=${probePath}`, "--json"], { encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  evidenceOut = `${e.stdout ?? ""}`;
  evidenceCode = e.status ?? 1;
}
let evidence = null;
try {
  evidence = JSON.parse(evidenceOut)?.[0];
} catch {}

console.log(`\n  evidence check:`);
if (!evidence) {
  console.log("    the checker produced no result");
} else {
  console.log(`    external figures : ${evidence.checked}`);
  console.log(`    verified         : ${evidence.checked - (evidence.failed?.length ?? 0)}`);
  console.log(`    failed           : ${evidence.failed?.length ?? 0}`);
  for (const f of (evidence.failed ?? []).slice(0, 6)) {
    console.log(`      "${f.value}"  ${f.problems.join("; ")}`);
  }
}

if (evidenceCode !== 0 || (evidence?.failed?.length ?? 0) > 0) {
  console.log("");
  console.log("  REJECTED. At least one figure's excerpt is not in the document it cites. This is the check");
  console.log("  that makes unattended research safe: the model that proposed the number is not the thing");
  console.log("  that certifies it. No directive was written.");
  process.exit(3);
}

/* ---------------------------------------------------------------- 5. write the directive */

const directive = {
  _note:
    "Written by tools/research.mjs and verified by tools/check-evidence.mjs. Every external figure's " +
    "excerpt was found in its archived document and carries its value. Figures are the only numbers " +
    "the writer may use.",
  _generated: new Date().toISOString(),
  _research: {
    fetched: fetched.map((f) => ({ url: f.url, file: f.file, bytes: f.bytes })),
    model: `${r.provider}/${r.model}`,
    spentUsd: Number(spent.toFixed(4)),
    duplicateScore: acceptedDupScore?.score ?? 0,
    duplicateAgainst: acceptedDupScore?.against ?? null,
  },
  slug: proposal.slug,
  title_idea: proposal.title_idea,
  keyword: proposal.keyword,
  category: proposal.category,
  audience: proposal.audience,
  angle: proposal.angle,
  figures: proposal.figures,
  sources: proposal.sources,
};

if (DRY) {
  console.log(`\n  --dry-run: would write ${DIRECTIVE.replace(ROOT, "")}`);
  console.log(`  total spend this run: ~$${(usageToday().usd - started.usd).toFixed(4)}`);
  process.exit(0);
}

writeFileSync(DIRECTIVE, JSON.stringify(directive, null, 2), "utf8");

/*
 * A proposed subject is NOT a published subject, and the ledger is a list of published ones.
 *
 * This used to append the proposal to the ledger with articleNumber null and proposedNotYetPublished true, so that a
 * second run the same day could not repeat it. Nothing ever removed the entry. A subject proposed once and then
 * abandoned - because the writer was refused, or the run died - was permanently blacklisted, and on 2026-10-18 that
 * is what produced the "duplicate" verdicts: eu-fdi-screening was still in the ledger after its article was deleted,
 * and the ledger held 37 rows for 36 articles.
 *
 * The directive file already prevents a same-day repeat: it is consumed by the run that follows. The proposal goes to
 * its own file, which is a record and not a filter.
 */
appendFileSync(
  join(ROOT, "data", "proposed.jsonl"),
  JSON.stringify({ at: new Date().toISOString(), slug: proposal.slug, keyword: proposal.keyword, publishDate: day }) + "\n",
  "utf8",
);
console.log("");
console.log(`  wrote ${DIRECTIVE.replace(ROOT, "")}`);
console.log(`  spend this run: ~$${(usageToday().usd - started.usd).toFixed(4)}`);
console.log("");
console.log("  Next: node tools/cloud-orchestrator.mjs   (which will write, review and publish)");
process.exit(0);
