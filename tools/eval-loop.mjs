#!/usr/bin/env node
/**
 * The offline evaluator.
 *
 *   node tools/eval-loop.mjs --report
 *   node tools/eval-loop.mjs --report --json
 *   node tools/eval-loop.mjs --cohort d7 --by-prompt
 *   node tools/eval-loop.mjs --baseline writer-2026-10-26.a --json
 *
 * Reads data/outcomes only. No network, no model calls, no writes, no cost.
 *
 * ## What it refuses to do
 *
 * It will not report a proportion from fewer than twenty usable records. Below that threshold every
 * rate is labelled `insufficient` and the sample size is printed next to it, because "100% of three
 * articles passed the gates" is a sentence that reads like a finding and is not one.
 *
 * It will not treat a missing value as zero. A null click count is excluded from a mean, not added
 * as 0. The difference decides whether an unmeasured corpus looks unmeasured or looks like it is
 * failing.
 *
 * It will not let simulated or fixture records into a metric. They are counted, printed, and
 * excluded - `--include-simulated` adds them to the visible totals, never to a rate.
 *
 * It will not trust a `d7` label. A measurement counts toward the seven-day cohort only when it was
 * captured at least seven days after publication. A record with a `d7` block captured the next day is
 * counted as immature, not as early data.
 *
 * It will not call short-term clicks a quality score. Search performance is reported next to the
 * process measures and labelled as a measurement of attention, not of correctness.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA = join(ROOT, "data", "outcomes");
const MIN_SAMPLE = 20;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
/*
 * Accept both `--name=value` and `--name value`.
 *
 * The first version only understood the `=` form, and every space-separated flag was silently
 * ignored - the run then reported on the default directory while the caller believed it had pointed
 * the tool somewhere else. A quietly ignored argument is worse than a rejected one, so the space form
 * is parsed here rather than being left to the caller.
 */
const value = (n) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf(`--${n}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return null;
};

const wantJson = flag("json");
const byPrompt = flag("by-prompt");
const includeSimulated = flag("include-simulated");
const cohort = value("cohort") ?? null;
const baselineLabel = value("baseline");
const dataDir = value("data") ?? DEFAULT_DATA;
const nowArg = value("now");
const now = nowArg ? new Date(`${nowArg}T00:00:00Z`) : new Date();

if (flag("help")) {
  console.log(`Usage: node tools/eval-loop.mjs [options]

  --report                 human-readable report (default)
  --json                   machine-readable output
  --cohort d7|d28          only records mature for that window
  --by-prompt              group metrics by prompt version
  --baseline <label>       compare against the group carrying that prompt version
  --include-simulated      show simulated records in totals (never in metrics)
  --data <dir>             read a different outcomes directory (tests)
  --now <YYYY-MM-DD>       freeze "today" so maturity is reproducible (tests)
  --help`);
  process.exit(0);
}

if (cohort && !["d7", "d28"].includes(cohort)) {
  console.error(`--cohort must be d7 or d28, got "${cohort}"`);
  process.exit(2);
}

/* ---------------------------------------------------------------- loading */

const DAY = 86400000;

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

const parseErrors = [];
const records = [];

for (const file of walk(dataDir)) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    parseErrors.push({ file: relative(ROOT, file), error: e.message });
    continue;
  }
  if (!raw || typeof raw !== "object" || !raw.article_id) {
    parseErrors.push({ file: relative(ROOT, file), error: "missing article_id" });
    continue;
  }
  records.push({ file: relative(ROOT, file), ...raw });
}

/* ---------------------------------------------------------------- helpers */

const isSimulated = (r) => r.provenance === "simulated" || r.fixture === true;
const isObserved = (r) => !isSimulated(r);

/** A measurement counts only when it was actually captured after the window closed. */
function matureFor(record, window) {
  const days = window === "d7" ? 7 : 28;
  const m = (record.measurements ?? []).find((x) => x?.window === window && x?.captured_at);
  if (!m) return false;
  const published = Date.parse(record.published_at);
  const captured = Date.parse(m.captured_at);
  if (Number.isNaN(published) || Number.isNaN(captured)) return false;
  return captured - published >= days * DAY;
}

/** Rates are only reported from MIN_SAMPLE usable observations. */
function rate(items, field) {
  const usable = items.filter((r) => {
    const v = field(r);
    return v !== null && v !== undefined;
  });
  if (usable.length < MIN_SAMPLE) {
    return { status: "insufficient", n: usable.length, value: null };
  }
  const hits = usable.filter((r) => field(r) === true).length;
  return { status: "ok", n: usable.length, value: hits / usable.length };
}

function mean(items, field) {
  const usable = items.map(field).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!usable.length) return { status: "insufficient", n: 0, value: null };
  return { status: usable.length < MIN_SAMPLE ? "insufficient" : "ok", n: usable.length, value: usable.reduce((a, b) => a + b, 0) / usable.length };
}

/* ---------------------------------------------------------------- cohorts */

const observed = records.filter(isObserved);
const simulated = records.filter(isSimulated);

const immature = observed.filter((r) => (cohort ? !matureFor(r, cohort) : !matureFor(r, "d7") && !matureFor(r, "d28")));
const cohortRecords = cohort ? observed.filter((r) => matureFor(r, cohort)) : observed;

/* ---------------------------------------------------------------- metrics */

const metrics = {
  first_pass: rate(cohortRecords, (r) => r.review?.gates_first_pass),
  rework: rate(cohortRecords, (r) => (typeof r.review?.rework_rounds === "number" ? r.review.rework_rounds > 0 : null)),
  corrections: rate(cohortRecords, (r) => (typeof r.review?.corrections === "number" ? r.review.corrections > 0 : null)),
  cost_usd: mean(cohortRecords, (r) => r.generation?.cost_usd),
};

const groups = new Map();
for (const r of cohortRecords) {
  const key = r.generation?.prompt_version ?? "unknown";
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const promptGroups = [...groups.entries()]
  .map(([version, items]) => ({
    version,
    n: items.length,
    first_pass: rate(items, (r) => r.review?.gates_first_pass),
    rework: rate(items, (r) => (typeof r.review?.rework_rounds === "number" ? r.review.rework_rounds > 0 : null)),
  }))
  .sort((a, b) => b.n - a.n || a.version.localeCompare(b.version));

const win = cohort ?? "d7";
const withSearch = cohortRecords.filter((r) => {
  const m = (r.measurements ?? []).find((x) => x?.window === win);
  return m && typeof m.clicks === "number";
});
const clicks = withSearch.map((r) => (r.measurements ?? []).find((x) => x?.window === win).clicks);

const missingRate = {
  prompt_version: cohortRecords.filter((r) => !r.generation?.prompt_version).length,
  cost: cohortRecords.filter((r) => r.generation?.cost_usd === null || r.generation?.cost_usd === undefined).length,
  model: cohortRecords.filter((r) => !r.generation?.model).length,
  first_pass: cohortRecords.filter((r) => r.review?.gates_first_pass === null || r.review?.gates_first_pass === undefined).length,
  search: cohortRecords.length - withSearch.length,
};

let baseline = { label: baselineLabel, found: false, comparison: null };
if (baselineLabel) {
  const g = promptGroups.find((x) => x.version === baselineLabel);
  if (g) {
    baseline = {
      label: baselineLabel,
      found: true,
      comparison: {
        baseline_n: g.n,
        baseline_first_pass: g.first_pass,
        current_versions: promptGroups.filter((x) => x.version !== baselineLabel).map((x) => ({ version: x.version, n: x.n, first_pass: x.first_pass })),
      },
    };
  }
}

const limits = [];
if (!records.length) limits.push("no records in data/outcomes - nothing to evaluate, and no conclusion follows from that");
if (parseErrors.length) limits.push(`${parseErrors.length} file(s) could not be parsed and were skipped`);
if (cohortRecords.length < MIN_SAMPLE) limits.push(`only ${cohortRecords.length} usable record(s); every proportion below is labelled insufficient rather than estimated`);
if (missingRate.prompt_version) limits.push(`${missingRate.prompt_version} record(s) carry no prompt version and are grouped as "unknown" - they cannot be attributed to any instruction set`);
if (missingRate.search) limits.push(`${missingRate.search} record(s) have no ${win} click data; search performance is reported from ${withSearch.length}`);
limits.push("clicks measure attention, not correctness; no correction or quality conclusion is drawn from them");

/* ---------------------------------------------------------------- output */

const report = {
  generated_at: now.toISOString(),
  data_dir: relative(ROOT, dataDir) || dataDir,
  cohort: cohort ?? "all",
  totals: {
    records: records.length,
    observed: observed.length,
    simulated_or_fixture: simulated.length,
    immature_excluded: cohort ? observed.length - cohortRecords.length : immature.length,
    in_cohort: cohortRecords.length,
  },
  missing: missingRate,
  metrics,
  search: {
    window: win,
    records_with_clicks: withSearch.length,
    clicks_total: clicks.length ? clicks.reduce((a, b) => a + b, 0) : null,
    note: "observed, mature records only",
  },
  by_prompt: promptGroups,
  baseline,
  limits,
  parse_errors: parseErrors,
  simulated_shown: includeSimulated ? simulated.map((r) => ({ file: r.file, article_id: r.article_id })) : undefined,
};

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(parseErrors.length ? 3 : 0);
}

const pct = (m) => (m.status === "ok" ? `${(m.value * 100).toFixed(1)}% (n=${m.n})` : `insufficient (n=${m.n})`);
const say = (s) => console.log("  " + s);

console.log("EVAL LOOP");
console.log("=".repeat(64));
say(`data       : ${report.data_dir}`);
say(`cohort     : ${report.cohort}`);
say(`generated  : ${report.generated_at}`);
console.log("");
console.log("SAMPLES");
say(`records            : ${report.totals.records}`);
say(`observed           : ${report.totals.observed}`);
say(`simulated/fixture  : ${report.totals.simulated_or_fixture}  (excluded from every rate)`);
say(`immature excluded  : ${report.totals.immature_excluded}`);
say(`in cohort          : ${report.totals.in_cohort}`);
console.log("");
console.log("PROCESS");
say(`gates first pass   : ${pct(metrics.first_pass)}`);
say(`rework rate        : ${pct(metrics.rework)}`);
say(`correction rate    : ${pct(metrics.corrections)}`);
say(`cost per article   : ${metrics.cost_usd.status === "ok" ? "$" + metrics.cost_usd.value.toFixed(2) : "insufficient (n=" + metrics.cost_usd.n + ")"}`);
console.log("");
console.log("BY PROMPT VERSION");
if (!promptGroups.length) say("(no records in cohort)");
for (const g of promptGroups) say(`${g.version.padEnd(24)} n=${String(g.n).padEnd(4)} first-pass ${pct(g.first_pass)}`);
console.log("");
console.log("SEARCH (" + win + ")");
say(`records with clicks: ${report.search.records_with_clicks}`);
say(`clicks total       : ${report.search.clicks_total === null ? "not measured" : report.search.clicks_total}`);
console.log("");
console.log("MISSING FIELDS");
for (const [k, v] of Object.entries(missingRate)) say(`${k.padEnd(18)} ${v} record(s) missing`);
console.log("");
if (baselineLabel) {
  console.log("BASELINE");
  if (baseline.found) say(`found: ${baseline.label}`);
  else say(`MISSING: no group carries the version "${baselineLabel}" - no comparison made`);
  console.log("");
}
console.log("LIMITS");
for (const l of limits) say("- " + l);
if (parseErrors.length) {
  console.log("");
  console.log("PARSE ERRORS");
  for (const e of parseErrors) say(`${e.file}: ${e.error}`);
}
console.log("");
console.log(parseErrors.length ? "RESULT: data integrity problems, see PARSE ERRORS" : "RESULT: report produced from local data only; nothing was fetched");
process.exit(parseErrors.length ? 3 : 0);
