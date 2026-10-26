#!/usr/bin/env node
/**
 * The run ledger: one row per pipeline run, in its own Feishu table.
 *
 * The article ledger (tools/feishu-sync.mjs) answers "what is published". It cannot answer
 * "what happened on Tuesday", because a day that published nothing leaves no row and a day that
 * failed twice leaves one. So the operator asked for a second table, eight columns, run-shaped:
 *
 *   运行日期   路线   判决   耗时秒   花费美元   选题   写手/审核   失败原因
 *
 * This writes only that table. It never touches the article ledger, and it finds its own table by
 * name - creating it, and any missing column, if it is not there yet. Running it twice does not
 * duplicate a run: the timestamp is the key.
 *
 *   node tools/feishu-run-ledger.mjs --dry-run      # print the rows, need no credentials
 *   node tools/feishu-run-ledger.mjs --limit=50     # more history than the default 20
 *   node tools/feishu-run-ledger.mjs                # upsert into the 运行台账 table
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const LIMIT = Number((argv.find((a) => a.startsWith("--limit=")) ?? "").slice(8)) || 20;

const BASE = "https://open.feishu.cn/open-apis";
const TABLE_NAME = "运行台账";

/*
 * The primary field is the one column Bitable requires and the one the grid sorts by, so it holds a
 * readable key rather than being the "多行文本" that a table created over the API comes with. The
 * timestamp inside it duplicates 运行日期 on purpose: the key has to be self-describing in a row that
 * is read alone.
 */
const KEY_FIELD = "运行编号";

/*
 * Eight columns, all text.
 *
 * Type 1 (text) for every one of them, including the numbers. A column typed as number refuses ""
 * and turns a missing value into a failed write; a text column records the absence as the absence,
 * and the reader can tell "0.00" from "not reported". This is the same reason the article ledger
 * uses text everywhere.
 */
const FIELDS = ["运行日期", "路线", "判决", "耗时秒", "花费美元", "选题", "写手/审核", "失败原因"];

/* ── rows, from the repository ─────────────────────────────────────────────────────────────────── */

function runFiles() {
  const dir = join(ROOT, "data", "runs");
  if (!existsSync(dir)) return [];
  /*
   * latest.json is included, not skipped.
   *
   * Only the agent route writes a dated file. A script-route run - the one that publishes on the
   * 07:20 cron - is recorded nowhere else, so skipping latest.json would drop every script run from
   * the ledger except whichever was newest. It is a copy of the newest run either way, so the
   * dedupe below removes it whenever a dated file already carries the same run.
   */
  const seen = new Set();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
        return j?.at ? j : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .filter((j) => {
      const key = `${j.at}|${j.route ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, LIMIT);
}

/**
 * "2026-10-21T06:06:37.004Z" -> "2026-10-21 06:06:37Z".
 *
 * Seconds are kept because this value is the row's key: two runs of different routes can start in
 * the same minute, and a key that collides would turn the second one into an update of the first.
 */
const stamp = (iso) => String(iso ?? "").replace("T", " ").replace(/\.\d+Z?$/, "Z");

/**
 * Who wrote and who reviewed.
 *
 * The run record stores providers as a list and the writer's endpoint inside the research log, so
 * this reads both and says what it actually found. An agent run has neither, and then the cell says
 * "未记录" rather than inventing a model.
 */
function roles(j) {
  const providers = Array.isArray(j.providers) ? j.providers : [];
  const log = Array.isArray(j.researchLog) ? j.researchLog : [];
  const modelLine = log.map((l) => /model\s*:\s*(\S+)\s*$/.exec(l)?.[1]).filter(Boolean).pop();
  const rolesLine = log.map((l) => /roles\s*:\s*(.+)$/.exec(l)?.[1]).filter(Boolean).pop();
  if (rolesLine) return rolesLine.trim();
  if (providers.length === 2) return `${providers[0]} 写 / ${providers[1]} 审`;
  if (modelLine) return modelLine;
  if (providers.length) return providers.join(", ");
  return "未记录";
}

/** The subject: the article slug for a publishing run, empty for a run that chose not to publish. */
function subject(j) {
  if (typeof j.article === "string" && j.article) return j.article;
  if (Array.isArray(j.published) && j.published.length) return j.published[0];
  if (j.directive?.slug) return j.directive.slug;
  return "";
}

/** Why a run did not publish, from the run's own reasons and its failed steps. */
function failure(j) {
  const reasons = Array.isArray(j.reasons) ? j.reasons.filter(Boolean) : [];
  if (reasons.length) return reasons.join("；").slice(0, 900);
  const bad = (Array.isArray(j.steps) ? j.steps : [])
    .filter((s) => s && s.ok === false && !/unavailable, recorded as a lesson/.test(String(s.detail ?? "")))
    .map((s) => `${s.name}: ${s.detail}`);
  if (bad.length) return bad.join("；").slice(0, 900);
  return "";
}

const rows = runFiles().map((j) => {
  const at = stamp(j.at);
  const route = String(j.route ?? "未记录");
  return {
    [KEY_FIELD]: `${at} · ${route}`,
    运行日期: at,
    路线: route,
    判决: String(j.verdict ?? "未记录"),
    耗时秒: j.seconds != null ? String(j.seconds) : "",
    花费美元: j.usage?.usd != null ? Number(j.usage.usd).toFixed(4) : "",
    选题: subject(j),
    写手_审核: roles(j),
    失败原因: failure(j),
  };
});

/* The Feishu column is named 写手/审核; a slash in a JS key is legal, so keep one name everywhere. */
for (const r of rows) {
  r["写手/审核"] = r.写手_审核;
  delete r.写手_审核;
}

console.log(`RUN LEDGER — ${rows.length} run(s) from data/runs\n` + "=".repeat(88));
for (const r of rows) {
  const secs = r["耗时秒"] === "" ? "  -" : String(r["耗时秒"]).padStart(4);
  const usd = r["花费美元"] === "" ? "-" : `$${r["花费美元"]}`;
  console.log(`  ${r["运行日期"].padEnd(21)} ${r["路线"].padEnd(7)} ${r["判决"].padEnd(26)} ${secs}s ${usd.padStart(8)}`);
  console.log(`      ${r["写手/审核"]}`);
  if (r["选题"]) console.log(`      subject : ${r["选题"]}`);
  if (r["失败原因"]) console.log(`      reason  : ${r["失败原因"].slice(0, 110)}`);
}

if (!rows.length) {
  console.log("\n  No run records. This writes rows, it does not invent them.");
  process.exit(0);
}

if (DRY) {
  console.log("\n--dry-run: nothing written. Columns: " + FIELDS.join(" | "));
  process.exit(0);
}

/* ── Feishu ───────────────────────────────────────────────────────────────────────────────────── */

const APP_ID = (process.env.FEISHU_APP_ID ?? "").trim();
const APP_SECRET = (process.env.FEISHU_APP_SECRET ?? "").trim();
/*
 * The base token: the environment, then what this tool recorded last time, then - if neither - a base
 * this run creates.
 *
 * Requiring it as a secret made the setup circular: the token only exists once a base exists, and the
 * thing that creates the base needs the token. A deployment that names a base explicitly still wins;
 * a deployment that has only the app id and secret bootstraps itself and records the result in
 * data/ledger-target.json, which is committed, so the next run finds it.
 */
let recordedTarget = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "data", "ledger-target.json"), "utf8"));
  } catch {
    return null;
  }
})();
let APP_TOKEN = ((process.env.FEISHU_APP_TOKEN ?? "").trim() || recordedTarget?.appToken || "").trim();

const MISSING = [["FEISHU_APP_ID", APP_ID], ["FEISHU_APP_SECRET", APP_SECRET]]
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (MISSING.length) {
  console.log("\n  cannot write: missing " + MISSING.join(", "));
  console.log("  The app's id and secret are the only two things that cannot be created here.");
  console.log("  --dry-run needs none of them.");
  process.exit(2);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({ code: -1, msg: `HTTP ${res.status}` }));
  if (j.code !== 0) throw new Error(`${method} ${path}: ${j.code} ${j.msg ?? ""}`);
  return j.data ?? j;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Three attempts, five seconds apart.
 *
 * Feishu answers 21001 "access denied due to platform policy" when the same app exchanges tokens too
 * often in a short window - seen on 2026-10-22, when a debugging session made a dozen token requests in
 * an hour and the endpoint then refused the credentials that had worked minutes earlier. A scheduled run
 * makes one request a day and should never hit it, but a retry is free and turns a red morning into a
 * green one when the limit has already cleared.
 *
 * Only the transport is retried, never a write that may have landed: the record calls are safe because
 * they are upserts keyed by 运行日期, so a repeated PUT changes nothing.
 */
async function apiRetry(path, opts, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await api(path, opts);
    } catch (e) {
      last = e;
      const policy = /21001/.test(String(e.message));
      console.log(`  attempt ${i}/${attempts} failed${policy ? " (platform policy)" : ""}: ${String(e.message).slice(0, 90)}`);
      if (i < attempts) await sleep(5000);
    }
  }
  throw last;
}

const tok = await apiRetry("/auth/v3/tenant_access_token/internal", {
  method: "POST",
  body: { app_id: APP_ID, app_secret: APP_SECRET },
}).catch((e) => {
  console.log("  token: FAILED after retries - " + String(e.message).slice(0, 120));
  console.log("  The table is not updated this run; nothing else is affected.");
  process.exit(1);
});
const token = tok.tenant_access_token;

/*
 * Bootstrap: no base token means no base yet, so make one.
 *
 * The app id and secret are the only credentials a person has to create, and they already exist. A
 * base is a container this tool can create for itself; asking the operator to create one by hand and
 * then paste its token back in is the step that has kept this ledger empty all week.
 */
/*
 * A recorded base is verified before it is trusted.
 *
 * The operator hands over a Multidimensional Table link, and the token behind that link is recorded in
 * data/ledger-target.json. A stale or wrong token must not be a dead end: if the base cannot be read,
 * this falls back to creating one, which is the only action that always works with a valid credential.
 */
if (APP_TOKEN) {
  try {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, { token });
    console.log(`\n  base  : reusing ${APP_TOKEN}`);
  } catch (e) {
    console.log(`\n  base  : recorded token ${APP_TOKEN} is not readable - ${e.message}`);
    console.log("          creating a base of this project's own instead");
    APP_TOKEN = "";
  }
}

if (!APP_TOKEN) {
  try {
    const made = await api("/bitable/v1/apps", {
      method: "POST",
      token,
      body: { name: "Landed Math 数据中控台" },
    });
    APP_TOKEN = made.app?.app_token ?? "";
    console.log(`  base  : created "Landed Math 数据中控台" (${APP_TOKEN})`);
  } catch (e) {
    console.log("  base  : FAILED to create - " + e.message);
    console.log("          the app needs the bitable:app permission, and drive space to hold a base.");
    process.exit(1);
  }
}

/*
 * The table is found by name, not by an id in a secret.
 *
 * An id would make the first run circular - the table does not exist until something creates it,
 * and the thing that creates it needs the id. Looking it up by name means a fresh base works with
 * one credential and no setup step.
 */
async function findTable() {
  const list = await api(`/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, { token });
  const hit = (list.items ?? []).find((t) => t.name === TABLE_NAME);
  if (hit) return { id: hit.table_id, created: false };
  const made = await api(`/bitable/v1/apps/${APP_TOKEN}/tables`, {
    method: "POST",
    token,
    /*
     * Name only. `default_view_name` reads like it belongs here and is rejected with 1254001
     * WrongRequestBody - the whole request, not just the extra field. A table created this way gets a
     * default grid view, which is what the ledger wants anyway.
     */
    body: { table: { name: TABLE_NAME } },
  });
  return { id: made.table_id, created: true };
}

let table;
try {
  table = await findTable();
  console.log(`  table : ${TABLE_NAME} ${table.created ? "created" : "found"} (${table.id})`);
} catch (e) {
  console.log("  table : FAILED - " + e.message);
  process.exit(1);
}

/*
 * A table made over the API arrives with one primary column called 多行文本. Rename it, because it is
 * the column a reader sees first and the one the grid sorts by, and a ledger whose leading column says
 * "long text" teaches nobody anything.
 */
try {
  const f0 = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/fields?page_size=100`, { token });
  const primary = (f0.items ?? []).find((x) => x.is_primary);
  if (primary && primary.field_name !== KEY_FIELD) {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/fields/${primary.field_id}`, {
      method: "PUT",
      token,
      body: { field_name: KEY_FIELD, type: 1 },
    });
    console.log(`  field : primary column "${primary.field_name}" renamed to ${KEY_FIELD}`);
  }
} catch (e) {
  console.log(`  field : could not rename the primary column - ${e.message}`);
}

/* Record what was created, so the next run reuses it instead of making a second base. */
try {
  mkdirSync(join(ROOT, "data"), { recursive: true });
  writeFileSync(
    join(ROOT, "data", "ledger-target.json"),
    JSON.stringify({ appToken: APP_TOKEN, runTableId: table.id, runTableName: TABLE_NAME, at: new Date().toISOString() }, null, 2),
    "utf8",
  );
  console.log("  record: data/ledger-target.json written (commit it; it is what the next run reads)");} catch (e) {
  console.log("  record: could not write data/ledger-target.json - " + e.message);
}

/* Missing columns are added rather than reported, so the first run on a fresh table is the last run. */
let have = [];
try {
  const f = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/fields?page_size=100`, { token });
  have = (f.items ?? []).map((x) => x.field_name);
} catch {
  have = [];
}
let added = 0;
for (const name of FIELDS) {
  if (have.includes(name)) continue;
  try {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/fields`, {
      method: "POST",
      token,
      body: { field_name: name, type: 1 },
    });
    added++;
  } catch (e) {
    console.log(`  field ${name}: FAILED - ${e.message}`);
  }
}
console.log(`  columns: ${FIELDS.filter((n) => have.includes(n)).length} present, ${added} added`);

/* Existing rows, keyed by the timestamp column, so a re-run updates instead of duplicating. */
const existing = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/records?page_size=500`, { token });
const byStamp = new Map();
for (const rec of existing.items ?? []) {
  const v = rec.fields?.["运行日期"];
  const key = Array.isArray(v) ? v.map((x) => x.text ?? x).join("") : String(v ?? "");
  if (key) byStamp.set(key, rec.record_id);
}
console.log(`  existing rows: ${byStamp.size}`);

let created = 0, updated = 0, failed = 0;
for (const r of rows) {
  const id = byStamp.get(r["运行日期"]);
  const path = id
    ? `/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/records/${id}`
    : `/bitable/v1/apps/${APP_TOKEN}/tables/${table.id}/records`;
  try {
    await api(path, { method: id ? "PUT" : "POST", token, body: { fields: r } });
    if (id) updated++;
    else created++;
  } catch (e) {
    failed++;
    console.log(`  ${r["运行日期"]}: FAILED - ${e.message}`);
  }
}

console.log(`\n  created ${created}, updated ${updated}, failed ${failed}`);
process.exit(failed ? 1 : 0);
