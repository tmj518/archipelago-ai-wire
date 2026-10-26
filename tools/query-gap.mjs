#!/usr/bin/env node
/**
 * Which queries does Google already show us for, and which of them have no page of their own.
 *
 * Search Console reports the query and the page it landed on, together, when both dimensions are
 * asked for. That pair is the whole point: a query with impressions and a page that is not about it
 * is a demand we are serving by accident - usually with a hub page, a category, or the wrong article -
 * and it is the cheapest writing list available, because Google has already decided the query is ours.
 *
 *   node tools/query-gap.mjs                     # 90-day window, queries from data + GSC
 *   node tools/query-gap.mjs --days=28 --min-imp=3
 *   node tools/query-gap.mjs --json              # machine-readable, for the audit workflow
 *
 * Output is written to data/gsc/gaps_YYYYMMDD.json and .md. Nothing on the site is touched.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gscSearchAnalytics, isoDaysAgo, loadEnv, today } from "./lib/gsc.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "data", "gsc");
const BLOG = join(ROOT, "src", "content", "blog");
const ENV_FILE = join(ROOT, ".env.keywords");

const args = { days: 90, minImp: 3, json: false };
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--days=")) args.days = Number(a.slice(7));
  else if (a.startsWith("--min-imp=")) args.minImp = Number(a.slice(10));
  else if (a === "--json") args.json = true;
  else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

const DATE = today().replace(/-/g, "");
const log = (s) => console.log(s);

/* ── what we have ─────────────────────────────────────────────────────────────────────────────── */

const STOP = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "at", "by", "is", "are", "vs", "how", "what", "when", "why", "does", "do", "with", "from", "s", "2026", "2027", "2028"]);

/** The published articles, with the keyword each one was written for. */
function articles() {
  const out = [];
  for (const f of readdirSync(BLOG)) {
    if (!f.endsWith(".md")) continue;
    const raw = readFileSync(join(BLOG, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
    if (/^draft:\s*true/m.test(fm)) continue;
    out.push({
      slug: f.replace(/\.md$/, ""),
      title: /^title:\s*"(.*?)"\s*$/m.exec(fm)?.[1] ?? "",
      keyword: (/^target_keyword:\s*"(.*?)"\s*$/m.exec(fm)?.[1] ?? "").toLowerCase().trim(),
      tokens: new Set(f.replace(/\.md$/, "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t))),
    });
  }
  return out;
}

const tokensOf = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));

/**
 * Is this query served by a page written for it?
 *
 * Two tests, either sufficient: the article declares the query as its target keyword, or the query's
 * significant words dominate that article's slug. The second is what catches "section 301 exclusions
 * expire" being served by section-301-exclusions-expire-november-2026 - the writer never declared the
 * shorter phrase, but the page is plainly about it.
 */
function coverage(query, arts) {
  const q = query.toLowerCase().trim();
  const exact = arts.find((a) => a.keyword && a.keyword === q);
  if (exact) return { covered: true, how: "target_keyword", slug: exact.slug };

  const qt = tokensOf(q);
  if (!qt.length) return { covered: false, how: "" };
  let best = null;
  for (const a of arts) {
    const hit = qt.filter((t) => a.tokens.has(t)).length;
    const share = hit / qt.length;
    if (share >= 0.6 && hit >= 2 && (!best || share > best.share)) best = { share, slug: a.slug };
  }
  return best ? { covered: true, how: `slug ${(best.share * 100) | 0}%`, slug: best.slug } : { covered: false, how: "" };
}

/* ── what Google says ──────────────────────────────────────────────────────────────────────────── */

const env = loadEnv(ENV_FILE);
if (!env.GSC_CREDENTIALS || !env.GSC_SITE_URL) {
  log("GSC not configured: set GSC_CREDENTIALS and GSC_SITE_URL, or run this in the audit workflow.");
  process.exit(2);
}

const stats = { gscCalls: 0, retries: 0 };
const window90 = { startDate: isoDaysAgo(args.days), endDate: today() };
const window14 = { startDate: isoDaysAgo(14), endDate: today() };

function query(payload) {
  const r = gscSearchAnalytics(env, payload, stats);
  return r?.rows ?? [];
}

const pairRows = query({ ...window90, dimensions: ["query", "page"], rowLimit: 25000 });
const totals14 = query({ ...window14, rowLimit: 1 });
const totals90 = query({ ...window90, rowLimit: 1 });

const sum = (rows) => {
  const o = { impressions: 0, clicks: 0 };
  for (const r of rows) {
    o.impressions += r.impressions ?? 0;
    o.clicks += r.clicks ?? 0;
  }
  o.ctr = o.impressions ? o.clicks / o.impressions : 0;
  return o;
};

/* One entry per query, with the page that earned the most of its impressions. */
const byQuery = new Map();
for (const r of pairRows) {
  const [q, page] = r.keys ?? [];
  if (!q) continue;
  const cur = byQuery.get(q) ?? { query: q, impressions: 0, clicks: 0, position: 0, pages: new Map() };
  cur.impressions += r.impressions ?? 0;
  cur.clicks += r.clicks ?? 0;
  cur.position = Math.max(cur.position, r.position ?? 0);
  cur.pages.set(page, (cur.pages.get(page) ?? 0) + (r.impressions ?? 0));
  byQuery.set(q, cur);
}

const arts = articles();
const isArticle = (page) => /\/blog\/[^/]+\/$/.test(String(page ?? ""));

const gaps = [];
/* Every query, with its verdict. A site this young has more queries below the floor than above it,
   and "sixteen queries under three impressions" is a finding, not an empty report. */
const allQueries = [];
let covered = 0;
for (const q of byQuery.values()) {
  const best = [...q.pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const cov = coverage(q.query, arts);
  allQueries.push({
    query: q.query,
    impressions: Math.round(q.impressions),
    clicks: q.clicks,
    position: Math.round(q.position * 10) / 10,
    covered: cov.covered,
    how: cov.how,
    slug: cov.slug ?? "",
    bestPage: best,
  });
  if (q.impressions < args.minImp) continue;
  if (cov.covered) {
    covered++;
    continue;
  }
  gaps.push({
    query: q.query,
    impressions: Math.round(q.impressions),
    clicks: q.clicks,
    ctr: q.impressions ? q.clicks / q.impressions : 0,
    bestPage: best,
    bestPageIsArticle: isArticle(best),
    /*
     * "hub" is the expensive one: Google shows a category or the home page for a specific query, which
     * means we have no page that answers it. "wrong article" means we have one but it is not this.
     */
    kind: isArticle(best) ? "wrong article" : "hub page",
  });
}
gaps.sort((a, b) => b.impressions - a.impressions);
allQueries.sort((a, b) => b.impressions - a.impressions);

const payload = {
  at: new Date().toISOString(),
  site: env.GSC_SITE_URL,
  days: args.days,
  window: window90,
  totals: { last14: sum(totals14), overWindow: sum(totals90) },
  counts: { queries: byQuery.size, covered, gaps: gaps.length, articles: arts.length },
  gaps,
  allQueries,
};

if (!args.json) {
  log("");
  log(`QUERY GAP  ${payload.site}  ${window90.startDate} .. ${window90.endDate}`);
  log("=".repeat(94));
  log(`  queries with impressions >= ${args.minImp} : ${payload.counts.queries}`);
  log(`  served by a page of their own             : ${covered}`);
  log(`  no page                                   : ${gaps.length}`);
  log(`  last 14 days : ${payload.totals.last14.impressions} impressions, ${payload.totals.last14.clicks} clicks, CTR ${(payload.totals.last14.ctr * 100).toFixed(2)}%`);
  log("");
  if (gaps.length) {
    log("  query".padEnd(58) + "imp".padStart(6) + "  pos  kind           best page");
    log("  " + "-".repeat(108));
    for (const g of gaps.slice(0, 40)) {
      const best = String(g.bestPage).replace(/^https?:\/\/[^/]+/, "").slice(0, 44);
      log(`  ${g.query.slice(0, 56).padEnd(58)}${String(g.impressions).padStart(6)}  ${"?"}  ${g.kind.padEnd(14)} ${best}`);
    }
  }
  log("");
  log("  every query, including the ones below the floor:");
  for (const q of allQueries.slice(0, 25)) {
    const tag = q.covered ? `covered ${q.how}` : "NO PAGE";
    log(`    ${String(q.impressions).padStart(4)} imp  ${String(q.position).padStart(5)}  ${tag.padEnd(18)} ${q.query.slice(0, 60)}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, `gaps_${DATE}.json`);
  const mdPath = join(OUT_DIR, `gaps_${DATE}.md`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(
    mdPath,
    [
      `# 词 → 页 缺口 · ${today()}`,
      "",
      `窗口 ${window90.startDate} → ${window90.endDate}（${args.days} 天） · 属性 ${payload.site}`,
      "",
      `- 有曝光的查询：**${payload.counts.queries}**`,
      `- 已有专页：**${covered}**`,
      `- 没有专页：**${gaps.length}**`,
      `- 近 14 天：${payload.totals.last14.impressions} 曝光 / ${payload.totals.last14.clicks} 点击 / CTR ${(payload.totals.last14.ctr * 100).toFixed(2)}%`,
      "",
      "## 没有专页的查询（按曝光排序）",
      "",
      "| 查询 | 曝光 | 点击 | 承接页 | 类型 |",
      "| --- | --- | --- | --- | --- |",
      ...gaps.slice(0, 200).map((g) => `| ${g.query} | ${g.impressions} | ${g.clicks} | ${String(g.bestPage).replace(/^https?:\/\/[^/]+/, "")} | ${g.kind} |`),
      "",
      "## 全部查询（含低于门槛的）",
      "",
      "| 查询 | 曝光 | 点击 | 平均排名 | 有对应页 |",
      "| --- | --- | --- | --- | --- |",
      ...allQueries.slice(0, 300).map((q) => `| ${q.query} | ${q.impressions} | ${q.clicks} | ${q.position} | ${q.covered ? q.how : "**没有**"} |`),
      "",
      "_只读：这份报告不回写任何站点文件。_",
      "",
    ].join("\n"),
    "utf8",
  );
  log("");
  log(`  written: ${jsonPath.replace(ROOT, "").replace(/\\/g, "/")}`);
  log(`  written: ${mdPath.replace(ROOT, "").replace(/\\/g, "/")}`);
} else {
  console.log(JSON.stringify(payload, null, 2));
}
