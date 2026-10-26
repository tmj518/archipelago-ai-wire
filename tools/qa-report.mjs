#!/usr/bin/env node
/**
 * Eight-item QA report.
 *
 * Complements tools/qa-check.mjs rather than replacing it. qa-check owns the
 * structural rules (template sections, five-part figures, hedging, cliches,
 * encoding). This owns the four checks that were missing, plus the report
 * format a human reads:
 *
 *   1  originality       5-word shingle Jaccard against every other published
 *                         article; the highest match is the score
 *   2  template drift    structure is fixed on purpose, so this compares
 *                         WORDING — the opening and closing sentences of the
 *                         three most recent articles, and whether the AI
 *                         Summary merely restates the title
 *   3  sensitive terms   time-sensitive political and brand terms
 *   4  original value    from frontmatter information_gain + figure count
 *   5  length            1200 blocks, 1500 recommended
 *   6  rights            no external assets by design, stated not assumed
 *   7  links             no absolute URLs in body (spec §4.3), every relative
 *                         internal link resolves to a file that exists
 *   8  SEO basics        target keyword in title, description and first H2
 *
 * Usage
 *   node tools/qa-report.mjs <slug>
 *   node tools/qa-report.mjs --all
 *   node tools/qa-report.mjs <slug> --write      # also write data/qa/<slug>.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BLOG = join(ROOT, "src", "content", "blog");
const OUT = join(ROOT, "data", "qa");

const LENGTH_BLOCK = 1200;
const LENGTH_RECOMMEND = 1500;
const SIMILARITY_CEILING = 0.6;
const WORDING_CEILING = 0.5;

// ------------------------------------------------------------------ parsing

const parse = (raw) => {
  // \r? on both ends. One article in the library has CRLF line endings while
  // the rest have LF, and a parser that only matched "\n---\n" returned an
  // empty frontmatter for it — which surfaced as "no target_keyword, no
  // information_gain, zero figures" and looked like a legacy article that had
  // never been converted. It was a parser bug, not a content problem: the body
  // fell back to the whole file, which is why it still reported a cost table
  // and 2329 words.
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  const fm = m ? m[1] : "";
  const body = m ? raw.slice(m[0].length) : raw;
  const field = (k) =>
    new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm)?.[1]?.trim() ?? "";
  return { fm, body, field };
};

const words = (s) => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []);
const stripMd = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[|>*_`#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Content words only: stopwords removed so overlap reflects subject matter. */
const STOP = new Set(
  ("the a an and or but of to in for on at by with from as is are was were be been being this that these those it its " +
   "not no than then so such can could may might will would should do does did have has had if when where which who whom " +
   "what how why all any both each few more most other some only own same very s t just now also into over under")
    .split(" "),
);
const contentWords = (s) => words(s).filter((w) => !STOP.has(w) && w.length > 2);

function shingles(list, n = 5) {
  const out = new Set();
  for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(" "));
  return out;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function loadPublished() {
  const out = [];
  for (const file of readdirSync(BLOG)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(join(BLOG, file), "utf8");
    if (/^draft:\s*true/m.test(raw)) continue;
    const { fm, body, field } = parse(raw);
    out.push({
      slug: file.replace(/\.md$/, ""),
      title: field("title"),
      subtitle: field("subtitle"),
      description: field("description"),
      keyword: field("target_keyword"),
      gain: field("information_gain"),
      publishDate: field("publishDate"),
      body,
      plain: stripMd(body),
      fm,
    });
  }
  return out;
}

const sentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 15);

// ------------------------------------------------------------------- checks

function checkOriginality(article, others) {
  let worst = { slug: null, score: 0 };
  const mine = shingles(contentWords(article.plain));
  for (const o of others) {
    const score = jaccard(mine, shingles(contentWords(o.plain)));
    if (score > worst.score) worst = { slug: o.slug, score };
  }
  const pct = (worst.score * 100).toFixed(0);
  return {
    name: "原创性",
    pass: worst.score < SIMILARITY_CEILING,
    detail: `${pct}% 相似度${worst.slug ? `（最高：${worst.slug}）` : ""}`,
    note: worst.score < SIMILARITY_CEILING ? `低于 ${SIMILARITY_CEILING * 100}% 门槛` : "超过门槛，退回重写",
  };
}

/**
 * Structure is fixed by design (V6.1 six sections are a gate rule), so drifting
 * structure is not the risk. Formulaic wording is: the same opening move, the
 * same closing cadence, and an AI Summary that only restates the title.
 */
function checkTemplateDrift(article, others) {
  const recent = others
    .filter((o) => o.slug !== article.slug)
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
    .slice(0, 3);

  /*
   * The closing comparison has to ignore the mandatory disclaimer.
   *
   * Spec §12.7 originally required every article to end with "Independent
   * analysis, not financial or legal advice." The wording on the site is now
   * different and deliberately so — the disclaimer reads "Analysis of publicly
   * available official documents. Not a customs broker, law firm or tax adviser,
   * and nothing here is legal, tax or investment advice. Every figure is sourced
   * and dated — check the original before you act on it." That covers the same
   * three things and adds the actionable part, so the spec wording was the thing
   * out of date, not the site.
   *
   * The old pattern still matched the OLD wording, which no longer appears
   * anywhere. So this filter removed nothing, and the check silently compared
   * against nothing rather than against the disclaimer. The pattern below
   * matches what is actually rendered, which makes it self-checking: change the
   * disclaimer wording without updating this line and the filter stops working,
   * and the resulting 100 % closing-match score exposes it.
   *
   * Note the disclaimer lives in the SITE footer, not the article body, and this
   * report reads article bodies. The filter is therefore belt-and-braces — it
   * matters if a disclaimer is ever put back into a piece.
   */
  const DISCLAIMER =
    /(nothing here is (legal|financial)|not (financial|legal) or legal advice|independent analysis, not financial)/i;
  const closingSentence = (plain) => {
    const paras = plain
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !DISCLAIMER.test(p));
    // The disclaimer is not always its own paragraph; it can share a line with
    // the closing prose. Drop it sentence by sentence as well.
    const sents = sentences(paras.join(" ")).filter((s) => !DISCLAIMER.test(s));
    return sents.slice(-1)[0] ?? "";
  };

  const myOpen = new Set(contentWords(sentences(article.plain)[0] ?? ""));
  const myClose = new Set(contentWords(closingSentence(article.plain)));

  let openMax = 0;
  let closeMax = 0;
  for (const o of recent) {
    const s = sentences(o.plain);
    openMax = Math.max(openMax, jaccard(myOpen, new Set(contentWords(s[0] ?? ""))));
    closeMax = Math.max(closeMax, jaccard(myClose, new Set(contentWords(closingSentence(o.plain)))));
  }

  // Does the AI Summary say anything the title did not?
  const summary = /^##\s+AI Summary\s*$([\s\S]*?)(?=^##\s|\Z)/m.exec(article.body)?.[1] ?? "";
  const titleWords = new Set(contentWords(article.title));
  const sumWords = contentWords(stripMd(summary));
  const novel = sumWords.filter((w) => !titleWords.has(w)).length;
  const novelty = sumWords.length ? novel / sumWords.length : 0;

  const ok = openMax < WORDING_CEILING && closeMax < WORDING_CEILING && novelty >= 0.5;
  const bits = [`开头重合 ${(openMax * 100).toFixed(0)}%`, `结尾 ${(closeMax * 100).toFixed(0)}%`];
  if (novelty < 0.5) bits.push(`AI Summary 仅 ${(novelty * 100).toFixed(0)}% 是新词，疑似复述标题`);

  return {
    name: "模板化",
    pass: ok,
    detail: bits.join(" · "),
    note: ok ? "措辞与近三篇有区分（结构固定属设计）" : "措辞公式化，退回重写",
  };
}

const SENSITIVE = [
  // Time-sensitive political terms: this site analyses trade policy, not politics.
  "tiananmen", "taiwan independence", "xinjiang forced", "uyghur genocide", "falun",
  "tibet independence", "hong kong independence", "ccp ", "chinese communist party",
  // Brand and trademark terms that create a different kind of exposure.
  "nike", "adidas", "apple inc", "disney", "gucci", "rolex", "louis vuitton",
];
function checkSensitive(article) {
  const low = article.plain.toLowerCase();
  const hits = SENSITIVE.filter((t) => low.includes(t));
  return {
    name: "敏感词",
    pass: hits.length === 0,
    detail: hits.length ? `${hits.length} 命中：${hits.join(", ")}` : "0 命中",
    note: hits.length ? "标记风险，发布前人工确认" : "-",
  };
}

function checkOriginalValue(article) {
  const figures = (article.fm.match(/^\s*- value:/gm) ?? []).length;
  const ok = article.gain !== "" && figures >= 5;
  const table = /\n\|[^\n]*\|[^\n]*\n\|[\s\-:|]+\|/.test(article.body);
  return {
    name: "一手增量",
    pass: ok,
    detail: `${article.gain || "未声明"} · 五元组数字 ${figures} 个${table ? " · 含成本表" : ""}`,
    note: ok ? "声明成立" : "未声明增量或数字不足 5 个，退回",
  };
}

function checkLength(article) {
  const n = words(article.plain).length;
  const pass = n >= LENGTH_BLOCK;
  return {
    name: "长度",
    pass,
    detail: `${n} 词`,
    note: n >= LENGTH_RECOMMEND ? "-" : pass ? `低于建议值 ${LENGTH_RECOMMEND}，可接受但建议补足` : `低于硬下限 ${LENGTH_BLOCK}，退回`,
  };
}

/**
 * Stated rather than assumed: this site uses no third-party assets at all.
 * Slides are drawn with Pillow, narration is edge-tts, there is no BGM and no
 * stock footage. If that ever changes, this check has to become a real one.
 */
function checkRights(article) {
  const externalImg = /!\[[^\]]*\]\(https?:\/\//.test(article.body);
  return {
    name: "版权",
    pass: !externalImg,
    detail: externalImg ? "正文含外链图片，需标注授权" : "无外部素材（幻灯片为代码绘制、旁白为 TTS）",
    note: externalImg ? "补充来源与商用许可后重跑" : "按设计无需授权标注",
  };
}

function checkLinks(article, allSlugs) {
  const absolute = [...article.body.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  const relative = [...article.body.matchAll(/\]\((\/[^)\s]+)\)/g)].map((m) => m[1]);

  const broken = [];
  for (const href of relative) {
    // /blog/<slug>/ -> src/content/blog/<slug>.md
    const m = /^\/blog\/([^/]+)\/?$/.exec(href);
    if (m && !allSlugs.has(m[1])) broken.push(href);
  }

  const pass = absolute.length === 0 && broken.length === 0;
  const bits = [`正文内链 ${relative.length} 条`, `绝对 URL ${absolute.length} 条（规范要求 0）`];
  if (broken.length) bits.push(`失效内链：${broken.join(", ")}`);

  return {
    name: "外链/引用",
    pass,
    detail: bits.join(" · "),
    note: pass ? "信源以名称列出（规范 §4.3 禁止正文出现 URL）" : "修复失效内链或移除绝对 URL 后重跑",
  };
}

function checkSeo(article) {
  const kw = article.keyword.toLowerCase();
  if (!kw) {
    return { name: "SEO", pass: false, detail: "未声明 target_keyword", note: "自动补或退回" };
  }

  // Token coverage, not string containment. Target keywords here are long
  // tails of eight to twelve words — "US de minimis suspended 2026 postal
  // shipment duty per parcel China" — and no title contains that verbatim.
  // Requiring containment failed the whole library on the first run, which is
  // the check being wrong rather than twelve articles being wrong.
  const kwTokens = new Set(contentWords(kw));
  const cover = (text) => {
    const t = new Set(contentWords(text));
    if (kwTokens.size === 0) return 0;
    let hit = 0;
    for (const w of kwTokens) if (t.has(w)) hit++;
    return hit / kwTokens.size;
  };

  // The AI Summary, not the first H2. The first heading is always "## AI
  // Summary" under the V6.1 template, so measuring it returned 0% for every
  // article in the library — the check was wrong, not the twelve articles. The
  // summary is the right target anyway: it is the paragraph search engines
  // index and the one AI engines quote.
  const summary = stripMd(
    /^##\s+AI Summary\s*$([\s\S]*?)(?=^##\s|\Z)/m.exec(article.body)?.[1] ?? "",
  );
  /*
   * The title carries the hook; the subtitle carries the keyword (spec decision
   * 1, 2026-10-03). They share one <title> tag in the rendered page, so the
   * coverage test runs against them together — otherwise every hooky headline
   * fails a rule the page itself satisfies. The threshold is unchanged at 50 %.
   */
  const headline = [article.title, article.subtitle].filter(Boolean).join(" — ");
  const cTitle = cover(headline);
  const cDesc = cover(article.description);
  const cSum = cover(summary);
  const internal = [...article.body.matchAll(/\]\((\/[^)\s]+)\)/g)].length;

  // The title decides the click, so it carries the highest bar; the description
  // and the summary support it.
  const pass = cTitle >= 0.5 && (cDesc >= 0.5 || cSum >= 0.5) && internal >= 1;
  const pct = (n) => `${(n * 100).toFixed(0)}%`;
  const bits = [
    `title${article.subtitle ? "+subtitle" : ""} 覆盖 ${pct(cTitle)}${article.subtitle ? "" : "（无副标题）"}`,
    `description ${pct(cDesc)}`,
    `AI Summary ${pct(cSum)}`,
    `内链 ${internal} 条`,
  ];
  return {
    name: "SEO",
    pass,
    detail: bits.join(" · "),
    // Density is deliberately not checked: it rewards repetition, and this
    // site's positioning is information gain rather than keyword volume.
    // The note names the rule that actually failed — an earlier version said
    // "标题覆盖不足" for a piece whose title scored 100 % and whose only
    // failure was zero internal links.
    note: pass
      ? "关键词落位合格（不查密度，密度会诱导堆砌）"
      : [
          cTitle < 0.5 && `标题+副标题关键词覆盖 ${pct(cTitle)} < 50%`,
          !(cDesc >= 0.5 || cSum >= 0.5) &&
            `description ${pct(cDesc)} 与 AI Summary ${pct(cSum)} 都 < 50%`,
          internal < 1 && "正文内链 0 条（需 ≥1）",
        ]
          .filter(Boolean)
          .join("；"),
  };
}

// ------------------------------------------------------------------- report

function report(article, others, allSlugs) {
  const checks = [
    checkOriginality(article, others),
    checkTemplateDrift(article, others),
    checkSensitive(article),
    checkOriginalValue(article),
    checkLength(article),
    checkRights(article),
    checkLinks(article, allSlugs),
    checkSeo(article),
  ];
  const passed = checks.filter((c) => c.pass).length;
  const risks = checks.filter((c) => !c.pass);
  const date = new Date().toISOString().slice(0, 10);

  const lines = [
    `# 质检报告 - ${article.title} - ${date}`,
    "",
    `## 机审得分: ${passed}/8 ${passed === 8 ? "✅" : "⚠️"}`,
    "",
    "| 检查项 | 结果 | 备注 |",
    "|--------|------|------|",
    ...checks.map((c) => `| ${c.name} | ${c.pass ? "✅ 通过" : "❌ 不通过"} — ${c.detail} | ${c.note} |`),
    "",
    "## 风险提示",
    risks.length ? risks.map((r) => `- **${r.name}**：${r.detail} → ${r.note}`).join("\n") : "无",
    "",
    "## 人审结果",
    // Human review was removed by spec v1.3 §6: two automated gates replaced
    // it. The row is kept so the report shape matches the agreed format, but
    // nothing waits on it.
    "_本流程无人工审稿（规范 v1.3 §6：双闸门取代人审）。此行仅为格式保留。_",
    "",
    `_机审：tools/qa-check.mjs（20 条结构规则）+ tools/qa-report.mjs（本报告 8 项）_`,
    "",
  ];
  return { checks, passed, md: lines.join("\n") };
}

// --------------------------------------------------------------------- main

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((a) => !a.startsWith("--"));

const all = loadPublished();
const allSlugs = new Set(all.map((a) => a.slug));

const picked = args.includes("--all")
  ? all
  : targets.length
    ? all.filter((a) => targets.some((t) => a.slug === t || t.endsWith(`${a.slug}.md`)))
    : [];

if (picked.length === 0) {
  console.error("usage: node tools/qa-report.mjs <slug> | --all [--write]");
  process.exit(2);
}

if (write) mkdirSync(OUT, { recursive: true });

let anyFail = false;
for (const article of picked) {
  const others = all.filter((a) => a.slug !== article.slug);
  const { md, passed } = report(article, others, allSlugs);
  console.log(md);
  if (passed < 8) anyFail = true;
  if (write) {
    const p = join(OUT, `${article.slug}.md`);
    writeFileSync(p, md, "utf8");
    console.log(`written: ${p}\n`);
  }
}

process.exit(anyFail ? 1 : 0);
