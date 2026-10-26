#!/usr/bin/env node
/**
 * Create the Feishu Bitable the ledger writes to, so nobody has to build it by hand.
 *
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node tools/feishu-ledger.mjs
 *   ... --dry-run     show what it would create, call nothing but the token endpoint
 *
 * ## Why this exists
 *
 * The ledger needs four values: an app id, an app secret, a base token and a table id. Two of those are
 * credentials a person has to obtain from the Feishu console, and two are identifiers that only exist after a
 * base exists. So the setup instructions were a circle: to configure the ledger you needed the identifiers that
 * the ledger's own base produces.
 *
 * This breaks the circle. Given the two credentials, it creates the base, creates the table, adds every field
 * the sync writes, and records the two identifiers in data/ledger-target.json. The sync reads that file as a
 * fallback, so the repository needs two secrets instead of four and nothing has to be copied by hand.
 *
 * ## Why every field is text
 *
 * The sync writes strings - "#29", "2026-10-17", "0 必须修 / 0 应该修". A date field wants a millisecond
 * timestamp and a number field wants a number, so a typed column turns a formatting change into a failed sync.
 * Text cannot fail on type, and the ledger is read by a person scanning a table rather than by a query.
 *
 * ## What it does not do
 *
 * It does not delete anything, does not overwrite an existing data/ledger-target.json without --force, and is
 * safe to run twice: fields that already exist are skipped rather than duplicated.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
/*
 * A base created by an app belongs to the app, and the operator may not see it in their Feishu drive. --share-to
 * adds them as a full-access collaborator so the base appears in their own space instead of only behind the API.
 *
 * Accepts an email or an open_id. Optional: without it the URL is printed and opening it usually works, because
 * the person who created the app can see what it created.
 */
const SHARE_TO = (process.argv.find((a) => a.startsWith("--share-to=")) ?? "").split("=")[1] ?? "";
const TARGET = join(ROOT, "data", "ledger-target.json");

const APP_ID = (process.env.FEISHU_APP_ID ?? "").trim();
const APP_SECRET = (process.env.FEISHU_APP_SECRET ?? "").trim();
const BASE = "https://open.feishu.cn/open-apis";

/*
 * Every column the sync writes. Kept in one list so a field added to the sync and forgotten here is one edit
 * away from being fixed, rather than a sync that silently drops a column.
 */
const FIELDS = [
  "文章编号",
  "类型",
  "栏目",
  "标题",
  "日期",
  "最近更新",
  "更正次数",
  "本轮耗时(分)",
  "完成时间",
  "重复选题检查",
  "结构闸门",
  "信息增量闸门",
  "审核智能体",
  "机审得分",
  "复查到期日",
  "构建与上线",
  "本轮成本",
  "需要用户给什么",
];

const missing = [
  ["FEISHU_APP_ID", APP_ID],
  ["FEISHU_APP_SECRET", APP_SECRET],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.log("FEISHU LEDGER — cannot run");
  console.log("");
  console.log("  Missing: " + missing.join(", "));
  console.log("");
  console.log("  Create an app at https://open.feishu.cn/app, then:");
  console.log("    - 凭证与基础信息 -> 复制 App ID (cli_...) and App Secret");
  console.log("    - 权限管理 -> add bitable:app (and bitable:app:readonly if you only want reads)");
  console.log("    - 发布版本, and have an admin approve it, or the API returns 99991672");
  console.log("");
  console.log("  The app does not need to be shared with any existing base: this tool creates a new one.");
  process.exit(2);
}

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    const err = new Error(`${path} -> HTTP ${res.status} code ${json.code}: ${json.msg ?? "no message"}`);
    err.code = json.code;
    throw err;
  }
  return json.data ?? {};
}

console.log("FEISHU LEDGER\n" + "=".repeat(78));

/* ── 1  a token ─────────────────────────────────────────────────────────────────────────────────── */
let token;
try {
  const t = await api("/auth/v3/tenant_access_token/internal", {
    method: "POST",
    body: { app_id: APP_ID, app_secret: APP_SECRET },
  });
  token = t.tenant_access_token;
  console.log("  token        : ok");
} catch (e) {
  console.log("  token        : FAILED");
  console.log("");
  console.log("  " + e.message);
  if (e.code === 10014 || e.code === 10003) console.log("  The app id or secret is wrong.");
  if (e.code === 99991672) console.log("  The app is not approved, or bitable:app is not granted.");
  process.exit(1);
}

/* ── 2  an existing target? ──────────────────────────────────────────────────────────────────────── */
if (existsSync(TARGET) && !FORCE) {
  const t = JSON.parse(readFileSync(TARGET, "utf8"));
  console.log("  target       : already recorded in data/ledger-target.json");
  console.log(`                 app_token ${t.appToken}`);
  console.log(`                 table_id  ${t.tableId}`);
  console.log("");
  console.log("  Pass --force to create another base anyway.");
  process.exit(0);
}

/* ── 3  the base ─────────────────────────────────────────────────────────────────────────────────── */
if (DRY) {
  console.log("  dry run      : would create a base called 'Landed Math 台账' with these columns:");
  for (const f of FIELDS) console.log("                   " + f);
  console.log("");
  console.log("  --dry-run: nothing created.");
  process.exit(0);
}

let appToken;
try {
  const made = await api("/bitable/v1/apps", {
    method: "POST",
    token,
    body: { name: "Landed Math 台账" },
  });
  appToken = made.app?.app_token;
  console.log(`  base         : created, app_token ${appToken}`);
} catch (e) {
  console.log("  base         : FAILED - " + e.message);
  process.exit(1);
}

/* ── 4  the table, reusing the default one ───────────────────────────────────────────────────────── */
let tableId;
try {
  const list = await api(`/bitable/v1/apps/${appToken}/tables?page_size=20`, { token });
  const first = (list.items ?? [])[0];
  if (first) {
    tableId = first.table_id;
    console.log(`  table        : reusing the default table ${tableId}`);
    /* Rename it, so the base does not read as an unconfigured template. */
    await api(`/bitable/v1/apps/${appToken}/tables/${tableId}`, {
      method: "PATCH",
      token,
      body: { name: "文章" },
    }).catch(() => {});
  } else {
    const made = await api(`/bitable/v1/apps/${appToken}/tables`, {
      method: "POST",
      token,
      body: { table: { name: "文章", default_view_name: "全部" } },
    });
    tableId = made.table_id;
    console.log(`  table        : created ${tableId}`);
  }
} catch (e) {
  console.log("  table        : FAILED - " + e.message);
  process.exit(1);
}

/* ── 5  the columns ─────────────────────────────────────────────────────────────────────────────── */
let have = [];
try {
  const f = await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`, { token });
  have = (f.items ?? []).map((x) => x.field_name);
} catch {
  have = [];
}

let added = 0;
for (const name of FIELDS) {
  if (have.includes(name)) continue;
  try {
    /* type 1 is text. See the header: a typed column turns a formatting change into a failed sync. */
    await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
      method: "POST",
      token,
      body: { field_name: name, type: 1 },
    });
    added++;
  } catch (e) {
    console.log(`  field ${name}: FAILED - ${e.message}`);
  }
}
console.log(`  columns      : ${have.filter((n) => FIELDS.includes(n)).length} already present, ${added} added`);

/* ── 6  record the identifiers, so only the two credentials stay secret ──────────────────────────── */
mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(
  TARGET,
  JSON.stringify(
    {
      appToken,
      tableId,
      baseUrl: `https://open.feishu.cn/base/${appToken}`,
      createdAt: new Date().toISOString(),
      createdBy: "tools/feishu-ledger.mjs",
    },
    null,
    2,
  ),
  "utf8",
);

/*
 * Optional: make the base visible in the operator's own Feishu drive.
 *
 * POST /drive/v1/permissions/{token}/members with type=bitable. A failure is reported and does not undo the
 * base - the URL still works, and a permission grant can be repeated.
 */
if (SHARE_TO) {
  try {
    await api(`/drive/v1/permissions/${appToken}/members?type=bitable`, {
      method: "POST",
      token,
      body: {
        member_type: SHARE_TO.includes("@") ? "email" : "openid",
        member_id: SHARE_TO,
        perm: "full_access",
      },
    });
    console.log(`  shared       : ${SHARE_TO} now has full access`);
  } catch (e) {
    console.log(`  shared       : FAILED - ${e.message}`);
    console.log(`                 open the URL below instead; the base exists either way`);
  }
}

console.log("");
console.log("  recorded in data/ledger-target.json:");
console.log(`    appToken ${appToken}`);
console.log(`    tableId  ${tableId}`);
console.log("");
console.log(`  Open it: https://open.feishu.cn/base/${appToken}`);
console.log("");
console.log("  Now set only these two as repository secrets:");
console.log("    FEISHU_APP_ID      " + (APP_ID ? "(already set)" : ""));
console.log("    FEISHU_APP_SECRET  " + (APP_SECRET ? "(already set)" : ""));
console.log("");
console.log("  tools/feishu-sync.mjs reads data/ledger-target.json when FEISHU_APP_TOKEN and FEISHU_TABLE_ID");
console.log("  are not set, so the four-value setup is now a two-value setup.");
