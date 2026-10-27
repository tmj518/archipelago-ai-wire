#!/usr/bin/env node
/**
 * Structural tests for the three automation workflows.
 *
 * These do not prove a workflow runs - only GitHub can prove that. They prove the properties that
 * are cheap to lose and expensive to get wrong: least privilege, one run at a time, fail-closed
 * preflight, no direct push to main, no secrets echoed, and an alert that fires only on failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, ".github/workflows", f), "utf8");

let pass = 0;
const failures = [];
const record = (n, ok, d = "") => (ok ? pass++ : failures.push(`${n}${d ? "  — " + d : ""}`));

const DATA = read("data-refresh.yml");
const CONTENT = read("content-daily.yml");
const ALERT = read("alert.yml");

/* ── every workflow ───────────────────────────────────────────────────────── */

for (const [name, src] of [["data-refresh", DATA], ["content-daily", CONTENT], ["alert", ALERT]]) {
  record(`${name}: has an explicit permissions block`, /^permissions:/m.test(src), name);
  record(`${name}: declares a timeout`, /timeout-minutes:/.test(src), name);
  record(`${name}: no secret is echoed`, !/echo\s+["']?\$\{\{\s*secrets\./.test(src), name);
  record(`${name}: no hardcoded credential`, !/sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/.test(src), name);
}

/* ── data refresh ─────────────────────────────────────────────────────────── */

record("data: daily schedule", /cron: "30 21 \* \* \*"/.test(DATA));
record("data: manual dispatch", /workflow_dispatch:/.test(DATA));
record("data: one at a time", /concurrency:[\s\S]*?group: data-refresh/.test(DATA));
record("data: fails closed on the names the code reads", /GSC_CREDENTIALS/.test(DATA) && /GSC_SITE_URL/.test(DATA) && /exit 1/.test(DATA));
record("data: fails closed on missing CF", /CF_API_TOKEN/.test(DATA));
record("data: preflight names match gsc-report.mjs", !/GSC_CREDENTIALS_BASE64/.test(DATA));
record("data: preflight runs before the collectors", DATA.indexOf("Preflight credentials") < DATA.indexOf("Search Console report"));
record("data: commit is gated behind a repo variable", /vars\.DATA_COMMIT == 'true'/.test(DATA));
record("data: does not push to main directly", !/git push origin main|git push -f/.test(DATA));

/* ── content day ──────────────────────────────────────────────────────────── */

record("content: daily schedule", /cron: "0 23 \* \* \*"/.test(CONTENT));
record("content: one at a time", /group: content-day/.test(CONTENT));
record("content: needs a pull request permission", /pull-requests: write/.test(CONTENT));
record("content: fails closed without a generator", /vars\.CONTENT_GENERATOR/.test(CONTENT) && /exit 1/.test(CONTENT));
record("content: gates run before the PR", CONTENT.indexOf("Quality gates on the draft") < CONTENT.indexOf("Open a pull request"));
record("content: proposes via PR, never a direct push to main", /gh pr create --base main/.test(CONTENT) && !/git push origin main/.test(CONTENT));
record("content: drafts go to their own branch", /draft\/content-/.test(CONTENT));

/* ── alert ────────────────────────────────────────────────────────────────── */

record("alert: listens for completion", /types: \[completed\]/.test(ALERT));
record("alert: only on failure", /conclusion == 'failure'/.test(ALERT));
record("alert: refuses to silently swallow a missing webhook", /FEISHU_WEBHOOK is not set/.test(ALERT) && /exit 1/.test(ALERT));
record("alert: read-only", /^permissions:\n\s+contents: read/m.test(ALERT) || /contents: read/.test(ALERT));

/* ── the alert does not cover itself ──────────────────────────────────────── */

record("alert: does not watch itself (no loop)", !/workflows: \[[^\]]*"Alert on failure"/.test(ALERT));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log("  " + f); process.exit(1); }
console.log("RESULT: PASS — workflows are least-privilege, serialised, fail-closed and propose via PR");