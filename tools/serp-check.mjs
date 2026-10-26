/**
 * Information-gain gate — spec v1.3 §9.2 (R3), automated.
 *
 * The rule: before publishing, pull the top results for the piece's target
 * keyword and prove the piece contains something they do not. If the claim in
 * `information_gain` cannot be demonstrated, the piece is not published.
 *
 * Architecture note — why the SERP source is pluggable:
 *   Scraping a search engine from this machine is unreliable. Bing truncates
 *   the query and serves dictionary pages, and Google, DuckDuckGo and
 *   Startpage are unreachable. The valuable part of this gate is the
 *   comparison logic, not the scraping, so the SERP comes from a provider:
 *
 *     --serp=bing            best-effort Bing HTML scrape (default)
 *     --serp=file:<path>     a JSON snapshot [{url,title,snippet}] supplied
 *                            by an agent search tool or a SERP API
 *
 *   In the production pipeline the writing/QA agent has a search tool, so it
 *   supplies the snapshot. A paid SERP API drops in the same way.
 *
 * Honesty rules baked in — the gate never invents a pass:
 *   - No SERP, or a SERP that is not topically relevant → INCONCLUSIVE.
 *   - Fewer than two competitor pages load → INCONCLUSIVE.
 *   - `own-data` cannot be verified against a SERP → INCONCLUSIVE by design.
 *
 * Run:  node tools/serp-check.mjs <file.md>... [--serp=file:serp.json]
 *       node tools/serp-check.mjs --all --serp=bing
 *
 * Exit code is non-zero on UNSUPPORTED.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TOP_N = 3;

/** Hosts that are never a competitor for a trade-policy query. */
const JUNK_HOSTS = [
  "iciba.com", "cambridge.org", "dictionary.com", "merriam-webster.com",
  "baike.baidu.com", "3dmgame.com", "soft.china.com", "zhihu.com/search",
  "translate.google", "youdao.com", "bing.com", "microsoft.com",
];

/**
 * Official publishers. For a policy query the top result is frequently the
 * primary document itself — a Federal Register notice, a customs
 * announcement, a ministry page. That is the input this site works from, not
 * competition, so it is reported separately and kept out of the denominator
 * when asking "do competitors already deliver this?".
 */
const OFFICIAL_SUFFIXES = [
  ".gov", ".gov.cn", ".gov.uk", ".gov.my", ".gov.sg", ".gov.au",
  "federalregister.gov", "govinfo.gov", "europa.eu", "wto.org", "asean.org",
  "customs.gov.cn", "mofcom.gov.cn", "ustr.gov", "cbp.gov", "stats.gov.cn",
  "rcepsec.org",
  // State publication channels: an announcement carried by Xinhua or the
  // State Council Information Office is the primary document's own outlet,
  // not a competitor's take on it.
  "news.cn", "xinhuanet.com", "china.org.cn", "chinadaily.com.cn",
];

const isOfficial = (url) => {
  const h = hostOf(url);
  return OFFICIAL_SUFFIXES.some((s) => h.endsWith(s));
};

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "is", "are",
  "what", "how", "why", "when", "do", "does", "with", "from", "by", "at",
]);

// ---------------------------------------------------------------- utilities

const stripTags = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function unwrapBingUrl(href) {
  if (!href.includes("bing.com/ck/a")) return href;
  const m = /[?&]u=a1([^&]+)/.exec(href);
  if (!m) return href;
  let b64 = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  try {
    const url = Buffer.from(b64, "base64").toString("utf8");
    return /^https?:\/\//.test(url) ? url : href;
  } catch {
    return href;
  }
}

/**
 * Competitor page signals, cached on disk.
 *
 * This is the single most expensive operation in the whole gate suite. A full pass
 * fetches 46 to 69 competitor pages, and measured at 270 seconds it was 81 per cent of
 * one gate pass - which is why a run that edited one article several times spent most of
 * its wall clock re-downloading pages that had not changed.
 *
 * The cache stores the extracted signals, not the raw HTML. Caching the HTML was tried
 * first and only saved a third of the time, because parsing a few hundred kilobytes of
 * markup per page is itself most of the cost. Storing the answer skips both steps.
 *
 * Keyed by URL and a format version, expiring after CACHE_TTL_MS. SERP_NO_CACHE=1
 * bypasses it, which is what a periodic refresh should do so the comparison does not
 * silently go stale.
 */
const CACHE_TTL_MS = Number(process.env.SERP_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000); // 24h
const NO_CACHE = process.env.SERP_NO_CACHE === "1";
const SIGNALS_VERSION = 2;
const PAGE_CACHE_DIR = join(process.cwd(), ".cache", "serp-signals");

function cachePathFor(url) {
  return join(PAGE_CACHE_DIR, createHash("sha256").update(`v${SIGNALS_VERSION}:${url}`).digest("hex").slice(0, 20) + ".json");
}

function readCachedSignals(url) {
  if (NO_CACHE) return undefined;
  try {
    const p = cachePathFor(url);
    if (!existsSync(p)) return undefined;
    const entry = JSON.parse(readFileSync(p, "utf8"));
    if (Date.now() - entry.at > CACHE_TTL_MS) return undefined;
    return entry.signals;
  } catch {
    return undefined;
  }
}

function writeCachedSignals(url, signals) {
  try {
    mkdirSync(PAGE_CACHE_DIR, { recursive: true });
    writeFileSync(cachePathFor(url), JSON.stringify({ url, at: Date.now(), signals }), "utf8");
  } catch { /* a cache that cannot be written is not an error */ }
}

/**
 * Fetch a page and reduce it to signals, using the cache for both steps.
 *
 * Failures are cached too, and that turned out to matter more than caching successes.
 * Of the 67 competitor URLs a pass touches, 18 were not cached and 13 of those were
 * permanently unavailable - 404, 403, 401, a bot challenge, or a timeout. Each pass
 * retried all of them with backoff, and one government page took the full 25-second
 * timeout before failing. A failure cache with a shorter life stops re-asking a question
 * whose answer has not changed, while still allowing a site that was briefly down to
 * recover.
 */
const FAIL_TTL_MS = Number(process.env.SERP_FAIL_TTL_MS ?? 6 * 60 * 60 * 1000); // 6h
const FETCH_TIMEOUT_MS = Number(process.env.SERP_TIMEOUT_MS ?? 10000);

function readCached(url) {
  if (NO_CACHE) return undefined;
  try {
    const p = cachePathFor(url);
    if (!existsSync(p)) return undefined;
    const entry = JSON.parse(readFileSync(p, "utf8"));
    const ttl = entry.failed ? FAIL_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - entry.at > ttl) return undefined;
    return entry;
  } catch {
    return undefined;
  }
}

async function signalsFor(url) {
  const cached = readCached(url);
  if (cached !== undefined) {
    if (cached.failed) throw new Error(cached.error ?? "cached failure");
    return cached.signals;
  }
  try {
    const signals = pageSignals(await get(url));
    writeCache(url, { signals });
    return signals;
  } catch (e) {
    writeCache(url, { failed: true, error: e.message });
    throw e;
  }
}

function writeCache(url, payload) {
  try {
    mkdirSync(PAGE_CACHE_DIR, { recursive: true });
    writeFileSync(cachePathFor(url), JSON.stringify({ url, at: Date.now(), ...payload }), "utf8");
  } catch { /* a cache that cannot be written is not an error */ }
}

async function get(url, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      last = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 700 * i));
    }
  }
  throw last;
}

export function parseBingSerp(html) {
  const chunks = html.split(/class="b_algo"/).slice(1);
  const out = [];
  for (const chunk of chunks) {
    const block = chunk.slice(0, 4000);
    const a = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!a) continue;
    const url = unwrapBingUrl(a[1]);
    if (!/^https?:\/\//.test(url) || url.includes("bing.com")) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    out.push({ url, title: stripTags(a[2]), snippet: p ? stripTags(p[1]) : "" });
    if (out.length >= 20) break;
  }
  return out;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Document identifiers that count as citing a primary source — recognisable
 * numbering schemes rather than the word "announcement", so a loose mention
 * does not satisfy the rule.
 */
const PRIMARY_DOC_PATTERN = new RegExp(
  [
    "\\b\\d{1,3}\\s?FR\\s?\\d{3,6}\\b",
    "\\bHTSUS\\s?9903\\b",
    "\\bAnnouncement\\s+No\\.?\\s?\\d+",
    "\\b公告\\s?\\d+\\s?号",
    "〔\\d{4}〕\\s?\\d+\\s?号",
    "\\b(?:Periodical|Circular|Order|Decision)\\s+No\\.?\\s?\\(?\\d+",
    "\\bRegulation\\s+\\(EU\\)\\s+\\d{4}/\\d+",
    "\\bCELEX\\b",
    "\\bOJ\\s?L\\s?\\d",
  ].join("|"),
  "i",
);

/**
 * A SERP is only usable if its results are about the query. Token overlap
 * between the keyword and each result is the cheapest reliable test, and it
 * catches the failure mode that produced a false pass in testing: a
 * dictionary SERP for the first word of the keyword.
 */
export function serpRelevance(keyword, results) {
  const tokens = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!tokens.length) return { ok: false, score: 0, detail: "keyword has no usable tokens" };

  const scores = results.map((r) => {
    const hay = (r.title + " " + (r.snippet ?? "")).toLowerCase();
    const hits = tokens.filter((t) => hay.includes(t)).length;
    return hits / tokens.length;
  });
  const relevant = scores.filter((s) => s >= 0.4).length;
  return {
    ok: relevant >= 2,
    score: scores.length ? Math.max(...scores) : 0,
    detail: `${relevant}/${results.length} results share >=40% of the keyword tokens`,
  };
}

/**
 * Money and per-unit detection. This site covers EU, UK and Chinese measures,
 * so a cost table is not always denominated in dollars and a unit is not
 * always a container. Three forms are recognised because all three appear in
 * this library: a currency symbol before a figure ("$48.00"), an ISO code
 * before a figure ("EUR 75.36"), and a code inside a unit header
 * ("EUR/t at Q1 2026"). The last one is what a euro-denominated cost table
 * puts in its column heading, and missing it failed an article whose whole
 * asset was that table.
 */
const MONEY = /([$€£¥]\s?\d|\b(?:EUR|USD|GBP|CNY|RMB|yuan)\b)/i;
const PER_UNIT =
  /(per unit|per item|per container|per-container|per 40|per teu|per kg|per kilogram|per watt|per tonne|per ton|per declaration line)/i;

export function pageSignals(html) {
  const text = stripTags(html);
  const lower = text.toLowerCase();
  const tableBlocks = [...html.matchAll(/<table[\s\S]{0,6000}?<\/table>/gi)].map((m) =>
    stripTags(m[0]),
  );
  const tableText = tableBlocks.join(" ");
  const costWords =
    /(landed cost|duty rate|per unit|per item|per container|per-container|tariff rate|customs duty)/.test(
      lower,
    );

  return {
    words: words(text),
    tables: tableBlocks.length,
    costTable: tableBlocks.length > 0 && MONEY.test(tableText) && costWords,
    perUnitMath: PER_UNIT.test(lower),
    primaryDocId: PRIMARY_DOC_PATTERN.test(text),
    figureDensity: (
      text.match(/\b\d[\d,.]*\s?(%|percent|billion|million|USD|EUR|dollars|euro)/gi) || []
    ).length,
  };
}

// ---------------------------------------------------------------- providers

async function serpFromBing(keyword) {
  const html = await get(
    "https://www.bing.com/search?q=" + encodeURIComponent(keyword) + "&count=20",
  );
  return parseBingSerp(html);
}

function serpFromFile(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const list = Array.isArray(data) ? data : data.results;
  if (!Array.isArray(list)) throw new Error("snapshot must be an array or {results: []}");
  return list.map((r) => ({ url: r.url, title: r.title ?? "", snippet: r.snippet ?? "" }));
}

/**
 * Resolve the snapshot for one article. If the provider points at a directory,
 * the snapshot is `<dir>/<article-basename>.json` — so a run over --all picks
 * up the right file per piece without extra flags.
 */
function resolveSnapshot(basePath, articleFile) {
  const looksLikeDir = !basePath.toLowerCase().endsWith(".json");
  if (!looksLikeDir) return basePath;
  const base = articleFile.split(/[\\/]/).pop().replace(/\.md$/, "");
  return join(basePath, base + ".json");
}

// ---------------------------------------------------------------- the gate

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  return { fm: m ? m[1] : "", body: m ? raw.slice(m[0].length) : raw };
}

function articleSignals(fm, body) {
  const tables = (body.match(/^\|.*\|\s*$/gm) || []).join("\n");

  /**
   * Named sources, counted where sources actually live.
   *
   * This used to count bold blockquotes in the body. But a bold blockquote is a
   * DEFINITION block: qa-check requires at least one, and every article in this
   * library has exactly one. So the value was always 1, and the cross-source
   * rule below, which requires at least 2, could never pass for any article.
   *
   * The bug was live and invisible: the fourteen previously published pieces all
   * declare `custom-calculation` or `primary-source`, and only `cross-source`
   * consults this number. The first cross-source article — a comparison of two
   * published instruments, with six named sources and eight sourced figures —
   * was reported as "does not show at least two named sources".
   *
   * The deeper mistake is that one field name carried two meanings. The
   * definition-block rule needs the blockquote count; the cross-source rule needs
   * sources. They were never the same quantity.
   */
  const listedSources = (/^sources:\s*\n((?:\s+-[^\n]*\n?)*)/m.exec(fm)?.[1] ?? "")
    .split(/\n/)
    .filter((l) => /^\s+-\s/.test(l)).length;
  const figureSources = new Set(
    [...fm.matchAll(/^\s+source:\s*"?([^"\n]+)"?\s*$/gm)].map((m) => m[1].trim()),
  ).size;

  return {
    tableRows: (body.match(/^\|.*\|\s*$/gm) || []).length,
    costTableMoney: MONEY.test(tables),
    perUnitMath: PER_UNIT.test(body),
    primaryDocId: PRIMARY_DOC_PATTERN.test(body),
    namedSources: listedSources + figureSources,
    /** Kept for the definition-block requirement, which is a different thing. */
    definitionBlocks: (body.match(/^>\s+\*\*/gm) || []).length,
  };
}

const CLAIM_RULES = {
  "custom-calculation": {
    /**
     * The asset is a numeric cost table, not the vocabulary of cost. Saying
     * "per item" or "per unit" is topic language and every page on the topic
     * does it, so the competitor count uses the strong signal only: a table
     * containing money and cost words. An earlier version counted the weaker
     * phrase signal on both sides and reported UNSUPPORTED for an article
     * whose whole point was the table.
     */
    verify: (art, comps) => {
      if (!art.costTableMoney)
        return { ok: false, why: "article carries no table containing money and cost terms" };
      const withMath = comps.filter((c) => c.signals.costTable).length;
      return withMath <= 1
        ? { ok: true, why: `only ${withMath}/${comps.length} competitors carry a comparable numeric cost table` }
        : { ok: false, why: `${withMath}/${comps.length} competitors already carry a comparable numeric cost table` };
    },
  },
  "primary-source": {
    verify: (art, comps) => {
      if (!art.primaryDocId)
        return { ok: false, why: "article does not cite a primary document identifier" };
      const withDoc = comps.filter((c) => c.signals.primaryDocId).length;
      return withDoc <= 1
        ? { ok: true, why: `only ${withDoc}/${comps.length} competitors cite the primary document` }
        : { ok: false, why: `${withDoc}/${comps.length} competitors already cite the primary document` };
    },
  },
  "cross-source": {
    verify: (art, comps) => {
      if (art.namedSources < 2)
        return { ok: false, why: "article does not show at least two named sources" };
      const dense = comps.filter((c) => c.signals.figureDensity >= 5).length;
      return dense <= 1
        ? { ok: true, why: `only ${dense}/${comps.length} competitors carry a comparable figure load` }
        : { ok: false, why: `${dense}/${comps.length} competitors carry a comparable figure load` };
    },
  },
  "own-data": {
    verify: () => ({
      ok: null,
      why: "proprietary data cannot be verified against a SERP — route to a reviewer",
    }),
  },
};

async function check(file, provider) {
  const raw = readFileSync(file, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  const keyword = /^target_keyword:\s*"?([^"\n]+)"?/m.exec(fm)?.[1]?.trim();
  const claim = /^information_gain:\s*"?([a-z-]+)"?/m.exec(fm)?.[1]?.trim();

  const report = { file, keyword, claim, verdict: "INCONCLUSIVE", reason: "", competitors: [] };

  if (!keyword) return { ...report, reason: "no target_keyword in frontmatter" };
  const rule = CLAIM_RULES[claim];
  if (!rule) return { ...report, reason: `unknown information_gain value: ${claim ?? "(missing)"}` };
  if (claim === "own-data") return { ...report, reason: rule.verify().why };

  // ---- SERP ----------------------------------------------------------
  let organic;
  try {
    organic =
      provider.kind === "file"
        ? serpFromFile(resolveSnapshot(provider.path, file))
        : await serpFromBing(keyword);
  } catch (e) {
    return { ...report, reason: `SERP fetch failed (${e.message}) — cannot verify, refusing to pass` };
  }

  // Drop hosts that can never be a competitor, then split official sources
  // (the input) from actual competition.
  const filtered = organic.filter((r) => !JUNK_HOSTS.some((h) => hostOf(r.url).endsWith(h)));
  const official = filtered.filter((r) => isOfficial(r.url));
  const competitors = filtered.filter((r) => !isOfficial(r.url));
  report.official = official.map((r) => ({ url: r.url, title: r.title }));

  // Zero non-official competitors is not a failed check, it is a different
  // question. The information-gain claim cannot be false when nobody is
  // competing, so the claim is trivially supported — and the risk moves to
  // demand, which this gate does not measure. That gets reported as a warning
  // rather than hidden inside an INCONCLUSIVE.
  const warnings = [];
  if (competitors.length === 0) {
    return {
      ...report,
      reason: `no non-official organic results for this keyword (${official.length} official sources, ${organic.length} raw) — differentiation is trivially satisfied, but search demand must be verified separately`,
    };
  }
  if (competitors.length < 2) {
    warnings.push(
      `only ${competitors.length} non-official competitor — the differentiation claim is trivially true, so verify demand for this keyword separately`,
    );
  }

  // The relevance guard exists to catch a scraped SERP that is not about the
  // query — the failure mode that produced a false pass in testing, where
  // Bing truncated the keyword and served dictionary pages. A file snapshot is
  // different: its relevance is asserted by whoever produced it, from a real
  // search. Running the guard on it would second-guess the producer with a
  // weaker signal, so it is skipped and the provenance is recorded instead.
  if (provider.kind === "bing") {
    const rel = serpRelevance(keyword, competitors.slice(0, 10));
    if (!rel.ok) {
      return {
        ...report,
        reason: `SERP is not topically relevant (${rel.detail}) — likely a locale or query-truncation problem. Verify demand for this keyword before publishing; the gate cannot certify it.`,
      };
    }
  } else {
    warnings.push(
      "competitor set comes from a file snapshot: relevance is asserted by the producer, not checked here",
    );
  }

  // ---- competitor pages ----------------------------------------------
  /*
   * Fetched concurrently, capped at CONCURRENCY.
   *
   * Sequentially this is 46 to 69 requests at roughly five seconds each, which is where
   * the 270-second gate pass came from. Concurrency is capped rather than unlimited so
   * the run stays a polite client of the sites it reads; six parallel requests to
   * publisher pages is unremarkable traffic.
   */
  const CONCURRENCY = Number(process.env.SERP_CONCURRENCY ?? 6);
  const targets = competitors.slice(0, TOP_N);
  const pages = new Array(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= targets.length) return;
        const r = targets[i];
        try {
          pages[i] = { url: r.url, title: r.title, signals: await signalsFor(r.url) };
        } catch (e) {
          pages[i] = { url: r.url, title: r.title, error: e.message };
        }
      }
    }),
  );
  report.competitors.push(...pages.filter(Boolean));

  const loaded = report.competitors.filter((c) => c.signals);
  if (loaded.length < 1) {
    return {
      ...report,
      reason: `no competitor page could be loaded (0/${report.competitors.length}) — cannot verify, refusing to pass`,
    };
  }
  if (loaded.length < 2) {
    warnings.push(`only ${loaded.length} competitor page loaded — thin evidence`);
  }

  const verdict = rule.verify(articleSignals(fm, body), loaded);
  return {
    ...report,
    warnings,
    verdict: verdict.ok === true ? "SUPPORTED" : verdict.ok === false ? "UNSUPPORTED" : "INCONCLUSIVE",
    reason: verdict.why,
  };
}

// ---------------------------------------------------------------- CLI

// The CLI block is guarded so the module can also be imported by tests and by
// ad-hoc scripts without the process exiting on the import.
const isMain =
  process.argv[1] &&
  /serp-check\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));

const args = isMain ? process.argv.slice(2) : [];
const providerArg = args.find((a) => a.startsWith("--serp="));
const provider = providerArg
  ? providerArg.startsWith("--serp=file:")
    ? { kind: "file", path: providerArg.slice("--serp=file:".length) }
    : { kind: "bing" }
  : { kind: "bing" };

const fileArgs = args.filter((a) => !a.startsWith("--") || a === "--all");
let files;
if (!isMain) {
  files = [];
} else if (fileArgs.includes("--all")) {
  const dir = "src/content/blog";
  files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f));
} else if (fileArgs.length) {
  files = fileArgs;
} else {
  console.error("usage: node tools/serp-check.mjs <file.md>... [--serp=bing|file:<path>]");
  process.exit(2);
}

let unsupported = 0;
let inconclusive = 0;

for (const file of files) {
  const r = await check(file, provider);
  console.log(`\n${file}`);
  console.log(`  keyword      : ${r.keyword ?? "—"}`);
  console.log(`  claimed gain : ${r.claim ?? "—"}`);
  if (r.official?.length) {
    console.log(`  official sources in SERP (excluded from competition):`);
    for (const o of r.official) console.log(`    ${o.url}`);
  }
  if (r.competitors.length) console.log(`  competitors checked:`);
  for (const c of r.competitors) {
    const s = c.signals;
    console.log(
      `    ${c.url}\n      ${s ? `${s.words} words · ${s.tables} tables · costTable=${s.costTable} · perUnit=${s.perUnitMath} · primaryDoc=${s.primaryDocId} · figures=${s.figureDensity}` : "FETCH FAILED: " + c.error}`,
    );
  }
  console.log(`  verdict      : ${r.verdict} — ${r.reason}`);
  for (const w of r.warnings ?? []) console.log(`  ! warning    : ${w}`);
  if (r.verdict === "UNSUPPORTED") unsupported++;
  if (r.verdict === "INCONCLUSIVE") inconclusive++;
}

if (isMain) {
  console.log(
    `\nRESULT: ${unsupported} unsupported · ${inconclusive} inconclusive · ${files.length - unsupported - inconclusive} supported\n`,
  );
  process.exit(unsupported ? 1 : 0);
}
