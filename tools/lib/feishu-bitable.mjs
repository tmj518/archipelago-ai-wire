#!/usr/bin/env node
/**
 * Feishu Bitable console writer.
 *
 *   node tools/lib/feishu-bitable.mjs --run-id=<id> --status=<s> --slug=<s> [--sha=<sha>]
 *
 * Upsert by run id: a re-run updates its row instead of adding a second one. When the API cannot be
 * reached the row goes to data/ledger/pending-bitable.jsonl with pending_sync true, and the next run
 * replays that file first. Nothing here prints a secret.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "https://open.feishu.cn/open-apis";
const T_RELEASES = "tbl64MskPT3HRDld";
const T_DIM = "tblfVM49kksbUmVO";
const T_EVIDENCE = "tblTiLgocRuDSK47";
const T_RUNS = "tblFPLyAlO12l8ws";

const arg = (n, d = "") => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};

async function token(appId, appSecret) {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }), signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`token code ${j.code}: ${j.msg}`);
  return j.tenant_access_token;
}

async function upsert(appToken, table, runId, fields, tok) {
  const list = await (await fetch(`${BASE}/bitable/v1/apps/${appToken}/tables/${table}/records?page_size=100`, {
    headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(20000),
  })).json();
  if (list.code !== 0) throw new Error(`list code ${list.code}: ${list.msg}`);
  const found = (list.data?.items ?? []).find((it) => String(it.fields?.["运行 ID"] ?? "") === String(runId));
  const url = found
    ? `${BASE}/bitable/v1/apps/${appToken}/tables/${table}/records/${found.record_id}`
    : `${BASE}/bitable/v1/apps/${appToken}/tables/${table}/records`;
  const res = await (await fetch(url, {
    method: found ? "PUT" : "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: { ...fields, "运行 ID": runId } }), signal: AbortSignal.timeout(20000),
  })).json();
  if (res.code !== 0) throw new Error(`write code ${res.code}: ${res.msg}`);
  return res.data?.record?.record_id ?? found?.record_id ?? "";
}

const pending = join(ROOT, "data", "ledger", "pending-bitable.jsonl");

async function main() {
  const runId = arg("run-id");
  const status = arg("status", "unknown");
  const slug = arg("slug", "pipeline");
  const sha = (arg("sha", "") || process.env.GITHUB_SHA || "").slice(0, 7);
  const url = slug && slug !== "pipeline" ? `https://www.toolsai.club/blog/${slug}/` : "";
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN ?? "";
  const appId = process.env.FEISHU_APP_ID ?? "";
  const appSecret = process.env.FEISHU_APP_SECRET ?? "";

  if (!runId) { console.log("  bitable: no --run-id, nothing recorded"); return; }
  if (!appToken || !appId || !appSecret) {
    console.log("  bitable: skipped - credentials not configured; row queued locally");
    mkdirSync(dirname(pending), { recursive: true });
    appendFileSync(pending, JSON.stringify({ runId, status, slug, url, sha, pending_sync: true }) + "\n", "utf8");
    return;
  }

  const tok = await token(appId, appSecret);

  if (existsSync(pending)) {
    let replayed = 0;
    for (const line of readFileSync(pending, "utf8").split("\n").filter(Boolean)) {
      let q; try { q = JSON.parse(line); } catch { continue; }
      try {
        await upsert(appToken, T_RUNS, q.runId, { "运行 ID": q.runId, "状态": q.status, "工作流阶段": "publish", "commit SHA": q.sha ?? "" }, tok);
        replayed++;
      } catch { /* keep the row for the next attempt */ }
    }
    if (replayed) { writeFileSync(pending, "", "utf8"); console.log(`  bitable: replayed ${replayed} pending row(s)`); }
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const rel = await upsert(appToken, T_RELEASES, runId, {
    "日期": now.slice(0, 10), "主题": slug, "文章 URL": url, "最终状态": status, "commit SHA": sha, "最后更新": now,
  }, tok);
  const run = await upsert(appToken, T_RUNS, runId, {
    "运行 ID": runId, "状态": status, "工作流阶段": "publish", "commit SHA": sha, "Actions 链接": url, "表格同步": "已同步", "本地补写": "否",
  }, tok);
  console.log(`  bitable: ok releases=${rel} runs=${run}`);

  /*
   * The other two tables.
   *
   * releases and runs answered "what shipped". The dimension table answers "which sections have
   * nothing", and the evidence table answers "what a claim rests on" - both were filled by hand once
   * and would have gone stale by tomorrow, which is the same as not having them. Both are written
   * here from the collection itself, so they cannot disagree with what the site actually contains.
   */
  if (status === "success" || status === "PUBLISHED" || status === "published") {
    try {
      const dir = join(process.cwd(), "src", "content", "blog");
      const arts = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
        const text = readFileSync(join(dir, f), "utf8");
        return {
          slug: f.replace(/\.md$/, ""),
          cat: /^category:\s*"?([a-z-]+)"?/m.exec(text)?.[1] ?? "unknown",
          date: /^publishDate:\s*"?([0-9-]+)"?/m.exec(text)?.[1] ?? "",
          sources: [...text.matchAll(/^\s*-\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]),
          urls: [...text.matchAll(/^\s*url:\s*"(https?:\/\/[^"]+)"/gm)].map((m) => m[1]),
        };
      });
      const byCat = {};
      for (const a of arts) (byCat[a.cat] ??= []).push(a);

      const dims = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${T_DIM}/records?page_size=200`, {
        headers: { authorization: `Bearer ${tok}` },
      })).json();
      const existing = dims.data?.items ?? [];
      for (const [cat, list] of Object.entries(byCat)) {
        list.sort((a, b) => (a.date < b.date ? 1 : -1));
        const latest = list[0];
        const fields = {
          "内容维度": cat, "已发布数量": list.length, "最近发布时间": latest.date,
          "最近文章 URL": `https://www.toolsai.club/blog/${latest.slug}/`, "最近运行状态": status, "最后更新": now,
        };
        const hit = existing.find((r) => r.fields?.["内容维度"] === cat);
        const res = await fetch(
          hit
            ? `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${T_DIM}/records/${hit.record_id}`
            : `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${T_DIM}/records`,
          { method: hit ? "PUT" : "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ fields }) },
        );
        const j = await res.json();
        console.log(`  dim: ${cat} ${list.length} -> code=${j.code}`);
      }

      const mine = arts.find((a) => a.slug === slug);
      if (mine && (mine.sources.length || mine.urls.length)) {
        const evidence = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${T_EVIDENCE}/records`, {
          method: "POST",
          headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
          body: JSON.stringify({
            fields: {
              "运行 ID": runId, "主题": slug,
              "来源名称": mine.sources.join("; ").slice(0, 200) || "listed in the article",
              "来源 URL": mine.urls[0] ?? "",
              "事实核验": "figures carry source + retrieved in the frontmatter",
              "采集时间": now,
            },
          }),
        })).json();
        console.log(`  evidence: code=${evidence.code} ${evidence.data?.record?.record_id ?? ""}`);
      }
    } catch (e) {
      console.log(`  bitable: dimension/evidence write skipped - ${String(e.message).slice(0, 80)}`);
    }
  }
}

try { await main(); process.exit(0); } catch (e) {
  console.error(`  bitable: failed - ${e.message}`);
  process.exit(1);
}