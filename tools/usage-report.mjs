#!/usr/bin/env node
/**
 * What did the writing cost?
 *
 *   node tools/usage-report.mjs
 *   node tools/usage-report.mjs --json
 *   node tools/usage-report.mjs --log <path> --since 2026-10-01
 *
 * Reads `logs/usage.jsonl`, which tools/lib-llm.mjs appends one line to per model call. Read-only: the
 * log is never rewritten, and no field that could contain a prompt, a completion, a key or an
 * authorization header is printed - only the accounting columns are.
 *
 * ## The three distinctions this report refuses to blur
 *
 * 1. A failed call is not a cheap call. `ok: false` rows are counted separately and never folded
 *    into a cost average as if they were cheap successes.
 * 2. A missing cost is not zero. `estimatedUsd: null` is excluded from the total and counted in the
 *    coverage line. Summing nulls as 0 would produce a total that is confidently wrong.
 * 3. A stub call is not a real call. The rehearsal harness points at endpoints like `ep-test`; those
 *    rows are counted, listed and excluded from every real total.
 *
 * ## What it cannot answer, and says so
 *
 * The log has no article or run identifier. Cost per published piece is therefore **not computable**
 * from this data - not "approximately", not "on average": there is no join key. The report prints that
 * as a finding rather than dividing a total by an article count and calling it a unit cost.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOG = join(ROOT, "logs", "usage.jsonl");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf(`--${n}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return null;
};

const LOG = value("log") ?? DEFAULT_LOG;
const SINCE = value("since");
const wantJson = flag("json");

/**
 * Records produced by the rehearsal harness rather than a real endpoint.
 *
 * Matched on the model id, because that is the only field the stub path changes: `ep-test` and
 * `ep-z` are placeholders the orchestrator's tests point at. A real endpoint id carries a
 * timestamp (ep-YYYYMMDD...). If a future stub uses a different name, this list is where it is
 * declared - and the report prints the matching rule next to the count so a wrong rule is visible.
 */
const SIMULATED_MODEL = /^ep-(test|z)$/i;

const lines = existsSync(LOG) ? readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.trim()) : [];

const corrupt = [];
const parsed = [];
for (const [i, line] of lines.entries()) {
  try {
    const rec = JSON.parse(line);
    if (!rec || typeof rec !== "object") throw new Error("not an object");
    parsed.push(rec);
  } catch (e) {
    corrupt.push({ line: i + 1, error: e.message });
  }
}

const day = (r) => (typeof r.at === "string" && r.at.length >= 10 ? r.at.slice(0, 10) : null);
const usable = SINCE ? parsed.filter((r) => (day(r) ?? "") >= SINCE) : parsed;

const simulated = usable.filter((r) => SIMULATED_MODEL.test(String(r.model ?? "")));
const real = usable.filter((r) => !SIMULATED_MODEL.test(String(r.model ?? "")));

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sumBy = (rows, field) => {
  const vals = rows.map((r) => num(r[field])).filter((v) => v !== null);
  return { n: vals.length, total: vals.length ? vals.reduce((a, b) => a + b, 0) : null };
};

const outcomes = {
  ok: real.filter((r) => r.ok === true).length,
  failed: real.filter((r) => r.ok === false).length,
  // Not "successful": a row with no ok field is unaccounted for, and saying so is the point.
  unknown: real.filter((r) => r.ok !== true && r.ok !== false).length,
};

const prompt = sumBy(real, "promptTokens");
const completion = sumBy(real, "completionTokens");
const usd = sumBy(real, "estimatedUsd");

const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = (typeof key(r) === "string" && key(r)) || "(missing)";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()]
    .map(([k, rs]) => ({
      key: k,
      calls: rs.length,
      ok: rs.filter((r) => r.ok === true).length,
      failed: rs.filter((r) => r.ok === false).length,
      tokens: sumBy(rs, "promptTokens").total === null && sumBy(rs, "completionTokens").total === null
        ? null
        : (sumBy(rs, "promptTokens").total ?? 0) + (sumBy(rs, "completionTokens").total ?? 0),
      usd: sumBy(rs, "estimatedUsd").total,
      usd_n: sumBy(rs, "estimatedUsd").n,
    }))
    .sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key));
};

const dates = usable.map(day).filter(Boolean).sort();

const out = {
  log: relative(ROOT, LOG) || LOG,
  since: SINCE,
  lines: lines.length,
  parsed: parsed.length,
  corrupt,
  totals: {
    records: usable.length,
    real: real.length,
    simulated: simulated.length,
    simulated_rule: String(SIMULATED_MODEL),
  },
  outcomes,
  tokens: { prompt, completion, total: prompt.total === null && completion.total === null ? null : (prompt.total ?? 0) + (completion.total ?? 0) },
  cost: {
    usd_total: usd.total,
    rows_with_cost: usd.n,
    rows_without_cost: real.length - usd.n,
    coverage: real.length ? `${usd.n}/${real.length}` : "0/0",
  },
  by_role: group(real, (r) => r.role),
  by_model: group(real, (r) => r.model),
  by_provider: group(real, (r) => r.provider),
  by_day: group(real, (r) => day(r)),
  date_range: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
  per_article_cost: {
    status: "not_computable",
    reason: "the log carries no article_id, slug or run_id, so no row can be attributed to a published piece",
  },
  simulated_models: [...new Set(simulated.map((r) => r.model))].sort(),
};

if (wantJson) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(corrupt.length ? 3 : 0);
}

const money = (v) => (v === null ? "not recorded" : "$" + v.toFixed(4));
const pct = (a, b) => (b ? `${a}/${b}` : "0/0");
const say = (s) => console.log("  " + s);

console.log("USAGE REPORT");
console.log("=".repeat(64));
say(`log        : ${out.log}`);
say(`records    : ${out.totals.records} lines parsed, ${corrupt.length} corrupt`);
if (out.date_range.first) say(`dates      : ${out.date_range.first} .. ${out.date_range.last}`);
console.log("");
console.log("CALLS (real endpoints only)");
say(`successful : ${outcomes.ok}`);
say(`failed     : ${outcomes.failed}`);
say(`unknown    : ${outcomes.unknown}  (no ok field - not counted as success)`);
say(`stub calls : ${out.totals.simulated} excluded (${SIMULATED_MODEL})`);
console.log("");
console.log("TOKENS");
say(`prompt     : ${prompt.total ?? "not recorded"} (n=${prompt.n})`);
say(`completion : ${completion.total ?? "not recorded"} (n=${completion.n})`);
console.log("");
console.log("COST");
say(`estimated  : ${money(usd.total)}`);
say(`coverage   : ${out.cost.coverage} rows carry a cost; ${out.cost.rows_without_cost} do not`);
console.log("");
console.log("BY ROLE");
if (!out.by_role.length) say("(none)");
for (const g of out.by_role) say(`${g.key.padEnd(10)} calls=${String(g.calls).padEnd(4)} ok=${String(g.ok).padEnd(4)} failed=${String(g.failed).padEnd(3)} usd=${g.usd === null ? "n/a" : "$" + g.usd.toFixed(4)}`);
console.log("");
console.log("BY MODEL");
for (const g of out.by_model) say(`${g.key.padEnd(28)} calls=${String(g.calls).padEnd(4)} tokens=${g.tokens ?? "n/a"}`);
console.log("");
console.log("PER-ARTICLE COST");
say(`${out.per_article_cost.status}: ${out.per_article_cost.reason}`);
if (corrupt.length) {
  console.log("");
  console.log("CORRUPT LINES");
  for (const c of corrupt.slice(0, 5)) say(`line ${c.line}: ${c.error}`);
}
console.log("");
console.log(corrupt.length ? "RESULT: log has unparsable lines, totals exclude them" : "RESULT: totals computed from the log only; nothing was estimated");
process.exit(corrupt.length ? 3 : 0);
