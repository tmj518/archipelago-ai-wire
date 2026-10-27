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

/* ---------------------------------------------------------------- editorial */

/*
 * --editorial reads data/reviews, not data/outcomes.
 *
 * A review is a judgement about a draft; an outcome is a measurement of a published piece. They are
 * reported side by side and never combined - no weighted total, no ranking. The same refusals apply
 * as in the performance report: simulated and fixture records are excluded from every metric, a null
 * score is excluded rather than counted as zero, and fewer than twenty usable observations prints
 * `insufficient` instead of a number that reads like a finding.
 */
const REVIEWS_DIR = value("reviews") ?? join(ROOT, "data", "reviews");
const CRITERIA = ["conclusion", "sourcing", "mechanism", "malaysia_impact", "uncertainty", "actionability"];
const RED_LINE_KEYS = ["unsourced_key_fact", "unverifiable_number", "fabricated_interview", "prediction_as_fact", "stale_source"];
const BLIND_REQUIRED = ["prompt_version", "model", "traffic", "other_reviews"];

function loadReviews() {
  const errors = [];
  const items = [];
  for (const file of walk(REVIEWS_DIR)) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      errors.push({ file: relative(ROOT, file), error: e.message });
      continue;
    }
    if (!raw?.review_id || !raw?.article_id) {
      errors.push({ file: relative(ROOT, file), error: "missing review_id or article_id" });
      continue;
    }
    items.push({ file: relative(ROOT, file), ...raw });
  }
  return { items, errors };
}

/** Mean over the non-null scores only; null is never 0. */
function scoreStats(records, criterion) {
  const values = records.map((r) => r.scores?.[criterion]).filter((v) => typeof v === "number");
  const missing = records.length - values.length;
  if (!values.length) return { n: 0, mean: null, status: "insufficient", missing };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { n: values.length, mean, status: values.length < MIN_SAMPLE ? "insufficient" : "ok", missing };
}

function editorialReport() {
  const { items, errors } = loadReviews();
  const observed = items.filter((r) => r.provenance !== "simulated" && r.fixture !== true);
  const excluded = items.length - observed.length;

  const criteria = {};
  for (const c of CRITERIA) criteria[c] = scoreStats(observed, c);

  const naReasons = observed.flatMap((r) => Object.entries(r.na ?? {}).map(([k, v]) => ({ review: r.review_id, criterion: k, reason: v })));

  const redLines = { triggered: 0, by_type: {}, articles: [] };
  for (const r of observed) {
    for (const k of RED_LINE_KEYS) {
      if (r.red_lines?.[k] === true) {
        redLines.triggered++;
        redLines.by_type[k] = (redLines.by_type[k] ?? 0) + 1;
        if (!redLines.articles.includes(r.article_id)) redLines.articles.push(r.article_id);
      }
    }
  }

  const suspectBlind = observed.filter(
    (r) => r.review_type === "blind" && !BLIND_REQUIRED.every((f) => (r.blind_to ?? []).includes(f)),
  );

  // Inter-reviewer agreement needs two reviewers on the same article. With one, say so.
  const byArticle = new Map();
  for (const r of observed) {
    if (!byArticle.has(r.article_id)) byArticle.set(r.article_id, []);
    byArticle.get(r.article_id).push(r);
  }
  const multi = [...byArticle.values()].filter((rs) => new Set(rs.map((r) => r.reviewer_id)).size >= 2);
  let interReviewer;
  if (!multi.length) {
    interReviewer = { status: "not_computed", pairs: 0, reason: "no article has two reviews from different reviewers" };
  } else {
    const diffs = [];
    for (const rs of multi) {
      for (const c of CRITERIA) {
        const vals = rs.map((r) => r.scores?.[c]).filter((v) => typeof v === "number");
        if (vals.length >= 2) diffs.push(Math.max(...vals) - Math.min(...vals));
      }
    }
    interReviewer = {
      status: diffs.length < MIN_SAMPLE ? "insufficient" : "ok",
      pairs: multi.length,
      mean_abs_diff: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
      n_diffs: diffs.length,
    };
  }

  // A delta needs a real pair; a lone re-score is a new review.
  const paired = observed.filter((r) => r.revision?.before && r.revision?.after);
  let revisions;
  if (!paired.length) {
    revisions = { status: "not_computed", pairs: 0, reason: "no review carries both revision.before and revision.after" };
  } else {
    const deltas = {};
    for (const c of CRITERIA) {
      const d = paired
        .map((r) => (typeof r.revision.before[c] === "number" && typeof r.revision.after[c] === "number" ? r.revision.after[c] - r.revision.before[c] : null))
        .filter((v) => v !== null);
      deltas[c] = d.length ? { n: d.length, mean_delta: d.reduce((a, b) => a + b, 0) / d.length, status: d.length < MIN_SAMPLE ? "insufficient" : "ok" } : { n: 0, mean_delta: null, status: "insufficient" };
    }
    revisions = { status: paired.length < MIN_SAMPLE ? "insufficient" : "ok", pairs: paired.length, deltas };
  }

  const groupBy = (key) => {
    const m = new Map();
    for (const r of observed) {
      const k = key(r) ?? "unknown";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].map(([k, rs]) => ({
      key: k,
      n: rs.length,
      criteria: Object.fromEntries(CRITERIA.map((c) => [c, scoreStats(rs, c)])),
    }));
  };

  const limits = [];
  if (!items.length) limits.push("no review records - nothing to evaluate, and no conclusion follows from that");
  if (errors.length) limits.push(`${errors.length} file(s) could not be parsed`);
  if (observed.length < MIN_SAMPLE) limits.push(`only ${observed.length} usable review(s); every mean above is labelled insufficient`);
  if (excluded) limits.push(`${excluded} simulated/fixture review(s) excluded from every metric`);
  if (interReviewer.status === "not_computed") limits.push("inter-reviewer agreement not computed: " + interReviewer.reason);
  if (revisions.status === "not_computed") limits.push("score change not computed: " + revisions.reason);
  if (naReasons.length) limits.push(`${naReasons.length} criterion score(s) recorded as N/A with a reason, excluded from means rather than scored 0`);
  if (suspectBlind.length) limits.push(`${suspectBlind.length} blind review(s) do not list all four withheld fields and are not trusted as blind`);
  limits.push("editorial scores are never combined into a single total, and are never merged with traffic or growth metrics");

  const out = {
    generated_at: now.toISOString(),
    reviews_dir: relative(ROOT, REVIEWS_DIR) || REVIEWS_DIR,
    totals: { records: items.length, observed: observed.length, excluded, na_reasons: naReasons.length },
    criteria,
    red_lines: redLines,
    suspect_blind: suspectBlind.map((r) => r.review_id),
    inter_reviewer: interReviewer,
    revisions,
    by_locale: groupBy((r) => r.locale),
    by_prompt: groupBy((r) => r.prompt_version),
    na: naReasons,
    limits,
    parse_errors: errors,
  };

  if (wantJson) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(errors.length ? 3 : 0);
  }

  const fmt = (s) => (s.status === "ok" ? `${s.mean.toFixed(2)} (n=${s.n}, missing=${s.missing})` : `insufficient (n=${s.n}, missing=${s.missing})`);
  const say = (s) => console.log("  " + s);
  console.log("EVAL LOOP - EDITORIAL");
  console.log("=".repeat(64));
  say(`reviews    : ${out.reviews_dir}`);
  say(`generated  : ${out.generated_at}`);
  console.log("");
  console.log("SAMPLES");
  say(`records            : ${out.totals.records}`);
  say(`observed           : ${out.totals.observed}`);
  say(`simulated/fixture  : ${out.totals.excluded}  (excluded from every metric)`);
  say(`N/A with reason    : ${out.totals.na_reasons}`);
  console.log("");
  console.log("CRITERIA (0-3, never summed)");
  for (const c of CRITERIA) say(`${c.padEnd(18)} ${fmt(criteria[c])}`);
  console.log("");
  console.log("CREDIBILITY RED LINES");
  say(`triggered          : ${redLines.triggered}${redLines.triggered ? " -> " + redLines.articles.join(", ") : ""}`);
  for (const [k, v] of Object.entries(redLines.by_type)) say(`  ${k.padEnd(22)} ${v}`);
  console.log("");
  console.log("INTER-REVIEWER");
  if (interReviewer.status === "not_computed") say("not computed: " + interReviewer.reason);
  else say(`articles with 2+ reviewers: ${interReviewer.pairs}; mean absolute difference: ${interReviewer.mean_abs_diff?.toFixed(2) ?? "n/a"} (${interReviewer.status})`);
  console.log("");
  console.log("REVISION (before -> after)");
  if (revisions.status === "not_computed") say("not computed: " + revisions.reason);
  else say(`paired reviews: ${revisions.pairs} (${revisions.status})`);
  console.log("");
  console.log("BY LOCALE / BY PROMPT VERSION");
  for (const g of out.by_locale) say(`locale ${String(g.key).padEnd(6)} n=${g.n}`);
  for (const g of out.by_prompt) say(`prompt ${String(g.key).padEnd(24)} n=${g.n}`);
  console.log("");
  console.log("LIMITS");
  for (const l of limits) say("- " + l);
  if (errors.length) {
    console.log("");
    console.log("PARSE ERRORS");
    for (const e of errors) say(`${e.file}: ${e.error}`);
  }
  console.log("");
  console.log(errors.length ? "RESULT: data integrity problems, see PARSE ERRORS" : "RESULT: editorial report from local records only; nothing was fetched");
  process.exit(errors.length ? 3 : 0);
}

if (flag("editorial")) {
  editorialReport();
}
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
