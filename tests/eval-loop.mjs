#!/usr/bin/env node
/**
 * Tests for tools/eval-loop.mjs and PROMPT_VERSION.
 *
 * The evaluator is the instrument everything else will be judged with, so the properties that matter
 * are the refusals: it must not count simulated records, must not read a mislabelled d7 block as
 * mature data, must not turn a null into a zero, and must say `insufficient` rather than print a
 * proportion from three records. Each of those is a case below.
 *
 * Runs offline. Exits non-zero on the first failure set.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const TOOL = join(ROOT, "tools", "eval-loop.mjs");

let pass = 0;
const failures = [];
function record(name, ok, detail = "") {
  if (ok) { pass++; }
  else failures.push(`${name}${detail ? "  — " + detail : ""}`);
}

/** Run the tool against a throwaway outcomes directory. */
function run(records, argv = [], opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "eval-"));
  for (const [name, body] of Object.entries(records)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  const args = [TOOL, "--data", dir, "--now", opts.now ?? "2026-12-31", ...argv];
  const out = spawnSync(process.execPath, args, { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

const mk = (over = {}) => ({
  article_id: "a-" + Math.random().toString(36).slice(2, 8),
  locale: "en",
  published_at: "2026-01-01",
  provenance: "observed",
  fixture: false,
  decision: {},
  generation: { prompt_version: "writer-2026-10-26.a", model: "m", generated_at: "2026-01-01", cost_usd: null },
  review: { gates_first_pass: true, rework_rounds: 0, corrections: 0 },
  measurements: [
    { window: "d7", captured_at: "2026-01-09", clicks: 10, impressions: 100, ctr: 0.1, position: 5, source: "gsc" },
    { window: "d28", captured_at: "2026-02-01", clicks: 40, impressions: 500, ctr: 0.08, position: 4, source: "gsc" },
  ],
  ...over,
});

/* ── the version constant ─────────────────────────────────────────────────── */

const promptMod = await import(new URL("../src/lib/writer-prompt.mjs", import.meta.url).href);
record("version: exported", typeof promptMod.PROMPT_VERSION === "string");
record("version: shape", promptMod.PROMPT_VERSION_PATTERN.test(promptMod.PROMPT_VERSION), promptMod.PROMPT_VERSION);
record("version: pattern rejects a bare date", !promptMod.PROMPT_VERSION_PATTERN.test("2026-10-26"));
record("version: pattern rejects a missing revision", !promptMod.PROMPT_VERSION_PATTERN.test("writer-2026-10-26"));

/* ── empty data ───────────────────────────────────────────────────────────── */

{
  const { code, stdout } = run({});
  record("empty: exits 0", code === 0, `code=${code}`);
  record("empty: says nothing to evaluate", /no records in data\/outcomes/.test(stdout));
  record("empty: no proportion printed", !/first pass\s+:\s+\d/.test(stdout));
}

/* ── simulated and fixture records never enter a metric ───────────────────── */

{
  const dirRecords = {};
  for (let i = 0; i < 25; i++) dirRecords[`obs-${i}.json`] = mk({ article_id: `obs-${i}` });
  dirRecords["sim-1.json"] = mk({ article_id: "sim-1", provenance: "simulated" });
  dirRecords["fix-1.json"] = mk({ article_id: "fix-1", fixture: true });
  const { code, stdout } = run(dirRecords);
  record("simulated: exits 0", code === 0);
  record("simulated: counted separately", /simulated\/fixture\s+:\s+2/.test(stdout), stdout.match(/simulated\/fixture\s+:\s+\d+/)?.[0]);
  record("simulated: 25 observed in cohort", /in cohort\s+:\s+25/.test(stdout));
}

/* ── null is not zero ─────────────────────────────────────────────────────── */

{
  const recs = {};
  for (let i = 0; i < 21; i++) {
    recs[`n-${i}.json`] = mk({
      article_id: `n-${i}`,
      measurements: [
        { window: "d7", captured_at: "2026-01-09", clicks: null, impressions: null, ctr: null, position: null, source: null },
        { window: "d28", captured_at: "2026-02-01", clicks: null, impressions: null, ctr: null, position: null, source: null },
      ],
    });
  }
  const { stdout } = run(recs);
  record("nulls: clicks reported as not measured", /clicks total\s+:\s+not measured/.test(stdout));
  record("nulls: search coverage zero", /records with clicks:\s+0/.test(stdout));
}

/* ── maturity is computed from dates, not labels ──────────────────────────── */

{
  const fresh = mk({ article_id: "fresh", published_at: "2026-12-30", measurements: [{ window: "d7", captured_at: "2026-12-31", clicks: 5, impressions: 9, ctr: 0.5, position: 1, source: "gsc" }] });
  const { stdout } = run({ "fresh.json": fresh }, ["--cohort", "d7"]);
  record("maturity: a d7 block captured next day is excluded", /in cohort\s+:\s+0/.test(stdout));
  record("maturity: the exclusion is counted", /immature excluded\s+:\s+1/.test(stdout));

  const old = mk({ article_id: "old" });
  const r2 = run({ "old.json": old }, ["--cohort", "d7"]);
  record("maturity: a genuine d7 record is included", /in cohort\s+:\s+1/.test(r2.stdout));
}

/* ── insufficient samples ─────────────────────────────────────────────────── */

{
  const recs = {};
  for (let i = 0; i < 3; i++) recs[`s-${i}.json`] = mk({ article_id: `s-${i}` });
  const { stdout } = run(recs);
  record("sample: 3 records produce insufficient", /gates first pass\s+:\s+insufficient \(n=3\)/.test(stdout));
  record("sample: the count is printed", /only 3 usable record/.test(stdout));
}

/* ── a real sample produces a proportion ──────────────────────────────────── */

{
  const recs = {};
  for (let i = 0; i < 25; i++) {
    recs[`p-${i}.json`] = mk({ article_id: `p-${i}`, review: { gates_first_pass: i < 20, rework_rounds: i % 5 === 0 ? 1 : 0, corrections: 0 } });
  }
  const { stdout } = run(recs);
  record("sample: 25 records produce 80.0%", /gates first pass\s+:\s+80\.0% \(n=25\)/.test(stdout), stdout.match(/gates first pass\s+:\s+\S+/)?.[0]);
}

/* ── missing prompt version is grouped as unknown ─────────────────────────── */

{
  const recs = { "u1.json": mk({ article_id: "u1", generation: { prompt_version: null } }) };
  const { stdout } = run(recs, ["--by-prompt"]);
  record("version: missing grouped as unknown", /unknown\s+n=1/.test(stdout));
  record("version: missing is reported", /carry no prompt version/.test(stdout));
}

/* ── baseline ─────────────────────────────────────────────────────────────── */

{
  const recs = { "b1.json": mk({ article_id: "b1" }) };
  const missing = run(recs, ["--baseline", "writer-1999-01-01.a"]);
  record("baseline: missing label reported", /MISSING: no group carries/.test(missing.stdout));
  const found = run(recs, ["--baseline", "writer-2026-10-26.a"]);
  record("baseline: existing label found", /found: writer-2026-10-26\.a/.test(found.stdout));
}

/* ── JSON output ──────────────────────────────────────────────────────────── */

{
  const { code, stdout } = run({ "j1.json": mk({ article_id: "j1" }) }, ["--json"]);
  record("json: exits 0", code === 0);
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* handled below */ }
  record("json: parses", parsed !== null);
  record("json: carries totals", parsed?.totals?.records === 1);
  record("json: carries limits", Array.isArray(parsed?.limits) && parsed.limits.length > 0);
  record("json: labels the cohort", parsed?.cohort === "all");
}

/* ── corrupt input is surfaced, not silently skipped ──────────────────────── */

{
  const { code, stdout } = run({ "broken.json": "{ not json" });
  record("corrupt: non-zero exit", code === 3, `code=${code}`);
  record("corrupt: reported", /could not be parsed/.test(stdout));
}

/* ── no network, ever ─────────────────────────────────────────────────────── */

{
  const src = readFileSync(TOOL, "utf8");
  record("offline: no fetch", !/\bfetch\(/.test(src));
  record("offline: no http import", !/node:https?/.test(src));
}

/* ── the real corpus ──────────────────────────────────────────────────────── */

{
  const out = spawnSync(process.execPath, [TOOL, "--report"], { encoding: "utf8" });
  record("real corpus: runs", out.status === 0, `code=${out.status}`);
  record("real corpus: reports observed records", /observed\s+:\s+\d+/.test(out.stdout));
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("RESULT: PASS - evaluator refuses simulated data, immature windows and tiny samples");
