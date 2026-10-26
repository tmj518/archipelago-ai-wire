/**
 * The Feishu open-API plumbing shared by the ledger tools.
 *
 * Small on purpose: a token exchange, a JSON call with three retries, and the "find or create this
 * table, then make sure these columns exist" sequence that both ledgers need. It is not a client
 * library - there are two callers and both know exactly which endpoints they use.
 */

const BASE = "https://open.feishu.cn/open-apis";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({ code: -1, msg: `HTTP ${res.status}` }));
  if (j.code !== 0) throw new Error(`${method} ${path}: ${j.code} ${j.msg ?? ""}`);
  return j.data ?? j;
}

/**
 * Three attempts, five seconds apart.
 *
 * Feishu answers 21001 "access denied due to platform policy" when an app exchanges tokens too often in
 * a short window, and the answer is indistinguishable from a revoked credential. A retry is free and
 * turns a red morning into a green one once the window has cleared. Only safe calls are retried - every
 * write in these tools is an upsert keyed by a stable string, so a repeated PUT changes nothing.
 */
export async function apiRetry(path, opts, attempts = 3, onFail = null) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await api(path, opts);
    } catch (e) {
      last = e;
      if (onFail) onFail(i, attempts, e);
      /* Exponential: 5s, 10s, 20s. A fixed five seconds hammers a limit that is measured in minutes. */
      if (i < attempts) await sleep(5000 * 2 ** (i - 1));
    }
  }
  throw last;
}

/** Tenant token from the app id and secret. Returns null and prints why on failure. */
export async function tenantToken(appId, appSecret, log = console.log) {
  if (!appId || !appSecret) {
    log("  missing FEISHU_APP_ID or FEISHU_APP_SECRET");
    return null;
  }
  try {
    return (
      await apiRetry("/auth/v3/tenant_access_token/internal", {
        method: "POST",
        body: { app_id: appId, app_secret: appSecret },
      }, 3, (i, n, e) => log(`  token attempt ${i}/${n} failed: ${String(e.message).slice(0, 90)}`))
    ).tenant_access_token;
  } catch (e) {
    log(`  token: FAILED after retries - ${String(e.message).slice(0, 120)}`);
    return null;
  }
}

/**
 * Find a table by name, create it if absent, and make sure every listed column exists.
 *
 * A table made over the API arrives with one primary column called 多行文本. `primaryName` renames it,
 * because it is the column the grid sorts by and "long text" teaches a reader nothing.
 */
export async function ensureTable({ token, appToken, name, fields, primaryName }, log = console.log) {
  const list = await api(`/bitable/v1/apps/${appToken}/tables?page_size=100`, { token });
  const hit = (list.items ?? []).find((t) => t.name === name);

  let tableId = hit?.table_id ?? null;
  if (tableId) {
    log(`  table : ${name} found (${tableId})`);
  } else {
    /* Name only: `default_view_name` inside the table object fails the whole call with 1254001. */
    const made = await api(`/bitable/v1/apps/${appToken}/tables`, { method: "POST", token, body: { table: { name } } });
    tableId = made.table_id;
    log(`  table : ${name} created (${tableId})`);
  }

  const current = await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`, { token }).catch(() => ({ items: [] }));
  const have = (current.items ?? []).map((x) => x.field_name);

  const primary = (current.items ?? []).find((x) => x.is_primary);
  if (primaryName && primary && primary.field_name !== primaryName) {
    await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${primary.field_id}`, {
      method: "PUT",
      token,
      body: { field_name: primaryName, type: 1 },
    }).catch(() => {});
    /* The rename happened after `have` was read, so without this the loop below tries to create the
       primary column a second time and logs a failure that is not one. */
    have.push(primaryName);
    log(`  field : primary column "${primary.field_name}" renamed to ${primaryName}`);
  }

  let added = 0;
  for (const f of fields) {
    if (have.includes(f)) continue;
    try {
      await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
        method: "POST",
        token,
        body: { field_name: f, type: 1 },
      });
      added++;
    } catch (e) {
      log(`  field ${f}: FAILED - ${String(e.message).slice(0, 80)}`);
    }
  }
  log(`  columns: ${fields.filter((f) => have.includes(f)).length} present, ${added} added`);
  return tableId;
}

/** Upsert rows keyed by one column. Returns counts. */
export async function upsertRows({ token, appToken, tableId, keyField, rows }, log = console.log) {
  const existing = await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500`, { token });
  const byKey = new Map();
  const extras = [];
  for (const rec of existing.items ?? []) {
    const v = rec.fields?.[keyField];
    const key = Array.isArray(v) ? v.map((x) => x.text ?? x).join("") : String(v ?? "");
    if (!key) continue;
    /*
     * A key that appears twice is a table that will never agree with itself.
     *
     * The map keeps one record per key, so the second copy is never touched by an upsert and sits there
     * showing stale figures - 内容台账 had exactly one such pair (blog:eu-trade-defence-...) from a piece
     * that was recorded twice. Extra copies are deleted in the same pass that upserts, which makes the
     * table self-healing rather than merely append-safe.
     */
    if (byKey.has(key)) extras.push(rec.record_id);
    else byKey.set(key, rec.record_id);
  }
  if (extras.length) {
    let dropped = 0;
    for (const id of extras) {
      try {
        await api(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${id}`, { method: "DELETE", token });
        dropped++;
      } catch (e) {
        log(`  duplicate ${id}: could not delete - ${String(e.message).slice(0, 70)}`);
      }
    }
    log(`  duplicates: removed ${dropped} of ${extras.length} extra record(s) sharing a key`);
  }
  log(`  existing: ${byKey.size}`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const r of rows) {
    const id = byKey.get(r[keyField]);
    const path = id
      ? `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${id}`
      : `/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
    try {
      await api(path, { method: id ? "PUT" : "POST", token, body: { fields: r } });
      if (id) updated++;
      else created++;
    } catch (e) {
      failed++;
      log(`  ${r[keyField]}: FAILED - ${String(e.message).slice(0, 100)}`);
    }
  }
  return { created, updated, failed };
}
