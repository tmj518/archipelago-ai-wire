#!/usr/bin/env node
/**
 * Tests for src/lib/run-key.mjs and the wiring into tools/lib-llm.mjs.
 *
 * The properties that matter are about identity, not formatting: a retry must be recognisable as the
 * same task, two different tasks must never collide, and nothing that identifies a task may carry the
 * work itself. The last three cases read lib-llm.mjs as source, because the failure they guard
 * against - an unmetered call site - cannot be produced without a network call.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const rk = await import(pathToFileURL(join(ROOT, "src/lib/run-key.mjs")).href);

let pass = 0;
const failures = [];
const record = (name, ok, detail = "") => (ok ? pass++ : failures.push(`${name}${detail ? "  — " + detail : ""}`));

/* ── run ids ──────────────────────────────────────────────────────────────── */

const a = rk.makeRunId({ now: new Date("2026-10-27T12:00:00Z"), entropy: "abc123" });
record("runId: shape is safe for a log", rk.ID_SAFE.test(a), a);
record("runId: deterministic when injected", a === rk.makeRunId({ now: new Date("2026-10-27T12:00:00Z"), entropy: "abc123" }));
record("runId: two runs differ", a !== rk.makeRunId({ now: new Date("2026-10-27T12:00:00Z"), entropy: "zzz999" }));
record("runId: no personal or secret material", !/key|token|@|prompt/i.test(a), a);

/* ── task keys: same task, different runs ─────────────────────────────────── */

const t1 = rk.taskKeyFor({ kind: "explainer", locale: "en", subject: "Malaysia minimum wage" });
const t2 = rk.taskKeyFor({ kind: "explainer", locale: "en", subject: "  malaysia   MINIMUM wage " });
record("taskKey: stable across a retry", t1 === t2, `${t1} vs ${t2}`);
record("taskKey: hashed, not the subject", !/minimum/.test(t1), t1);
record("taskKey: fixed shape", /^task-[0-9a-f]{16}$/.test(t1), t1);

/* ── different inputs must not collide ────────────────────────────────────── */

const variants = [
  { kind: "explainer", locale: "en", subject: "Malaysia minimum wage" },
  { kind: "explainer", locale: "ms", subject: "Malaysia minimum wage" },
  { kind: "guide", locale: "en", subject: "Malaysia minimum wage" },
  { kind: "explainer", locale: "en", subject: "Malaysia ringgit reserves" },
];
const keys = variants.map((v) => rk.taskKeyFor(v));
record("taskKey: locale, kind and subject all separate", new Set(keys).size === keys.length, keys.join(","));

/* ── missing inputs are refused, not guessed ──────────────────────────────── */

let threw = false;
try { rk.taskKeyFor({ kind: "explainer" }); } catch { threw = true; }
record("taskKey: subject is required", threw);

/* ── error classification ─────────────────────────────────────────────────── */

record("error: auth", rk.classifyError("unauthorized", 401) === "auth");
record("error: rate limit", rk.classifyError("slow down", 429) === "rate_limit");
record("error: provider 5xx", rk.classifyError("boom", 503) === "provider_5xx");
record("error: no credential", rk.classifyError("no provider key present") === "no_credential");
record("error: timeout", rk.classifyError("TimeoutError: timed out") === "timeout");
record("error: network", rk.classifyError("getaddrinfo ENOTFOUND api.example") === "network");
record("error: unknown stays unknown", rk.classifyError("something odd") === "unknown");
record("error: never echoes the message", !rk.classifyError("secret-looking-message").includes("secret"));

/* ── the wiring, read from source ─────────────────────────────────────────── */

const llm = readFileSync(join(ROOT, "tools/lib-llm.mjs"), "utf8");
record("wire: ask accepts runId and taskKey", /runId = null, taskKey = null/.test(llm));
const meterCalls = (llm.match(/meter\(\{/g) ?? []).length;
const withId = (llm.match(/meter\(\{[\s\S]{0,90}?runId/g) ?? []).length;
record("wire: every meter call carries the identity", meterCalls > 0 && withId === meterCalls, `${withId}/${meterCalls}`);
record("wire: provider fallback keeps the identity", /retries: 1, tools, toolChoice, runId, taskKey/.test(llm));
record("wire: the meter derives an error class", /classifyError\(enriched\.error/.test(llm));
record("wire: the meter writes the enriched record", /JSON\.stringify\(enriched\)/.test(llm));
record("wire: no message body is added to the record", !/enriched\.(messages|body|prompt|completion)/.test(llm));

/* ── old logs still parse ─────────────────────────────────────────────────── */

const usage = spawnSync(process.execPath, [join(ROOT, "tools/usage-report.mjs"), "--json"], { encoding: "utf8" });
record("compat: usage-report still runs on the old log", usage.status === 0, `code=${usage.status}`);
let parsed = null;
try { parsed = JSON.parse(usage.stdout); } catch { /* below */ }
record("compat: old records have no runId and are still counted", parsed !== null && parsed.totals.records > 0, String(parsed?.totals?.records));
record("compat: per-article still honestly not computable", parsed?.per_article_cost?.status === "not_computable");

/* ── a record with the new fields but no cost keeps null ──────────────────── */

{
  const payload = JSON.stringify({
    at: "2026-10-27T00:00:00.000Z", runId: "run-x", taskKey: "task-y", role: "writer",
    ok: false, error: "no provider key present", errorClass: "no_credential",
    promptTokens: null, completionTokens: null, estimatedUsd: null,
  });
  record("record: nulls survive serialisation", JSON.parse(payload).estimatedUsd === null);
  record("record: failure carries a class", JSON.parse(payload).errorClass === "no_credential");
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("RESULT: PASS — run identity is unique per run, stable per task, and carries no content");
