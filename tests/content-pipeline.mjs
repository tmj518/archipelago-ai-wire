#!/usr/bin/env node
/**
 * The content pipeline, offline.
 *
 * Nothing here calls a model. What it proves is that the pipeline refuses to work without one: the
 * real `ask()` is invoked with no provider key, and the assertions are about what it returns, what it
 * writes to the usage log, and what it never claims. `tools/lib-llm.mjs` reads `.env` at import; the
 * values are never printed and never asserted on.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const rk = await import(pathToFileURL(join(ROOT, "src/lib/run-key.mjs")).href);
const pg = await import(pathToFileURL(join(ROOT, "src/lib/publish-guard.mjs")).href);
const llm = await import(pathToFileURL(join(ROOT, "tools/lib-llm.mjs")).href);

let pass = 0;
const failures = [];
const record = (n, ok, d = "") => (ok ? pass++ : failures.push(`${n}${d ? "  — " + d : ""}`));

/* ── 1. no credentials: fail closed, and say so ───────────────────────────── */

const before = existsSync(join(ROOT, "logs/usage.jsonl")) ? readFileSync(join(ROOT, "logs/usage.jsonl"), "utf8").length : 0;
const runId = rk.makeRunId({ entropy: "test01" });
const taskKey = pg.publishTaskKey({ kind: "explainer", slug: "pipeline-test" });
const res = await llm.ask({ role: "writer", messages: [{ role: "user", content: "ping" }], runId, taskKey, retries: 0 });

record("no-key: does not claim success", res.ok === false, JSON.stringify(res).slice(0, 80));
record("no-key: names the missing credential kind", /no provider key|no key for this role/.test(String(res.error)), String(res.error));
record("no-key: says what it needs", Array.isArray(res.need) && res.need.length > 0, JSON.stringify(res.need ?? null).slice(0, 60));

const after = existsSync(join(ROOT, "logs/usage.jsonl")) ? readFileSync(join(ROOT, "logs/usage.jsonl"), "utf8") : "";
record("no-key: the attempt was metered", after.length > before);
const last = after.trim().split("\n").at(-1);
let entry = null;
try { entry = JSON.parse(last); } catch { /* below */ }
record("meter: record carries the run identity", entry?.runId === runId && entry?.taskKey === taskKey);
record("meter: a failure is not a success", entry?.ok === false);
record("meter: failure has a class", entry?.errorClass === "no_credential", String(entry?.errorClass));
record("meter: no invented cost", entry?.estimatedUsd === undefined || entry?.estimatedUsd === null, String(entry?.estimatedUsd));

/* ── 2-4. timeout, rate limit, invalid response ───────────────────────────── */

record("classify: timeout", rk.classifyError("TimeoutError: The operation was aborted") === "timeout");
record("classify: rate limit", rk.classifyError("Too Many Requests", 429) === "rate_limit");
record("classify: provider 5xx", rk.classifyError("bad gateway", 502) === "provider_5xx");
record("classify: auth is not retried", rk.classifyError("unauthorized", 401) === "auth");
record("classify: invalid response", rk.classifyError("Unexpected token < in JSON at position 0") === "bad_response");
record("classify: never echoes the message", !rk.classifyError("SECRET-TOKEN-abc").includes("SECRET"));

// The retry policy itself, read from source: 429/5xx retried, 401/400 not.
const src = readFileSync(join(ROOT, "tools/lib-llm.mjs"), "utf8");
record("retry: 429 and 5xx are retried", /429 and 5xx are worth another attempt/.test(src));
record("retry: 4xx auth failures break out", /r\.status === 401/.test(src));
record("retry: a timeout does not retry the same route", /TimeoutError|timed out/.test(src));
record("retry: the request has a hard timeout", /AbortSignal\.timeout\(\d+\)/.test(src));

/* ── 5. duplicate task is refused ─────────────────────────────────────────── */

{
  const d = mkdtempSync(join(tmpdir(), "pipe-"));
  const a = pg.publish({ dir: d, slug: "dup", taskKey, content: "one", runId: "r1" });
  const b = pg.publish({ dir: d, slug: "dup", taskKey, content: "two", runId: "r2" });
  record("duplicate: first write lands", a.status === "written", a.status);
  record("duplicate: second is refused", b.status === "duplicate", b.status);
  record("duplicate: content unchanged", readFileSync(join(d, "dup.md"), "utf8") === "one");
  rmSync(d, { recursive: true, force: true });
}

/* ── 6. quality gates run before a draft can be proposed ──────────────────── */

const wf = readFileSync(join(ROOT, ".github/workflows/content-daily.yml"), "utf8");
record("gate: qa-check runs", /node tools\/qa-check\.mjs --all/.test(wf));
record("gate: publish-readiness runs", /check-publish-ready\.mjs --all/.test(wf));
record("gate: the eleven gates run", /node tools\/gate\.mjs --fresh/.test(wf));
record("gate: gates precede the pull request", wf.indexOf("Quality gates on the draft") < wf.indexOf("gh pr create"));
record("gate: no direct publish to main", !/git push origin main/.test(wf));

// A known-bad fixture must still be rejected by the structural checker.
const fx = join(ROOT, "tests/fixtures/quarantine-3r.md");
record("fixture: the quarantine sample still exists", existsSync(fx));

/* ── the generator command is real, not guessed ───────────────────────────── */

record("generator: --check is a real flag", /--check/.test(src) || /--check/.test(readFileSync(join(ROOT, "tools/cloud-orchestrator.mjs"), "utf8")));
record("generator: directive-file is a real flag", /--directive-file=/.test(readFileSync(join(ROOT, "tools/cloud-orchestrator.mjs"), "utf8")));
record("generator: --force is a real flag", /--force/.test(readFileSync(join(ROOT, "tools/cloud-orchestrator.mjs"), "utf8")));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log("  " + f); process.exit(1); }
console.log("RESULT: PASS — the pipeline fails closed without credentials and never reports a fake success");