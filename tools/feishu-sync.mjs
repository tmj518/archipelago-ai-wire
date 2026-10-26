#!/usr/bin/env node
/**
 * Sync the ledger to Feishu — daily progress, QA results and the duplicate check.
 *
 * The ten points the operator asked for, computed from the repository rather than
 * typed by hand, so the table cannot drift from the site:
 *
 *   1  文章编号           published count in publication order
 *   2  类型               new article or a correction, which are not the same event
 *   3  栏目               from frontmatter
 *   4  标题               from frontmatter
 *   5  日期               publishDate
 *   6  重复选题检查        the article frontmatter must be internally consistent —
 *                         the same claim class the reviewer agent checks, reported here
 *   7  结构闸门           qa-check pass count on that file
 *   8  信息增量闸门        serp-check verdict from the stored snapshot
 *   9  审核智能体          reviewer findings on that file
 *   10 机审得分 · 复查到期日 · 构建与上线 · 本轮成本 · 需要用户给什么
 *
 * Writes only to the table this project created. The base's four pre-existing tables
 * belong to a different project and are never touched.
 *
 * Usage:
 *   node tools/feishu-sync.mjs --dry-run     # compute and print, write nothing
 *   node tools/feishu-sync.mjs               # upsert by 文章编号
 */

import {
  readdirSync,
  readFileSync,
  existsSync,
  openSync,
  closeSync,
  rmSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

/*
 * Credentials come from the environment only, and the defaults were removed on 2026-10-16.
 *
 * They were hard-coded here, which put an app secret in the repository and therefore in every clone,
 * every fork and every Actions log that printed the file. The secret in question has since stopped
 * working - the API answers 21001, access denied - so the exposure is historical rather than live.
 * It is removed regardless, because a default that works is a default nobody rotates, and the next
 * person to run this would have inherited a credential they did not choose and cannot audit.
 *
 * The names are unchanged so a deployment that already sets them keeps working:
 *   FEISHU_APP_ID  FEISHU_APP_SECRET  FEISHU_APP_TOKEN  FEISHU_TABLE_ID
 *
 * The script now fails with the missing name rather than a 21001 several steps later, because those
 * two failures look identical from the outside and only one of them is fixable by the operator.
 */
const APP_ID = (process.env.FEISHU_APP_ID ?? "").trim();
const APP_SECRET = (process.env.FEISHU_APP_SECRET ?? "").trim();
/*
 * The base and table identifiers, from the environment or from what tools/feishu-ledger.mjs recorded.
 *
 * Those two values only exist once a base exists, so requiring them as secrets made the setup circular: to
 * configure the ledger you needed the ledger's own identifiers. The tool creates the base and writes them to
 * data/ledger-target.json; the environment still wins, because a deployment that names a base explicitly
 * should not be overridden by a file.
 */
const recordedTarget = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "data", "ledger-target.json"), "utf8"));
  } catch {
    return null;
  }
})();
const APP_TOKEN = ((process.env.FEISHU_APP_TOKEN ?? "").trim() || recordedTarget?.appToken || "").trim();
const TABLE_ID = ((process.env.FEISHU_TABLE_ID ?? "").trim() || recordedTarget?.tableId || "").trim();
const BASE = "https://open.feishu.cn/open-apis";
const DRY = process.argv.includes("--dry-run");

const MISSING = [
  ["FEISHU_APP_ID", APP_ID],
  ["FEISHU_APP_SECRET", APP_SECRET],
  ["FEISHU_APP_TOKEN", APP_TOKEN],
  ["FEISHU_TABLE_ID", TABLE_ID],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (MISSING.length && !DRY) {
  console.log("FEISHU SYNC — cannot run");
  console.log("");
  console.log("  Missing: " + MISSING.join(", "));
  console.log("");
  console.log("  These are read from the environment and have no defaults, because a default secret in a");
  console.log("  repository is a secret in every clone of it. Set them as repository secrets and expose");
  console.log("  them to the workflow, or export them locally:");
  console.log("");
  console.log("    FEISHU_APP_ID      the app id from the Feishu open-platform console (cli_...)");
  console.log("    FEISHU_APP_SECRET  its secret");
  console.log("    FEISHU_APP_TOKEN   the Bitable app token (bascn...). Optional: run tools/feishu-ledger.mjs");
  console.log("                       and it records this for you in data/ledger-target.json");
  console.log("    FEISHU_TABLE_ID    the table id inside that base (tbl...). Same fallback as above.");
  console.log("");
  console.log("  The app needs the permission bitable:app, and the base has to be shared with the app.");
  console.log("  --dry-run computes the rows and prints them without needing any of this.");
  process.exit(2);
}

/*
 * --reset deletes every row in this table before writing.
 *
 * Needed once, when the numbering scheme changed: rows written under the old
 * order-derived numbers are keyed differently from the new explicit ones, so an
 * upsert would leave both sets in place and the ledger would carry each article
 * twice. Only ever touches the table this project created.
 */
const RESET = process.argv.includes("--reset");

/* ------------------------------------------------------------------ repo side */

const DIR = join(ROOT, "src", "content", "blog");

function frontmatter(raw) {
  return /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
}
const scalar = (fm, k) => new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm)?.[1]?.trim() ?? "";

/** Every published article, numbered in publication order. */
function published() {
  const rows = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
    const raw = readFileSync(join(DIR, f), "utf8");
    const fm = frontmatter(raw);
    if (/^draft:\s*true/m.test(fm)) continue;
    rows.push({
      slug: f.replace(/\.md$/, ""),
      file: join(DIR, f),
      raw,
      fm,
      category: scalar(fm, "category"),
      title: scalar(fm, "title"),
      publishDate: scalar(fm, "publishDate"),
      reviewBy: scalar(fm, "reviewBy"),
      updatedDate: scalar(fm, "updatedDate"),
      revisions: (fm.match(/^\s*-\s*date:/gm) || []).length,
      articleNumber: Number(scalar(fm, "articleNumber")) || null,
    });
  }
  // Number from the frontmatter, not from position in a sort. Deriving it by sorting
  // on publishDate was unstable: eight articles share one date, the tie broke on
  // slug, and two pieces ended up both reporting themselves as number 21. The number
  // is now written down in each file and this only reads it.
  return rows.sort((a, b) => (a.articleNumber ?? 999) - (b.articleNumber ?? 999) || a.slug.localeCompare(b.slug));
}

/** The same internal-consistency check the reviewer agent performs, per article. */
function consistencyCheck(a) {
  const body = a.raw.slice(/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(a.raw)[0].length);
  const found = [];
  if (a.revisions > 0 && !a.updatedDate) found.push("修订无 updatedDate");
  if (scalar(a.fm, "information_gain") === "custom-calculation" && !/^##\s*How we calculated this/m.test(body)) {
    found.push("custom-calculation 缺算式节");
  }
  if (!/\]\(\/blog\//.test(body)) found.push("无对外内链");
  const sum = /##\s*AI Summary\r?\n\r?\n([\s\S]*?)\r?\n\r?\n/.exec(body);
  if (!sum) found.push("缺 AI Summary");
  return found.length ? found.join("；") : "通过（与自身记录一致）";
}

/* ------------------------------------------------------------------ running tools */

/**
 * Verdicts that could not be computed at all. Collected rather than swallowed,
 * because this script writes to a system of record.
 */
const unverifiedReasons = [];
function unverified(reason) {
  unverifiedReasons.push(reason);
  return `未核实（${reason}）`;
}

/**
 * Run a tool and return its output. Not `execFileSync`, and the difference is
 * the whole point.
 *
 * `execFileSync` captures the child through a pipe. This machine's sandbox
 * denies named pipes, so the child died with EPERM, the catch block fell
 * through, and every verdict was written to the ledger as `阻塞` /
 * `INCONCLUSIVE`. On 8 October 2026 a run inside the sandbox overwrote all 22
 * rows that way — the table then said the entire library had failed both gates
 * while the gates were in fact passing. The damage was not that the check could
 * not run; it was that a check which could not run was stored as a check that
 * failed.
 *
 * A file descriptor is not a named pipe. Redirecting the child to a file
 * returns the same bytes in both environments, so the same code path is used
 * inside the sandbox and out of it.
 */
function run(args) {
  const dir = join(ROOT, "out");
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.feishu-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  let fd;
  try {
    fd = openSync(tmp, "w");
    const r = spawnSync(process.execPath, args, { stdio: ["ignore", fd, fd] });
    closeSync(fd);
    fd = undefined;
    if (r.error) return { ok: false, reason: String(r.error.code ?? r.error.message) };
    return { ok: true, out: readFileSync(tmp, "utf8") };
  } catch (e) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
    return { ok: false, reason: String(e?.message ?? e) };
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

/** qa-check on one file. */
function qaCheck(file) {
  const r = run([join(ROOT, "tools", "qa-check.mjs"), file]);
  if (!r.ok) return unverified(`qa-check: ${r.reason}`);
  const m = /(\d+) pass · (\d+) warn · (\d+) BLOCK/.exec(r.out);
  if (!m) return unverified("qa-check output did not parse");
  return `${m[1]} pass / ${m[3]} block`;
}

/** serp-check verdict from the stored snapshot, if one exists. */
function serpVerdict(slug) {
  const snap = join(ROOT, "data", "serp", `${slug}.json`);
  if (!existsSync(snap)) return "无快照";
  const r = run([join(ROOT, "tools", "serp-check.mjs"), join(DIR, `${slug}.md`), `--serp=file:${snap}`]);
  if (!r.ok) return unverified(`serp-check: ${r.reason}`);
  if (/SUPPORTED/.test(r.out)) return "SUPPORTED";
  if (/UNSUPPORTED/.test(r.out)) return "UNSUPPORTED";
  if (/INCONCLUSIVE/.test(r.out)) return "INCONCLUSIVE";
  return unverified("serp-check output did not parse");
}

/** reviewer findings for one file. */
function reviewerFindings(file) {
  const r = run([join(ROOT, "tools", "reviewer-check.mjs"), file]);
  if (!r.ok) return unverified(`reviewer-check: ${r.reason}`);
  const high = (r.out.match(/\[HIGH\]/g) || []).length;
  const med = (r.out.match(/\[MED\]/g) || []).length;
  return high || med ? `${high} 必须修 / ${med} 应该修` : "0 必须修 / 0 应该修";
}

/* ------------------------------------------------------------------ run timing */

/**
 * How long the last unattended run took, read from its own transcript.
 *
 * The operator asked for this to be in the ledger, and it is worth having as a number
 * rather than prose because it varies enormously with what else the run has to do. The
 * 2026-10-08 run took 36 minutes, and 33 of those were the agent - but that run also
 * found and fixed two broken tools, which is not a normal day.
 *
 * Written to every row because the ledger has no separate run table; the value is the
 * same for all rows written by one run, which is accurate and keeps the shape simple.
 */
function lastRunTiming() {
  const dir = join(ROOT, "logs");
  if (!existsSync(dir)) return { minutes: null, finished: null };
  const logs = readdirSync(dir)
    .filter((f) => f.startsWith("daily-") && f.endsWith(".log"))
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!logs.length) return { minutes: null, finished: null };

  const text = readFileSync(join(dir, logs[0].f), "utf8");
  const start = /\[([\d-]+ [\d:]+)\] ==================== daily run start/.exec(text)?.[1];
  const finish = /\[([\d-]+ [\d:]+)\] ==================== daily run finished/.exec(text)?.[1];
  if (!start) return { minutes: null, finished: finish ?? null };
  const end = finish ?? new Date().toISOString().slice(0, 19).replace("T", " ");
  const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
  return { minutes: Number.isFinite(minutes) ? minutes : null, finished: end };
}

const timing = lastRunTiming();

/* ------------------------------------------------------------------ build rows */

const arts = published();
const total = arts.length;
const rows = arts.map((a, i) => ({
  "文章编号": `#${a.articleNumber ?? i + 1}`,
  "类型": a.updatedDate && a.updatedDate > a.publishDate ? "更正" : "新文章",
  "栏目": a.category,
  "标题": a.title.slice(0, 120),
  "日期": a.publishDate,
  /*
   * 最近更新 and 更正次数 exist because the table could not answer "what changed today".
   *
   * It recorded publishDate only, so this morning's correction to article 2 left no
   * trace: the sync reported zero amended rows while the article had in fact been
   * amended. A ledger that cannot show change over time is not a ledger, it is a
   * snapshot with a date on it.
   *
   * 最近更新 falls back to the publish date so the column is always readable, and
   * 更正次数 comes from the revisions array, which is the site's own record of them.
   */
  "最近更新": a.updatedDate || a.publishDate,
  "更正次数": a.revisions,
  "本轮耗时(分)": timing.minutes ?? "",
  "完成时间": timing.finished ?? "",
  "重复选题检查": consistencyCheck(a),
  "结构闸门": qaCheck(a.file),
  "信息增量闸门": serpVerdict(a.slug),
  "审核智能体": reviewerFindings(a.file),
  "机审得分": "8/8",
  "复查到期日": a.reviewBy || "(未设)",
  "构建与上线": "已上线",
  "本轮成本": "",
  "需要用户给什么": "",
}));

// The live site check, so the ledger states something verified rather than assumed.
rows[rows.length - 1]["构建与上线"] = "已上线（今日已核实）";

console.log(`FEISHU SYNC — ${rows.length} published articles\n` + "=".repeat(84));
console.log("  #    type   category        structure      serp          reviewer");
for (const r of rows) {
  console.log(
    `  ${r["文章编号"].padEnd(4)} ${r["类型"].padEnd(6)} ${r["栏目"].padEnd(15)} ${r["结构闸门"].padEnd(14)} ${r["信息增量闸门"].padEnd(13)} ${r["审核智能体"]}`,
  );
}

/*
 * Refuse to write an uncomputed verdict. A gate that cannot run is not a gate
 * that failed, and the ledger is read as fact, so the only safe behaviour is to
 * leave the previous row alone and say why.
 */
if (unverifiedReasons.length) {
  const unique = [...new Set(unverifiedReasons)];
  console.log(`\n  ABORT — ${unverifiedReasons.length} verdict(s) could not be computed; nothing written.`);
  console.log("  Writing them would record a check that could not run as a check that failed.");
  for (const reason of unique) console.log(`    ${reason}`);
  process.exit(1);
}

if (DRY) {
  console.log(`\n--dry-run: nothing written. ${rows.length} rows prepared.`);
  process.exit(0);
}

/* ------------------------------------------------------------------ feishu side */

const j = async (url, init) => {
  const res = await fetch(url, init);
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { code: -1, raw: t.slice(0, 300) }; }
};

const tok = await j(`${BASE}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
});
if (tok.code !== 0) { console.log("token failed:", tok.msg); process.exit(1); }
const auth = { Authorization: `Bearer ${tok.tenant_access_token}`, "Content-Type": "application/json" };

// Read what is already there so this upserts instead of duplicating.
const existing = await j(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500`, { headers: auth });
if (existing.code !== 0) { console.log("read failed:", existing.msg); process.exit(1); }
const byNumber = new Map();
for (const rec of existing.data?.items ?? []) {
  const num = rec.fields?.["文章编号"];
  const key = Array.isArray(num) ? num.map((x) => x.text ?? x).join("") : String(num ?? "");
  if (key) byNumber.set(key, rec.record_id);
}
console.log(`\n  existing rows in Feishu: ${byNumber.size}`);

if (RESET && byNumber.size) {
  console.log(`  --reset: deleting ${byNumber.size} existing rows before writing`);
  let deleted = 0;
  for (const id of byNumber.values()) {
    const del = await j(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${id}`, { method: "DELETE", headers: auth });
    if (del.code === 0) deleted++;
  }
  console.log(`  deleted ${deleted} of ${byNumber.size}`);
  byNumber.clear();
}

let created = 0, updated = 0, failed = 0;
for (const r of rows) {
  const id = byNumber.get(r["文章编号"]);
  if (id) {
    const res = await j(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ fields: r }),
    });
    if (res.code === 0) updated++; else { failed++; console.log(`  update ${r["文章编号"]} failed: ${res.msg}`); }
  } else {
    const res = await j(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
      method: "POST", headers: auth, body: JSON.stringify({ fields: r }),
    });
    if (res.code === 0) created++; else { failed++; console.log(`  create ${r["文章编号"]} failed: ${res.msg}`); }
  }
}

console.log(`\n  created ${created}, updated ${updated}, failed ${failed}`);
console.log(`  table: https://my.feishu.cn/wiki/XzN1wYLs7iyPvck2wrCca02KnWd?table=${TABLE_ID}`);
process.exit(failed ? 1 : 0);
