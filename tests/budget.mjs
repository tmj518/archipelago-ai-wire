#!/usr/bin/env node
/**
 * The spend ceiling.
 *
 * `AGENT_USD_LIMIT` was read only by tools/agent-run.mjs for most of this project, so the path that
 * actually runs in CI - cloud-orchestrator -> lib-llm -> ask() - had no ceiling at all. These tests
 * pin the behaviour that matters: the decision happens before a request, an unreadable meter does
 * not open the ceiling, and a refused call makes zero network calls.
 *
 * `globalThis.fetch` is replaced with a counter for the duration of the test, so "no request was
 * made" is measured rather than asserted from the code's shape.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const llm = await import(pathToFileURL(join(ROOT, "tools/lib-llm.mjs")).href);

let pass = 0;
const failures = [];
const record = (n, ok, d = "") => (ok ? pass++ : failures.push(`${n}${d ? "  — " + d : ""}`));

const logWith = (entries) => {
  const d = mkdtempSync(join(tmpdir(), "budget-"));
  const file = join(d, "usage.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return { dir: d, file };
};
const entry = (usd, at = "2026-10-27T10:00:00.000Z") => ({ at, ok: true, estimatedUsd: usd, promptTokens: 10, completionTokens: 5 });

/* ── the policy, in isolation ─────────────────────────────────────────────── */

record("policy: under budget allows", llm.budgetDecision(0.01, 0.06).allowed === true);
record("policy: exactly at budget refuses", llm.budgetDecision(0.06, 0.06).allowed === false);
record("policy: over budget refuses", llm.budgetDecision(0.2, 0.06).allowed === false);
record("policy: no limit configured allows", llm.budgetDecision(9, "").allowed === true);
record("policy: zero means no limit", llm.budgetDecision(9, 0).allowed === true);
record("policy: invalid text refuses", llm.budgetDecision(0, "abc").allowed === false);
record("policy: negative refuses", llm.budgetDecision(0, -1).allowed === false);
record("policy: NaN refuses", llm.budgetDecision(0, Number.NaN).allowed === false);

/* ── reading the meter ────────────────────────────────────────────────────── */

{
  const { dir, file } = logWith([entry(0.01), entry(0.02)]);
  const total = llm.spendToday(new Date("2026-10-27T23:00:00Z"), file);
  record("meter: sums today", Math.abs(total - 0.03) < 1e-9, String(total));
  record("meter: ignores other days", llm.spendToday(new Date("2026-10-28T01:00:00Z"), file) === 0);
  rmSync(dir, { recursive: true, force: true });
}

{
  const { dir, file } = logWith([entry(0.05), { at: "2026-10-27T10:00:00Z", ok: false }]);
  record("meter: a row without a cost adds nothing", Math.abs(llm.spendToday(new Date("2026-10-27T12:00:00Z"), file) - 0.05) < 1e-9);
  rmSync(dir, { recursive: true, force: true });
}

{
  const d = mkdtempSync(join(tmpdir(), "budget-"));
  const file = join(d, "usage.jsonl");
  writeFileSync(file, '{"at":"2026-10-27T10:00:00Z","estimatedUsd":0.02}\nnot json\n', "utf8");
  const total = llm.spendToday(new Date("2026-10-27T12:00:00Z"), file);
  record("meter: a corrupt line does not hide the rest", Math.abs(total - 0.02) < 1e-9, String(total));
  rmSync(d, { recursive: true, force: true });
}

{
  const d = mkdtempSync(join(tmpdir(), "budget-"));
  const missing = join(d, "absent.jsonl");
  record("meter: absent log reads as zero", llm.spendToday(new Date(), missing) === 0);
  // A directory where a file is expected cannot be read as a log.
  const asDir = join(d, "dir.jsonl");
  mkdirSync(asDir);
  const v = llm.spendToday(new Date(), asDir);
  record("meter: unreadable log means Infinity, so the ceiling stays shut", v === Number.POSITIVE_INFINITY, String(v));
  record("meter: Infinity refuses any finite limit", llm.budgetDecision(v, 1).allowed === false);
  rmSync(d, { recursive: true, force: true });
}

/* ── the real ask(), with the network replaced by a counter ───────────────── */

const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("the test must not reach the network"); };

const tmpLog = mkdtempSync(join(tmpdir(), "budget-ask-"));
const logFile = join(tmpLog, "usage.jsonl");

// Point the module's meter reader at a temp log by overriding the resolved path for this run.
process.env.AGENT_USD_LIMIT = "0.01";
writeFileSync(logFile, JSON.stringify(entry(0.02)) + "\n", "utf8");
process.env.AGENT_USAGE_LOG = logFile; // the meter the guard reads, isolated from the real log

const before = fetchCalls;
const res = await llm.ask({ role: "writer", messages: [{ role: "user", content: "ping" }], retries: 0 });
record("ask: refuses when over budget", res.ok === false, String(res.error));
record("ask: says it is a budget refusal", /spend limit|budget/i.test(String(res.error)), String(res.error));
record("ask: made ZERO network calls", fetchCalls === before, `${fetchCalls - before} calls`);

process.env.AGENT_USD_LIMIT = "abc";
const bad = await llm.ask({ role: "writer", messages: [{ role: "user", content: "ping" }], retries: 0 });
record("ask: invalid budget refuses", bad.ok === false && /invalid budget/i.test(String(bad.error)), String(bad.error));
record("ask: invalid budget also makes zero calls", fetchCalls === before);

delete process.env.AGENT_USD_LIMIT;
delete process.env.AGENT_USAGE_LOG;
globalThis.fetch = async () => { fetchCalls++; return { ok: false, status: 500, text: async () => "down" }; };
const noLimit = await llm.ask({ role: "writer", messages: [{ role: "user", content: "ping" }], retries: 0 });
record("ask: no budget configured does not block", !/budget/i.test(String(noLimit.error ?? "")), String(noLimit.error));
record("ask: without credentials no request is made anyway", fetchCalls === before, `${fetchCalls - before} calls`);

globalThis.fetch = realFetch;
rmSync(tmpLog, { recursive: true, force: true });
delete process.env.AGENT_USD_LIMIT;
delete process.env.AGENT_USAGE_LOG;

/* ── concurrency: the real limit of this design ───────────────────────────── */

record(
  "concurrency: the guard is a read-then-act check, not a lock (documented limit)",
  /not a hard cross-process cap/.test(
    (await import("node:fs")).readFileSync(join(ROOT, "tools/lib-llm.mjs"), "utf8")
  )
);

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log("  " + f); process.exit(1); }
console.log("RESULT: PASS — the ceiling is checked before any request, and a bad meter keeps it shut");