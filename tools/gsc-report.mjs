#!/usr/bin/env node
/**
 * Search Console feedback report — the loop that turns published data into the
 * next week's decisions.
 *
 * Spec §8 defines four actions, and this script assigns one to every published
 * article by measuring it rather than by opinion:
 *
 *   impressions, no clicks            -> rewrite title and description
 *   impressions and a poor CTR        -> rewrite the title (the promise is wrong)
 *   impressions but ranking 11-20     -> optimise, page one is reachable
 *   ranking in the top 10             -> hold, and consider doubling the topic
 *   no impressions in the window      -> re-run the QA gates: if the piece still
 *                                        passes, the topic was wrong and it goes
 *                                        back to the pool; if it fails, the gate
 *                                        missed something and the rule changes
 *   queries the site is not targeting -> next week's topic pool
 *
 * The last one is the reason to read the report at all. GSC reports what people
 * actually typed, which is the only keyword data that is not a guess.
 *
 * Output, in data/gsc/:
 *   report_YYYYMMDD.md     the human read
 *   articles_YYYYMMDD.csv  one row per published article, with its action
 *   queries_YYYYMMDD.csv   real queries with impressions, for the topic pool
 *   run_YYYYMMDD.log
 *
 * Usage
 *   node tools/gsc-report.mjs                 # 28-day window
 *   node tools/gsc-report.mjs --days=90
 *   node tools/gsc-report.mjs --dry-run       # fetch and print, write nothing
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gscAccessToken, gscSearchAnalytics, httpCurl, isoDaysAgo, loadEnv, today } from "./lib/gsc.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "data", "gsc");
const BLOG_DIR = join(ROOT, "src", "content", "blog");
const ENV_FILE = join(ROOT, ".env.keywords"); // shared with the keyword miner

const args = { days: 28, dryRun: false, force: false, allowMissingCredentials: false };
for (const a of process.argv.slice(2)) {
  if (a === "--dry-run") args.dryRun = true;
  else if (a === "--force") args.force = true;
  else if (a === "--allow-missing-credentials") args.allowMissingCredentials = true;
  else if (a.startsWith("--days=")) args.days = parseInt(a.slice(7), 10);
  /*
   * --json prints the page rows as JSON instead of drawing the report.
   *
   * tools/optimize-titles.mjs needs the numbers per page and nothing else, and re-implementing the JWT signing and the
   * searchAnalytics call there would be a second copy of the part most likely to break. One flag here, one reader
   * there.
   */
  else if (a === "--json") args.json = true;
  /*
   * --sites asks the question this project spent a day answering by guesswork:
   * which properties can this credential actually read, and which of them holds
   * the rows. See the block below for why an empty answer is ambiguous.
   */
  else if (a === "--sites") args.sites = true;
  else { console.error(`unknown argument: ${a}`); process.exit(2); }
}

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const DATE = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const ISO = today();

mkdirSync(OUT_DIR, { recursive: true });
const LOG = join(OUT_DIR, `run_${DATE}.log`);
const stats = { retries: 0, gscCalls: 0, started: Date.now() };

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  /*
   * --json goes to stderr, so stdout is the document and nothing else.
   *
   * These lines used to go to stdout in every mode, which left three timestamped lines in front of the
   * JSON. A reader that slices from the first '{' (tools/optimize-titles.mjs) survives that, but
   * `node tools/gsc-report.mjs --json > payload.json` does not: the file is not JSON, and it took a
   * failed parse in the audit workflow to notice. A flag called --json should be pipeable.
   */
  (args.json ? console.error : console.log)(line);
  appendFileSync(LOG, line + "\n", "utf8");
}

/**
 * Stop the run, recording why.
 *
 * `--allow-missing-credentials` changes one outcome and only one: an unconfigured Search
 * Console exits 0 instead of 1. The distinction matters because the daily wrapper runs this
 * advisory - a credential nobody has created yet says nothing about whether an article
 * published, and returning 1 there would mark every run as failed until the setup was done,
 * which teaches whoever reads the log to ignore the step entirely.
 *
 * Every other reason still exits 1: an API that rejects the credentials, a property that
 * cannot be read, a malformed response. Those are real failures and should look like failures.
 */
function bail(reason) {
  const unconfigured = /not configured/i.test(reason);
  const marker = join(OUT_DIR, `report_${DATE}.failed`);
  writeFileSync(marker, `run: ${DATE}\nreason: ${reason}\nstats: ${JSON.stringify(stats)}\n`, "utf8");
  log(`FAILED: ${reason}`);
  log(`marker: ${marker}`);
  if (unconfigured && args.allowMissingCredentials) {
    log("treating an unconfigured Search Console as advisory (--allow-missing-credentials)");
    process.exit(0);
  }
  process.exit(1);
}

log(`gsc report start  window=${args.days}d  dryRun=${args.dryRun}`);

if (existsSync(join(OUT_DIR, `report_${DATE}.md`)) && !args.force && !args.dryRun && !args.json && !args.sites) {
  log("today's report already exists — no-op. Use --force to override.");
  process.exit(0);
}

// ------------------------------------------------------- what we published

/** Every published article, with its target keyword and its live URL. */
function published() {
  const out = [];
  for (const file of readdirSync(BLOG_DIR)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(join(BLOG_DIR, file), "utf8");
    if (/^draft:\s*true/m.test(raw)) continue;
    const slug = file.replace(/\.md$/, "");
    const title = /^title:\s*"(.+?)"/m.exec(raw)?.[1] ?? slug;
    out.push({
      slug,
      title,
      url: `https://landedmath.com/blog/${slug}/`,
      path: `/blog/${slug}/`,
      keyword: /^target_keyword:\s*"(.+?)"/m.exec(raw)?.[1] ?? "",
      category: /^category:\s*"(.+?)"/m.exec(raw)?.[1] ?? "",
      publishDate: /^publishDate:\s*(\S+)/m.exec(raw)?.[1] ?? "",
    });
  }
  return out;
}

const articles = published();
log(`  ${articles.length} published articles`);

const env = loadEnv(ENV_FILE);
if (!env.GSC_CREDENTIALS || !env.GSC_SITE_URL) {
  bail(
    "GSC not configured. Set GSC_CREDENTIALS and GSC_SITE_URL in .env.keywords. " +
    "See the header of tools/keyword-miner.mjs for the one-time setup.",
  );
}

// ------------------------------------------------------------------- fetch

const window = { startDate: isoDaysAgo(args.days), endDate: ISO };
log(`  window ${window.startDate} .. ${window.endDate}`);

/*
 * --sites: price every property, not just the configured one.
 *
 * One host can carry several GSC properties at once - a Domain property,
 * sc-domain:landedmath.com, plus a URL-prefix property per scheme and subdomain -
 * and each is a separate dataset behind a separate permission. The API answers
 * whichever string is in the URL. So an empty result from the wrong property and
 * an empty result from the right one look identical, which is how "0 rows" turns
 * into a theory about traffic.
 *
 *   node tools/gsc-report.mjs --sites --days=90
 *
 * Prints what the credential can read, whether the configured string is in that
 * list, and how many page rows and impressions the window holds behind each one.
 * A property that is configured but absent from the list means every query against
 * it is answered with nothing, forever, and no amount of widening the window helps.
 */
if (args.sites) {
  const token = gscAccessToken(env, stats);
  if (!token) bail("GSC is configured but produced no access token; nothing can be queried.");

  const list = JSON.parse(httpCurl([
    "-4", "-sS", "--max-time", "30",
    "-H", `Authorization: Bearer ${token}`,
    "https://searchconsole.googleapis.com/webmasters/v3/sites",
  ]));
  if (list.error) bail(`sites.list failed: ${list.error.message}`);

  const sites = list.siteEntry ?? [];
  const want = env.GSC_SITE_URL;
  const encode = (s) => encodeURIComponent(s);

  log("");
  log(`  GSC_SITE_URL        ${want}`);
  log(`  properties readable ${sites.length}`);
  for (const s of sites) {
    log(`    ${String(s.permissionLevel ?? "?").padEnd(16)} ${s.siteUrl}${s.siteUrl === want ? "   <- configured" : ""}`);
  }
  if (!sites.some((s) => s.siteUrl === want)) {
    log(`    CONFIGURED PROPERTY IS NOT IN THAT LIST — every query against it answers empty.`);
  }

  log("");
  log(`  page rows behind each property, ${window.startDate} .. ${window.endDate}:`);
  const body = JSON.stringify({ ...window, dimensions: ["page"], rowLimit: 25000 });
  for (const s of sites) {
    try {
      const r = JSON.parse(httpCurl([
        "-4", "-sS", "--max-time", "90", "-X", "POST",
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Content-Type: application/json",
        "-d", body,
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encode(s.siteUrl)}/searchAnalytics/query`,
      ]));
      if (r.error) {
        log(`    ${"error".padEnd(16)} ${s.siteUrl}   ${r.error.message}`);
        continue;
      }
      const rows = r.rows ?? [];
      const impressions = rows.reduce((n, x) => n + (x.impressions ?? 0), 0);
      const clicks = rows.reduce((n, x) => n + (x.clicks ?? 0), 0);
      log(`    ${`${rows.length} rows`.padEnd(16)} ${s.siteUrl}   ${impressions} impressions, ${clicks} clicks`);
    } catch (e) {
      log(`    ${"failed".padEnd(16)} ${s.siteUrl}   ${e.message}`);
    }
  }
  log("");
  log("  nothing written — this mode only reads");
  process.exit(0);
}

function fetchBy(dimension) {
  try {
    const r = gscSearchAnalytics(env, {
      ...window,
      dimensions: [dimension],
      rowLimit: 25000,
    }, stats);
    return r?.rows ?? [];
  } catch (e) {
    bail(`GSC query by ${dimension} failed: ${e.message}`);
  }
}

const pageRows = fetchBy("page");
const queryRows = args.json ? [] : fetchBy("query");

if (args.json) {
  const rows = pageRows.map((r) => ({
    page: r.keys?.[0] ?? "",
    impressions: Math.round(r.impressions ?? 0),
    clicks: Math.round(r.clicks ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: Math.round((r.position ?? 0) * 10) / 10,
  }));
  console.log(JSON.stringify({ days: args.days, site: env.GSC_SITE_URL, pages: rows }, null, 2));
  process.exit(0);
}
log(`  ${pageRows.length} pages, ${queryRows.length} queries with impressions`);

if (pageRows.length === 0) {
  log("");
  log("  GSC returned no rows for this window.");
  log("  On a site younger than a few months this is the expected state, not a");
  log("  fault: nothing is indexed deeply enough to report yet. The report is");
  log("  written anyway so the absence is on the record with a date.");
}

// ---------------------------------------------------------------- classify

const CTR_FLOOR = 0.01; // 1% — below this, the title is not earning the click

const byPath = new Map();
for (const row of pageRows) {
  const url = row.keys[0];
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    continue;
  }
  byPath.set(path.replace(/\/$/, ""), row);
}

function classify(article) {
  const row = byPath.get(article.path.replace(/\/$/, ""));
  if (!row || row.impressions === 0) {
    return {
      action: "重跑闸门",
      detail: `${args.days} 天零曝光。先重跑 pnpm qa 与 qa:serp：仍通过则选题有问题，退回选题池；不通过则闸门漏检，改规则。`,
      impressions: 0, clicks: 0, ctr: 0, position: 0,
    };
  }
  const ctr = row.ctr ?? (row.impressions ? row.clicks / row.impressions : 0);
  const pos = row.position ?? 0;

  if (row.clicks === 0) {
    return {
      action: "改标题+描述",
      detail: `${row.impressions} 次曝光、0 点击，平均排名 ${pos.toFixed(1)}。有曝光无点击 = 承诺没打中，先改 title 和 description。`,
      impressions: row.impressions, clicks: row.clicks, ctr, position: pos,
    };
  }
  if (ctr < CTR_FLOOR && row.impressions >= 50) {
    return {
      action: "改标题",
      detail: `CTR ${(ctr * 100).toFixed(2)}% 低于 1% 门槛（${row.impressions} 曝光）。排名可接受但抓不住点击，改标题。`,
      impressions: row.impressions, clicks: row.clicks, ctr, position: pos,
    };
  }
  if (pos > 10 && pos <= 20) {
    return {
      action: "优化进首页",
      detail: `平均排名 ${pos.toFixed(1)}，在第 2 页。补内链、补数据、更新日期，进前 10 有机会。`,
      impressions: row.impressions, clicks: row.clicks, ctr, position: pos,
    };
  }
  if (pos <= 10) {
    return {
      action: "保持并加倍",
      detail: `平均排名 ${pos.toFixed(1)}，CTR ${(ctr * 100).toFixed(2)}%。方向有效，同类选题加倍。`,
      impressions: row.impressions, clicks: row.clicks, ctr, position: pos,
    };
  }
  return {
    action: "观察",
    detail: `平均排名 ${pos.toFixed(1)}，曝光 ${row.impressions}。排名太浅，先等。`,
    impressions: row.impressions, clicks: row.clicks, ctr, position: pos,
  };
}

const classified = articles
  .map((a) => ({ ...a, ...classify(a) }))
  .sort((a, b) => b.impressions - a.impressions);

// Queries the site is not targeting: the topic pool, and the only keyword data
// that reflects what people actually type.
const targeted = new Set(articles.map((a) => a.keyword.toLowerCase()).filter(Boolean));
const untargeted = queryRows
  .map((r) => ({ query: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: r.position }))
  .filter((q) => q.impressions >= 3 && !targeted.has(q.query.toLowerCase()))
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, 50);

// ------------------------------------------------------------------ output

const byAction = {};
for (const c of classified) byAction[c.action] = (byAction[c.action] ?? 0) + 1;

log("");
log("  action distribution:");
for (const [k, v] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
  log(`    ${k.padEnd(12)} ${v}`);
}
log(`  untargeted queries with >=3 impressions: ${untargeted.length}`);

if (args.dryRun) {
  log("dry run — nothing written");
  console.log("\nTop rows:");
  for (const c of classified.slice(0, 8)) {
    console.log(`  ${String(c.impressions).padStart(5)} imp  ${c.action.padEnd(12)} ${c.slug}`);
  }
  process.exit(0);
}

// Markdown report — what gets read on Monday.
const md = [
  `# GSC 数据回流报告 · ${ISO}`,
  "",
  `**窗口**：${window.startDate} → ${window.endDate}（${args.days} 天）`,
  `**已发布文章**：${articles.length} 篇`,
  `**GSC 有曝光的页面**：${pageRows.length} 个`,
  `**未瞄准的真实查询（≥3 次曝光）**：${untargeted.length} 个`,
  "",
  "> 这份报告的用途只有一个：**决定下周改什么、写什么、停什么。**",
  "",
  "## 一、动作清单",
  "",
  "| 文章 | 曝光 | 点击 | CTR | 平均排名 | 动作 |",
  "| --- | --- | --- | --- | --- | --- |",
];
for (const c of classified) {
  md.push(
    `| [${c.title}](${c.url}) | ${c.impressions} | ${c.clicks} | ` +
    `${(c.ctr * 100).toFixed(2)}% | ${c.position ? c.position.toFixed(1) : "-"} | **${c.action}** |`,
  );
}

md.push("", "## 二、逐条理由", "");
for (const c of classified) {
  md.push(`### ${c.title}`, "", `- 动作：**${c.action}**`, `- ${c.detail}`, "");
}

md.push(
  "## 三、未瞄准的真实查询（下周选题池）",
  "",
  untargeted.length
    ? "| 查询 | 曝光 | 点击 | 平均排名 |"
    : "_窗口内没有出现未瞄准的查询。新站前期属正常。_",
);
if (untargeted.length) {
  md.push("| --- | --- | --- | --- |");
  for (const q of untargeted) {
    md.push(`| ${q.query} | ${q.impressions} | ${q.clicks} | ${q.position.toFixed(1)} |`);
  }
}

md.push(
  "",
  "## 四、窗口内无曝光的文章",
  "",
  classified.filter((c) => c.impressions === 0).length
    ? classified.filter((c) => c.impressions === 0).map((c) => `- [${c.title}](${c.url})`).join("\n")
    : "_无_",
  "",
  "---",
  "",
  `_生成于 ${ISO} · 窗口 ${args.days} 天 · 报告只读，不回写任何站点文件_`,
  "",
);

const mdPath = join(OUT_DIR, `report_${DATE}.md`);
writeFileSync(mdPath, md.join("\n"), "utf8");

const csvCell = (v) => {
  const s = v === null || v === undefined ? "-" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const artPath = join(OUT_DIR, `articles_${DATE}.csv`);
writeFileSync(
  artPath,
  "\uFEFF" + [
    "slug,title,category,target_keyword,impressions,clicks,ctr,avg_position,action,publish_date",
    ...classified.map((c) => [
      c.slug, c.title, c.category, c.keyword || "-",
      c.impressions, c.clicks, c.ctr.toFixed(4),
      c.position ? c.position.toFixed(2) : "-", c.action, c.publishDate,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n",
  "utf8",
);

const qPath = join(OUT_DIR, `queries_${DATE}.csv`);
writeFileSync(
  qPath,
  "\uFEFF" + [
    "query,impressions,clicks,avg_position,targeted",
    ...queryRows.map((r) => [
      r.keys[0], r.impressions, r.clicks, r.position.toFixed(2),
      targeted.has(r.keys[0].toLowerCase()) ? "true" : "false",
    ].map(csvCell).join(",")),
  ].join("\n") + "\n",
  "utf8",
);

log("");
log(`done in ${((Date.now() - stats.started) / 1000).toFixed(1)}s`);
log(`  report : ${mdPath}`);
log(`  articles: ${artPath}  (${classified.length} rows)`);
log(`  queries : ${qPath}  (${queryRows.length} rows)`);
log(`  gsc calls: ${stats.gscCalls}   retries: ${stats.retries}`);
if (pageRows.length === 0) {
  log("  NOTE: zero rows. Expected on a young site; the report records the");
  log("  absence with a date rather than failing.");
}
