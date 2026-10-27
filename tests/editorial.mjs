#!/usr/bin/env node
/**
 * Tests for `tools/eval-loop.mjs --editorial`.
 *
 * The properties worth testing are the refusals, because the arithmetic is trivial and the honesty is
 * not: a null score is not a zero, a fixture is not a review, one reviewer cannot produce an
 * agreement figure, and an unpaired re-score is not an improvement.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const TOOL = join(ROOT, "tools", "eval-loop.mjs");

let pass = 0;
const failures = [];
const record = (name, ok, detail = "") => (ok ? pass++ : failures.push(`${name}${detail ? "  — " + detail : ""}`));

function run(reviews, argv = []) {
  const dir = mkdtempSync(join(tmpdir(), "rev-"));
  for (const [name, body] of Object.entries(reviews)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  const out = spawnSync(process.execPath, [TOOL, "--editorial", "--reviews", dir, "--now", "2026-12-31", ...argv], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

let n = 0;
const mk = (over = {}) => ({
  review_id: `rev-${++n}`,
  article_id: "a1",
  locale: "en",
  reviewer_id: "r-a",
  reviewed_at: "2026-10-27",
  prompt_version: "writer-2026-10-26.a",
  review_type: "blind",
  provenance: "observed",
  fixture: false,
  scores: { conclusion: 3, sourcing: 2, mechanism: 2, malaysia_impact: 2, uncertainty: 2, actionability: 2 },
  na: {},
  red_lines: { unsourced_key_fact: false, unverifiable_number: false, fabricated_interview: false, prediction_as_fact: false, stale_source: false },
  red_line_notes: [],
  issues: [],
  revision: { before: null, after: null, revised_at: null },
  blind_to: ["prompt_version", "model", "traffic", "other_reviews"],
  ...over,
});

/* ── empty ────────────────────────────────────────────────────────────────── */

{
  const { code, stdout } = run({});
  record("empty: exits 0", code === 0, `code=${code}`);
  record("empty: says nothing to evaluate", /no review records/.test(stdout));
  record("empty: no mean printed", !/conclusion\s+\d\.\d/.test(stdout));
}

/* ── simulated and fixture are excluded ───────────────────────────────────── */

{
  const recs = { "a.json": mk({ provenance: "simulated" }), "b.json": mk({ fixture: true }) };
  const { stdout } = run(recs);
  record("excluded: counted", /simulated\/fixture\s+:\s+2/.test(stdout));
  record("excluded: observed is zero", /observed\s+:\s+0/.test(stdout));
  record("excluded: criteria insufficient", /conclusion\s+insufficient/.test(stdout));
}

/* ── null is not zero, and N/A keeps its reason ───────────────────────────── */

{
  const recs = {
    "a.json": mk({ scores: { conclusion: 3, sourcing: null, mechanism: 2, malaysia_impact: 2, uncertainty: 2, actionability: null }, na: { sourcing: "document not available to reviewer", actionability: "explanatory piece" } }),
  };
  const { stdout } = run(recs);
  record("null: sourcing n=0 not averaged as 0", /sourcing\s+insufficient \(n=0/.test(stdout), stdout.match(/sourcing[^\n]*/)?.[0]);
  record("null: conclusion counted", /conclusion\s+insufficient \(n=1/.test(stdout));
  record("na: reasons counted", /N\/A with reason\s+:\s+2/.test(stdout));
}

/* ── red lines ────────────────────────────────────────────────────────────── */

{
  const recs = {
    "a.json": mk({ red_lines: { unsourced_key_fact: true, unverifiable_number: false, fabricated_interview: false, prediction_as_fact: false, stale_source: false } }),
    "b.json": mk({ red_lines: { unsourced_key_fact: false, unverifiable_number: true, fabricated_interview: false, prediction_as_fact: true, stale_source: false } }),
  };
  const { stdout } = run(recs);
  record("red line: total counted", /triggered\s+:\s+3/.test(stdout), stdout.match(/triggered[^\n]*/)?.[0]);
  record("red line: by type listed", /unsourced_key_fact\s+1/.test(stdout) && /prediction_as_fact\s+1/.test(stdout));
}

/* ── one reviewer cannot produce agreement ────────────────────────────────── */

{
  const recs = { "a.json": mk({ article_id: "x" }), "b.json": mk({ article_id: "x" }) };
  const { stdout } = run(recs);
  record("reviewers: single reviewer not computed", /not computed: no article has two reviews/.test(stdout));
  record("reviewers: no agreement number invented", !/mean absolute difference:\s+\d/.test(stdout));
}

/* ── two reviewers do produce it ──────────────────────────────────────────── */

{
  const recs = {
    "a.json": mk({ article_id: "x", reviewer_id: "r-a", scores: { conclusion: 3, sourcing: 2, mechanism: 2, malaysia_impact: 2, uncertainty: 2, actionability: 2 } }),
    "b.json": mk({ article_id: "x", reviewer_id: "r-b", scores: { conclusion: 1, sourcing: 2, mechanism: 2, malaysia_impact: 2, uncertainty: 2, actionability: 2 } }),
  };
  const { stdout } = run(recs);
  record("reviewers: two reviewers computed", /articles with 2\+ reviewers: 1/.test(stdout), stdout.match(/articles with[^\n]*/)?.[0]);
}

/* ── revision needs a pair ────────────────────────────────────────────────── */

{
  const noPair = run({ "a.json": mk() });
  record("revision: absent pair not computed", /not computed: no review carries both/.test(noPair.stdout));

  const paired = run({ "a.json": mk({ revision: { before: { conclusion: 1 }, after: { conclusion: 3 }, revised_at: "2026-11-01" } }) });
  record("revision: paired record accepted", /paired reviews: 1/.test(paired.stdout), paired.stdout.match(/paired reviews[^\n]*/)?.[0]);
}

/* ── small sample ─────────────────────────────────────────────────────────── */

{
  const recs = {};
  for (let i = 0; i < 3; i++) recs[`r${i}.json`] = mk({ article_id: `a${i}` });
  const { stdout } = run(recs);
  record("sample: 3 reviews are insufficient", /only 3 usable review/.test(stdout));
  record("sample: n printed next to the label", /conclusion\s+insufficient \(n=3/.test(stdout));
}

/* ── twenty is enough for a mean ──────────────────────────────────────────── */

{
  const recs = {};
  for (let i = 0; i < 20; i++) recs[`r${i}.json`] = mk({ article_id: `a${i}` });
  const { stdout } = run(recs);
  record("sample: 20 reviews give a mean", /conclusion\s+3\.00 \(n=20/.test(stdout), stdout.match(/conclusion[^\n]*/)?.[0]);
}

/* ── blind reviews that do not withhold are suspect ───────────────────────── */

{
  const recs = { "a.json": mk({ blind_to: ["prompt_version"] }) };
  const { stdout } = run(recs);
  record("blind: incomplete blind_to flagged", /do not list all four withheld fields/.test(stdout));
}

/* ── JSON output ──────────────────────────────────────────────────────────── */

{
  const { code, stdout } = run({ "a.json": mk() }, ["--json"]);
  record("json: exits 0", code === 0, `code=${code}`);
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* below */ }
  record("json: parses", parsed !== null);
  record("json: carries criteria", typeof parsed?.criteria?.conclusion?.n === "number");
  record("json: carries red lines", typeof parsed?.red_lines?.triggered === "number");
  record("json: never a single total", !("score" in (parsed ?? {})) && !("total_score" in (parsed ?? {})));
}

/* ── corrupt record surfaces, does not vanish ─────────────────────────────── */

{
  const { code, stdout } = run({ "bad.json": "{ nope" });
  record("corrupt: non-zero exit", code === 3, `code=${code}`);
  record("corrupt: reported", /could not be parsed/.test(stdout));
}

/* ── the performance mode still works ─────────────────────────────────────── */

{
  const perf = spawnSync(process.execPath, [TOOL, "--report", "--json"], { encoding: "utf8" });
  record("compat: --report still runs", perf.status === 0, `code=${perf.status}`);
  let ok = false;
  try { const p = JSON.parse(perf.stdout); ok = typeof p?.totals?.records === "number"; } catch { /* below */ }
  record("compat: --report --json still parses", ok);
}

/* ── no network in the tool ───────────────────────────────────────────────── */

{
  const src = readFileSync(TOOL, "utf8");
  record("offline: no fetch", !/\bfetch\(/.test(src));
  record("offline: no http import", !/node:https?/.test(src));
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("RESULT: PASS — editorial mode refuses fixtures, nulls, single-reviewer agreement and unpaired deltas");
