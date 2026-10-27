#!/usr/bin/env node
/**
 * Tests for tools/usage-report.mjs.
 *
 * The log is written by the writer, so these tests are about the accountant: a failed call is not a
 * cheap call, a null cost is not zero, and a stub call is not a real one. Each of those is a case
 * below, because each of them, done wrong, produces a number that looks fine and is wrong.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const TOOL = join(ROOT, "tools", "usage-report.mjs");

let pass = 0;
const failures = [];
const record = (name, ok, detail = "") => (ok ? pass++ : failures.push(`${name}${detail ? "  — " + detail : ""}`));

function run(lines, argv = []) {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const log = join(dir, "usage.jsonl");
  if (Array.isArray(lines)) writeFileSync(log, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  else writeFileSync(log, lines);
  const out = spawnSync(process.execPath, [TOOL, "--log", log, ...argv], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

const ok = (over = {}) => ({
  at: "2026-10-20T10:00:00.000Z", role: "writer", model: "ep-20261019161601-9k6dn",
  provider: "ark", ok: true, promptTokens: 1000, completionTokens: 500, estimatedUsd: 0.01, ms: 1200, attempt: 1,
  ...over,
});

/* ── empty ────────────────────────────────────────────────────────────────── */

{
  const { code, stdout } = run([]);
  record("empty: exits 0", code === 0, `code=${code}`);
  record("empty: zero records", /records\s+:\s+0 lines parsed/.test(stdout), stdout.match(/records[^\n]*/)?.[0]);
  record("empty: no cost printed as a number", /estimated\s+:\s+not recorded/.test(stdout));
}

/* ── normal records ───────────────────────────────────────────────────────── */

{
  const { stdout } = run([ok(), ok({ promptTokens: 2000, completionTokens: 1000, estimatedUsd: 0.02 })]);
  record("valid: two successes", /successful\s+:\s+2/.test(stdout));
  record("valid: cost summed", /estimated\s+:\s+\$0\.0300/.test(stdout), stdout.match(/estimated[^\n]*/)?.[0]);
  record("valid: tokens summed", /prompt\s+:\s+3000/.test(stdout));
}

/* ── failure is not a cheap success ───────────────────────────────────────── */

{
  const { stdout } = run([ok(), ok({ ok: false, promptTokens: null, completionTokens: null, estimatedUsd: null, error: "no provider key present" })]);
  record("failed: counted separately", /failed\s+:\s+1/.test(stdout));
  record("failed: excluded from cost", /estimated\s+:\s+\$0\.0100/.test(stdout), stdout.match(/estimated[^\n]*/)?.[0]);
}

/* ── null cost is not zero ────────────────────────────────────────────────── */

{
  const { stdout, code } = run([ok({ estimatedUsd: null }), ok({ estimatedUsd: null })], ["--json"]);
  record("null cost: exits 0", code === 0);
  const parsed = JSON.parse(stdout);
  record("null cost: total is null", parsed.cost.usd_total === null, String(parsed.cost.usd_total));
  record("null cost: coverage states 0/2", parsed.cost.coverage === "0/2", parsed.cost.coverage);
}

/* ── unknown outcome is not success ───────────────────────────────────────── */

{
  const { stdout } = run([ok({ ok: undefined }), ok({ ok: undefined }), ok()]);
  record("unknown: counted apart", /unknown\s+:\s+2/.test(stdout), stdout.match(/unknown[^\n]*/)?.[0]);
  record("unknown: one success only", /successful\s+:\s+1/.test(stdout));
}

/* ── simulated calls are isolated ─────────────────────────────────────────── */

{
  const { stdout, code } = run([ok(), ok({ model: "ep-test", estimatedUsd: 9 }), ok({ model: "ep-z", estimatedUsd: 9 })]);
  record("stub: exits 0", code === 0);
  record("stub: counted", /stub calls\s+:\s+2/.test(stdout), stdout.match(/stub calls[^\n]*/)?.[0]);
  record("stub: excluded from cost", /estimated\s+:\s+\$0\.0100/.test(stdout), stdout.match(/estimated[^\n]*/)?.[0]);
}

/* ── missing model is reported, not guessed ───────────────────────────────── */

{
  const { stdout, code } = run([ok({ model: undefined })], ["--json"]);
  record("missing model: exits 0", code === 0);
  const parsed = JSON.parse(stdout);
  record("missing model: grouped under (missing)", parsed.by_model.some((g) => g.key === "(missing)"), JSON.stringify(parsed.by_model.map((g) => g.key)));
}

/* ── corrupt lines ────────────────────────────────────────────────────────── */

{
  const { code, stdout } = run([ok(), "{ not json", ok()]);
  record("corrupt: non-zero exit", code === 3, `code=${code}`);
  record("corrupt: counted", /1 corrupt/.test(stdout), stdout.match(/records[^\n]*/)?.[0]);
  record("corrupt: totals exclude it", /successful\s+:\s+2/.test(stdout));
}

/* ── JSON shape ───────────────────────────────────────────────────────────── */

{
  const { stdout } = run([ok()], ["--json"]);
  const p = JSON.parse(stdout);
  record("json: has totals", p.totals.records === 1);
  record("json: declares the stub rule", typeof p.totals.simulated_rule === "string");
  record("json: per-article is not computed", p.per_article_cost.status === "not_computable");
  record("json: no raw prompt field leaks", !("prompt" in (p.totals ?? {})) && !("completion" in (p.totals ?? {})));
}

/* ── the real log, read-only ──────────────────────────────────────────────── */

{
  const out = spawnSync(process.execPath, [TOOL, "--json"], { encoding: "utf8" });
  record("real log: exits 0", out.status === 0, `code=${out.status}`);
  const p = JSON.parse(out.stdout);
  record("real log: has records", p.totals.records > 0, String(p.totals.records));
  record("real log: reports the missing join key", /no article_id/.test(p.per_article_cost.reason));
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("RESULT: PASS — cost report never treats null as zero, failure as cheap, or a stub as real");
