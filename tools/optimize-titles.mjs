/*
 * Which pages does Google already rank, and which of them nobody clicks.
 *
 * Search Console on 2026-10-20, three months: clicks 7, impressions 718, CTR 1%, average position 6.3.
 * Rerun on 2026-10-21 over the same ninety days: 819 impressions, 7 clicks, 78 pages with rows.
 * Position 6.3 with a 1% click rate is not a content problem - Google already thinks those pages are relevant,
 * and position six is normally clicked four to eight times per hundred impressions. One per hundred means the
 * title and description are not earning the click, which is the cheapest work on the site: no research, no
 * writing, no tokens.
 *
 * WITHOUT --rewrite IT ONLY READS. Nothing is written, nothing published, nothing committed. With --rewrite it
 * changes the title line and nothing else: it backs the file up, runs qa-check, and restores the backup if the
 * gate fails. The body of an article is never touched, and a title nobody has read yet is not a title.
 *
 *   node tools/optimize-titles.mjs                       # shortlist, no model, no writes
 *   node tools/optimize-titles.mjs --min-imp=20 --max-pos=8 --max-ctr=0.01
 *   node tools/optimize-titles.mjs --from=out/gsc-90.json   # use a saved payload, no credential needed
 *   node tools/optimize-titles.mjs --rewrite             # propose, then apply the best one, behind qa-check
 */
import { execSync, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { ask as askModel } from "./lib-llm.mjs";
import { loadEnv } from "./lib/gsc.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? Number(hit.slice(n.length + 3)) : d;
};
const MIN_IMP = arg("min-imp", 50);
const MAX_POS = arg("max-pos", 10);
const MAX_CTR = arg("max-ctr", 0.02);
const ALL = argv.includes("--all");
/*
 * Ninety days, not the default twenty-eight.
 *
 * The first run of this audit asked Search Console for a month and got nothing back, because the site's 718
 * impressions are spread over three months and almost none of them fall in the last four weeks. A window narrower
 * than the traffic is a filter that reports "no work to do" while the work sits there.
 */
const DAYS = arg("days", 90);

/* Whether this run may change a file. Read here, above the banner, so the banner cannot lie about it. */
const WILL_WRITE = argv.includes("--rewrite") || argv.some((a) => a.startsWith("--apply="));

console.log("");
console.log(`TITLE OPTIMISER  -  ${WILL_WRITE ? "writes the title line, behind qa-check" : "read only, nothing is written"}`);
console.log("=".repeat(94));
console.log(`  filter : ${DAYS}d   impressions > ${MIN_IMP}   position < ${MAX_POS}   ctr < ${(MAX_CTR * 100).toFixed(1)}%`);
console.log("");

/*
 * Where the numbers come from.
 *
 * Normally the sibling script, because it owns the JWT signing and the retries. But the
 * credential lives in a repository secret, so the only machine that can ask Google is a
 * runner - and the rewrite prompt is the part worth iterating on, which needs the real
 * rows on a workstation. --from closes that loop: save the payload once where the
 * credential is, then re-run the rewriter against it as often as the prompt needs.
 */
const FROM = ((argv.find((a) => a.startsWith("--from=")) ?? "").slice("--from=".length) || "").trim();

let payload;
try {
  if (FROM) {
    payload = JSON.parse(readFileSync(FROM, "utf8"));
  } else {
    const out = execSync(`${process.execPath} tools/gsc-report.mjs --json --days=${DAYS}`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const a = out.indexOf("{");
    const b = out.lastIndexOf("}");
    if (a < 0 || b < 0) throw new Error("gsc-report printed no JSON object");
    payload = JSON.parse(out.slice(a, b + 1));
  }
} catch (e) {
  const detail = String(e.stdout ?? "") + String(e.stderr ?? e.message ?? "");
  console.log("  could not read Search Console:");
  console.log("  " + detail.trim().split("\n").slice(-4).join("\n  ").slice(0, 600));
  console.log("");
  console.log("  Nothing was changed. This script only reads.");
  process.exit(1);
}

const pages = Array.isArray(payload?.pages) ? payload.pages : [];
console.log(`  window : ${payload?.days ?? "?"} day(s)     site : ${payload?.site ?? "?"}     pages : ${pages.length}`);
console.log("");
if (!pages.length) {
  console.log("  No page rows for this window. On a site this young that is the expected state, not a fault.");
  process.exit(0);
}

const dir = join(ROOT, "src", "content", "blog");
const fmOf = (file) => {
  try {
    const text = readFileSync(file, "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    const pick = (k) => (new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm) ?? [])[1] ?? "";
    return { title: pick("title"), description: pick("description") };
  } catch {
    return null;
  }
};
const slugOf = (u) => (/\/blog\/([^/?#]+)/.exec(String(u ?? "")) ?? [])[1] ?? "";

const rows = pages
  .map((r) => ({
    page: String(r.page ?? ""),
    slug: slugOf(r.page),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  }))
  .filter((r) => r.page);

const short = (ALL
  ? rows
  : rows.filter((r) => r.impressions > MIN_IMP && r.position < MAX_POS && r.ctr < MAX_CTR)
).sort((x, y) => y.impressions - x.impressions);

console.log(`  shortlist : ${short.length} page(s)`);
console.log("");
if (!short.length) {
  console.log("  Nothing qualifies. Either the pages earn their clicks, or the floor is too high");
  console.log("  for a site this young - try --min-imp=20.");
  process.exit(0);
}

const shown = short.map((r) => {
  const p = existsSync(join(dir, `${r.slug}.md`)) ? fmOf(join(dir, `${r.slug}.md`)) : null;
  return { ...r, title: p?.title || "(no local file for this slug)" };
});
const w = Math.min(62, Math.max(20, ...shown.map((r) => r.title.length)));
const head = "  " + "imp".padStart(6) + "  " + "clk".padStart(4) + "  " + "ctr".padStart(6) + "  " + "pos".padStart(5) + "  " + "title".padEnd(w);
console.log(head);
console.log("  " + "-".repeat(head.length - 2));
for (const r of shown) {
  console.log(
    "  " + String(r.impressions).padStart(6) + "  " + String(r.clicks).padStart(4) + "  " +
    `${(r.ctr * 100).toFixed(1)}%`.padStart(6) + "  " + r.position.toFixed(1).padStart(5) + "  " +
    r.title.slice(0, w).padEnd(w),
  );
}
console.log("");
console.log("  What to do with this list, in order:");
console.log("    1. read the top description the way a stranger would, in a search result");
console.log("    2. rewrite the title to promise a consequence, not to name a subject");
console.log("    3. keep it under 60 characters - fitTitle() drops the qualifier rather than truncating");
console.log("");

/* ------------------------------------------------------------------ the rewriter */

/*
 * Four schools, one chosen per page.
 *
 * The point of naming the schools is that "make it better" produces the same title
 * every time. A constraint produces a choice, and the choice is the thing a reader
 * responds to: money, a deadline, a broken assumption, or a comparison.
 */
const STYLES = {
  "算账流": "明确告诉读者兜里的钱涨了还是跌了，把后果写成金额或百分比",
  "生死线流": "强调时间紧迫感和违规后果，写清哪一天、什么代价",
  "反差揭秘流": "打破读者现有认知，制造信息差：他们以为 A，其实是 B",
  "对比流": "把两个市场、两套政策、两个时点放在一起，让差异自己说话",
};

const MAX_TITLE = 60;
/*
 * --apply=<file> writes titles a human has already read, and does not ask the model again.
 *
 * --rewrite re-generates the proposal at temperature 0.6, which is right for exploring and wrong for
 * applying: the operator approves four specific strings, and a second sampling can return four different
 * ones. Writing those would mean shipping titles nobody reviewed, under an approval given for other words.
 *
 * The file is a flat JSON object, slug -> title. Everything downstream is unchanged: the 60-character
 * check, the .bak backup, qa-check, and the rollback.
 */
const APPLY = ((argv.find((a) => a.startsWith("--apply=")) ?? "").slice("--apply=".length) || "").trim();
const REWRITE = WILL_WRITE;
const approved = (() => {
  if (!APPLY) return null;
  if (!existsSync(APPLY)) {
    console.log(`  --apply file does not exist: ${APPLY}`);
    process.exit(1);
  }
  const map = JSON.parse(readFileSync(APPLY, "utf8"));
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    console.log(`  --apply file must be a JSON object of slug -> title: ${APPLY}`);
    process.exit(1);
  }
  return map;
})();
const MODEL = ((argv.find((a) => a.startsWith("--model=")) ?? "").slice("--model=".length) || process.env.TITLE_MODEL || "").trim();

/* The .env is the local mirror of the workflow's secrets; lib-llm reads process.env. */
const localEnv = loadEnv(join(ROOT, ".env"));
for (const [k, v] of Object.entries(localEnv)) if (!process.env[k]) process.env[k] = v;

/** The article body, without frontmatter, capped so a long piece cannot crowd the prompt. */
function bodyOf(file) {
  const text = readFileSync(file, "utf8");
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0] ?? "";
  return text.slice(fm.length).replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
}

/** The first JSON object in a reply, or null. The model is asked for JSON and may fence it. */
function pickJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const c of [fenced, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    if (!c) continue;
    try {
      const o = JSON.parse(c);
      if (o && typeof o === "object") return o;
    } catch { /* next shape */ }
  }
  return null;
}

const SYSTEM = [
  "你是顶级 B2B 标题专家，严格遵守 Google 官方 SEO 指南：",
  "- 标题不超过 60 个字符（含空格）；超过就是硬失败。",
  "- 保留核心搜索词，读者在搜索结果里必须一眼看出这篇讲什么。",
  "- 不标题党，不承诺正文给不了的东西，不用全大写，不用感叹号。",
  "- 面向中国的进出口商、外贸业务员、合规负责人，写英语。",
].join("\n");

function prompt(row, article) {
  return [
    `现有标题：${article.title}`,
    `现有描述：${article.description || "(无)"}`,
    "",
    "这个页面在 Google 已经有曝光但几乎没人点：",
    `曝光 ${row.impressions} 次，点击 ${row.clicks} 次，CTR ${(row.ctr * 100).toFixed(1)}%，平均排名 ${row.position.toFixed(1)}。`,
    "排名说明 Google 认为内容相关。没人点，说明标题的承诺没打中。",
    "",
    "四大流派：",
    ...Object.entries(STYLES).map(([k, v]) => `${k}：${v}`),
    "",
    "请从这四派中选择**最适合这一篇**的一派，在该派内生成 3 个候选标题，逐个自评打分（1-10，",
    "评分标准：与正文一致、承诺了后果、在 60 字符内、包含核心词），返回得分最高的那个。",
    "",
    "正文节选：",
    bodyOf(article.file),
    "",
    "只输出 JSON，不要解释，不要代码块以外的文字：",
    '{"style":"四派之一的名称","why":"一句话说明为什么选这一派",' +
      '"candidates":[{"title":"...","score":9,"note":"承诺了什么后果"},' +
      '{"title":"...","score":8,"note":"..."},{"title":"...","score":7,"note":"..."}],' +
      '"best":"得分最高的那个标题，必须与 candidates 里的某一个完全一致"}',
  ].join("\n");
}

async function propose(row, article) {
  const ask = async (extra) => {
    const r = await askModel({
      role: "writer",
      ...(MODEL ? { model: MODEL } : {}),
      system: SYSTEM,
      temperature: 0.6,
      maxTokens: 1200,
      messages: [{ role: "user", content: prompt(row, article) + (extra ? `\n\n${extra}` : "") }],
    });
    if (!r.ok) throw new Error(r.error ?? "the model returned nothing");
    const json = pickJson(r.text ?? "");
    if (!json) throw new Error(`no JSON in the reply: ${String(r.text ?? "").slice(0, 200)}`);
    return json;
  };

  let json = await ask("");
  let best = String(json.best ?? "").trim();

  /* Over the limit is a hard failure, not a warning: it is the one rule Google states. */
  if (best.length > MAX_TITLE) {
    json = await ask(
      `上一个答案里 "${best}" 有 ${best.length} 个字符，超过 60 的硬上限。` +
        "请整组重写：三个候选都必须不超过 60 字符，仍然保留核心词和后果承诺。",
    );
    best = String(json.best ?? "").trim();
  }
  return { json, best };
}

const DIRT = "out";
function qaCheck(file) {
  /* A file descriptor, not a pipe: the same bytes inside the sandbox and out of it. */
  mkdirSync(join(ROOT, DIRT), { recursive: true });
  const tmp = join(ROOT, DIRT, `.qa-${process.pid}-${Date.now()}.txt`);
  const fd = openSync(tmp, "w");
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "qa-check.mjs"), file], { stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const out = existsSync(tmp) ? readFileSync(tmp, "utf8") : "";
  rmSync(tmp, { force: true });
  const m = /(\d+) pass · (\d+) warn · (\d+) BLOCK/.exec(out);
  return { ok: r.status === 0, summary: m ? `${m[1]} pass / ${m[3]} block` : `qa-check exit ${r.status}`, out };
}

console.log("=".repeat(94));
console.log(`  rewriter : ${REWRITE ? "WRITES the markdown" : "proposes only - nothing is written"}${MODEL ? `   model ${MODEL}` : ""}`);
console.log("=".repeat(94));

/* ------------------------------------------------------------------ backtest */

/*
 * Every title change is recorded before it happens, with the numbers that justified it.
 *
 * Without this line the only evidence that a rewrite worked is a feeling, because Search Console
 * keeps no history of a title - it reports the page's position today, not what it was when the
 * promise on the page was a different sentence. data/backtest.jsonl is that history: a baseline at
 * the moment of the change, and a measurement whenever someone asks again.
 *
 * Append-only JSON lines, because two machines can record here without agreeing on a schema version.
 */
const BACKTEST = join(ROOT, "data", "backtest.jsonl");

function appendBacktest(entry) {
  try {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    appendFileSync(BACKTEST, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.log(`    backtest: could not append - ${e.message}`);
  }
}

const nums = (r) => ({
  impressions: Math.round(r?.impressions ?? 0),
  clicks: Math.round(r?.clicks ?? 0),
  ctr: Number(r?.ctr ?? 0),
  position: Math.round((r?.position ?? 0) * 10) / 10,
});

/**
 * Read the log back: for each slug's latest baseline, the newest measurement, and the difference.
 *
 * It reports and does not conclude. A position that moved two places over five days on forty
 * impressions is not evidence of anything, and a tool that prints a green arrow would teach the
 * operator to trust it anyway. The sample size is printed next to the delta for that reason.
 */
function backtestReport() {
  if (!existsSync(BACKTEST)) {
    console.log("\n  no data/backtest.jsonl yet - nothing has been changed with this tool version.");
    return;
  }
  const entries = readFileSync(BACKTEST, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const base = new Map();
  const measure = new Map();
  for (const e of entries) {
    if (e.type === "baseline" && e.slug) base.set(e.slug, e);
    if (e.type === "measure" && e.slug) measure.set(e.slug, e);
  }
  if (!base.size) {
    console.log("\n  backtest log has no baseline yet.");
    return;
  }

  console.log("\n" + "=".repeat(94));
  console.log("  BACKTEST — title changes with the numbers before and after");
  console.log("=".repeat(94));
  for (const [slug, b] of base) {
    const m = measure.get(slug);
    const before = b.before ?? {};
    console.log(`  ${slug}`);
    console.log(`    ${b.at.slice(0, 10)}  "${String(b.to).slice(0, 66)}"`);
    if (!m) {
      console.log(`    before : ${before.impressions} imp / ${before.clicks} clk / ${(before.ctr * 100).toFixed(2)}% / pos ${before.position}`);
      console.log("    after  : not measured yet");
      continue;
    }
    const a = m.after ?? {};
    const dPos = (before.position ?? 0) - (a.position ?? 0);
    const dCtr = (a.ctr ?? 0) - (before.ctr ?? 0);
    console.log(`    before : ${before.impressions} imp / ${before.clicks} clk / ${(before.ctr * 100).toFixed(2)}% / pos ${before.position}`);
    console.log(`    after  : ${a.impressions} imp / ${a.clicks} clk / ${(a.ctr * 100).toFixed(2)}% / pos ${a.position}   (${m.at.slice(0, 10)}, ${m.windowDays}d window)`);
    console.log(`    delta  : position ${dPos >= 0 ? "+" : ""}${dPos.toFixed(1)}   CTR ${dCtr >= 0 ? "+" : ""}${(dCtr * 100).toFixed(2)}pt   on ${a.impressions} impressions`);
  }
  console.log("");
  console.log("  A delta on a handful of impressions is noise. Wait for the window to refill before reading it.");
}


for (const row of shown) {
  const file = join(dir, `${row.slug}.md`);
  console.log("");
  console.log(`  ${row.slug}`);
  console.log(`    now    : ${row.title}   (${row.title.length} chars)`);
  if (!existsSync(file)) {
    console.log("    skip   : no local markdown for this slug");
    continue;
  }
  const article = { ...fmOf(file), file };
  let result;
  if (approved) {
    /* A reviewed title is applied as given. No sampling, no second opinion. */
    const t = String(approved[row.slug] ?? "").trim();
    if (!t) {
      console.log("    skip   : no approved title for this slug in the apply file");
      continue;
    }
    result = { json: { style: "(approved)", why: "from the apply file", candidates: [{ title: t, score: "-" }] }, best: t };
  } else {
    try {
      result = await propose(row, article);
    } catch (e) {
      console.log(`    FAILED : ${e.message.slice(0, 240)}`);
      continue;
    }
  }

  const { json, best } = result;
  const style = String(json.style ?? "?").trim();
  console.log(`    style  : ${style} — ${String(json.why ?? "").slice(0, 90)}`);
  for (const c of Array.isArray(json.candidates) ? json.candidates : []) {
    const t = String(c?.title ?? "");
    const flag = t.length > MAX_TITLE ? `  OVER ${t.length}` : "";
    console.log(`      ${String(c?.score ?? "?").padStart(2)}  ${t}${flag}`);
  }
  if (!best) {
    console.log("    FAILED : the model returned no best title");
    continue;
  }
  if (best.length > MAX_TITLE) {
    console.log(`    REJECT : "${best}" is ${best.length} chars, over the ${MAX_TITLE} limit. Not written.`);
    continue;
  }
  console.log(`    best   : ${best}   (${best.length} chars)`);

  if (!REWRITE) continue;

  /*
   * The baseline is written BEFORE the file is touched.
   *
   * If it were written after, a rollback would leave a record of a change that never happened, and the
   * only cheap way to tell the two apart afterwards is a note that the change succeeded - which is the
   * thing the gate might be about to say it did not.
   */
  appendBacktest({
    type: "baseline",
    at: new Date().toISOString(),
    slug: row.slug,
    from: article.title,
    to: best,
    of: best.length,
    windowDays: payload?.days ?? DAYS,
    before: nums(row),
  });

  /* Back up, write, gate, and roll back on failure - in that order, never skipping one. */
  const bak = `${file}.bak`;
  copyFileSync(file, bak);
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original.replace(/^title:\s*".*?"\s*$/m, `title: ${JSON.stringify(best)}`), "utf8");

  const qa = qaCheck(file);
  if (!qa.ok) {
    copyFileSync(bak, file);
    rmSync(bak, { force: true });
    console.log(`    ROLLED BACK: qa-check failed (${qa.summary}); the file is byte-identical to before.`);
    continue;
  }
  rmSync(bak, { force: true });
  console.log(`    WROTE  : qa-check ${qa.summary}; backup removed`);
}

console.log("");
console.log(REWRITE
  ? "  Done. Article bodies were not touched - only the title line, checked by qa-check."
  : "  Nothing was written. Re-run with --rewrite to apply a title, or edit one by hand.");

/*
 * --backtest fills in the after-numbers from this run's payload and prints the comparison.
 *
 * A measurement is appended at most once a day per slug. The log is append-only, so a cron that runs
 * it every morning would otherwise bury the one baseline under thirty identical measurements.
 */
if (argv.includes("--backtest")) {
  const lastMeasure = new Map();
  const baseSlugs = new Set();
  if (existsSync(BACKTEST)) {
    for (const line of readFileSync(BACKTEST, "utf8").split("\n").filter(Boolean)) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "baseline" && e.slug) baseSlugs.add(e.slug);
      if (e.type === "measure" && e.slug) lastMeasure.set(e.slug, e.at);
    }
  }
  const fresh = [];
  for (const slug of baseSlugs) {
    const page = rows.find((r) => String(r.page).includes(`/blog/${slug}/`));
    if (!page) continue;
    const last = lastMeasure.get(slug);
    if (last && Date.now() - new Date(last).getTime() < 20 * 3600 * 1000) continue;
    appendBacktest({ type: "measure", at: new Date().toISOString(), slug, windowDays: payload?.days ?? DAYS, after: nums(page) });
    fresh.push(slug);
  }
  if (fresh.length) {
    console.log("");
    console.log(`  measured ${fresh.length} page(s) against this payload: ${fresh.join(", ")}`);
  }
  backtestReport();
}
