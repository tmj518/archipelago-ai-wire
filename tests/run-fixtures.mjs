#!/usr/bin/env node
/**
 * The Malaysia-migration test suite.
 *
 *   node tests/run-fixtures.mjs
 *
 * ## Why fixtures and not a paragraph in a report
 *
 * The 2026-10-26 changes touch five files that decide whether an article publishes: the taxonomy,
 * the Zod schema, the structural gate, the figure classifier and the prompt parity check. A change
 * to any of them can be argued about in prose; only a run says whether a Malaysian article passes.
 *
 * Three fixtures, each pinning one claim:
 *
 *   valid-malaysia-article.md       a data-driven piece quoting the ringgit passes every blocking
 *                                   rule - this is the claim that the new genre is publishable
 *   valid-gazette-primary-source.md a piece citing P.U. (A) 411/2023 satisfies the primary-source
 *                                   rule - the claim that Malaysian statutory citation is recognised
 *   invalid-retired-category.md     the same article with `category: trade-policy` is rejected -
 *                                   the claim that the old vocabulary was not merely deleted from
 *                                   the prompt but actually enforced
 *
 * Plus unit checks on the classifier and the taxonomy, which run in milliseconds and catch the
 * failure the fixtures cannot: a currency that silently stops counting.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok, detail });

/* ── unit: the controlled vocabulary ─────────────────────────────────────────────────────────── */

const tax = await import(pathToFileURL(join(ROOT, "src/lib/taxonomy.mjs")).href);

const dupes = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);
record("taxonomy: no duplicate category slugs", dupes(tax.CATEGORY_SLUGS).length === 0, dupes(tax.CATEGORY_SLUGS).join(","));
record("taxonomy: no duplicate audiences", dupes(tax.AUDIENCE_VALUES).length === 0);
record("taxonomy: no duplicate guide topics", dupes(tax.GUIDE_TOPIC_SLUGS).length === 0);
record("taxonomy: sections non-empty", tax.SECTIONS.length >= 6, `${tax.SECTIONS.length} sections`);
record(
  "taxonomy: the Malaysian consequence has its own section",
  tax.SECTIONS.includes("What it means for Malaysia"),
);

/* ── unit: the figure classifier ─────────────────────────────────────────────────────────────── */

const figs = await import(pathToFileURL(join(ROOT, "src/lib/figures.mjs")).href);

const mustCount = [
  ["1500", "MYR per month"],
  ["4200", "RM"],
  ["1200", "sen"],
  ["3.4", "percentage point"],
  ["25", "basis point"],
  ["18", "percent"],
  ["40", "tonnes"],
];
const mustNotCount = [
  ["2026", "year"],
  ["P.U. (A) 411/2023", "gazette"],
  ["411/2023", "instrument number"],
];
for (const [v, u] of mustCount) {
  record(`figure counts: ${v} ${u}`, figs.isSubstantive({ value: v, unit: u }) === true);
}
for (const [v, u] of mustNotCount) {
  record(`figure does not count: ${v} ${u}`, figs.isSubstantive({ value: v, unit: u }) === false);
}
record("numericValue strips a currency prefix", figs.numericValue("RM1,500") === 1500);
record("numericValue reads a plain amount", figs.numericValue("1,500") === 1500);
record("numericValue rejects a non-number", figs.numericValue("P.U. (A) 411/2023") === null);

/* ── integration: the structural gate on three fixtures ─────────────────────────────────────── */

function gate(fixture) {
  const r = spawnSync(process.execPath, [join(ROOT, "tools/qa-check.mjs"), join(ROOT, "tests/fixtures", fixture)], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const f1 = gate("valid-malaysia-article.md");
record("gate: a Malaysian data article passes", f1.code === 0, firstLine(f1.out, "RESULT"));
record("gate: it is not passing by skipping rules", /pass ·/.test(f1.out), "");

const f2 = gate("valid-gazette-primary-source.md");
record("gate: a P.U. (A) citation satisfies primary-source", f2.code === 0, firstLine(f2.out, "RESULT"));
record(
  "gate: the primary-source rule actually ran",
  !/BLOCK\s+primary-source cited/.test(f2.out),
);

const f3 = gate("invalid-retired-category.md");
record("gate: a retired category is rejected", f3.code !== 0, firstLine(f3.out, "RESULT"));
record("gate: it is rejected for the category, not something else", /category legal/.test(f3.out));
record("gate: it names the retired value", /trade-policy/.test(f3.out));

/* ── integration: the prompt/code parity check ──────────────────────────────────────────────── */

const parity = spawnSync(process.execPath, [join(ROOT, "tools/check-master-prompt.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
record("parity: MASTER_PROMPT matches the code", parity.status === 0, firstLine(parity.stdout ?? "", "RESULT"));

/* ── report ─────────────────────────────────────────────────────────────────────────────────── */

function firstLine(s, needle) {
  return String(s)
    .split(/\r?\n/)
    .filter((l) => l.includes(needle))
    .slice(-1)[0]
    ?.trim()
    .slice(0, 110) ?? "";
}

const failed = results.filter((r) => !r.ok);
console.log("MALAYSIA MIGRATION TEST SUITE\n" + "=".repeat(78));
for (const r of results) {
  console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log("");
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`\n${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("RESULT: PASS");
