#!/usr/bin/env node
/**
 * The readership loop, verified end to end, without touching real data.
 *
 * ## What was broken
 *
 * Three links in a chain, none of them exercised:
 *
 *   analytics.mjs --fetch   writes data/analytics/<date>.json
 *   analytics.mjs --brief   joins those snapshots to the ledger and prints what the writer is told
 *   readershipBrief()       injects that text into the writer's prompt
 *
 * Every one of them was written, documented and never run, because --fetch needs Cloudflare credentials that
 * were never set and its failure was a `continue-on-error` step. So the "data-driven" part of a data-driven
 * site was three untested functions pointing at an empty directory.
 *
 * ## What this checks
 *
 * It builds a snapshot with a shape the fetcher produces, puts it in a temporary analytics directory, and
 * asserts that the brief names real numbers rather than NaN and undefined. Those two words are what a broken
 * join produces, and they are worse than an empty brief: an empty brief says nothing is known, while
 * "NaN trade-policy" launders a broken pipeline into a fact the writer might act on.
 *
 * ## Why it writes to a temporary directory
 *
 * data/analytics is what the writer reads. Leaving a synthetic snapshot there - even for a second - means a
 * run that happens to overlap sees invented traffic. The check therefore points the tool at a scratch
 * directory through an environment variable, which the tool honours and production never sets.
 *
 *   node tools/check-readership.mjs
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "data", "tmp", "readership-check");

console.log("READERSHIP LOOP\n" + "=".repeat(78));

/* A snapshot in the shape fetch() writes: {path, views}, not {path, pageviews}. */
const SNAPSHOT = {
  at: new Date().toISOString(),
  windowDays: 7,
  totalPageviews: 1847,
  pages: [
    { path: "/blog/china-zero-tariff-20-african-countries-2026/", views: 412 },
    { path: "/blog/us-low-value-shipment-entry-rule-2026/", views: 305 },
    { path: "/calculators/landed-cost/", views: 260 },
  ],
  countries: [{ name: "United States", views: 900 }],
  referers: [{ host: "google.com", views: 700 }],
};

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
writeFileSync(join(SCRATCH, "2026-01-01.json"), JSON.stringify(SNAPSHOT, null, 2), "utf8");

let out = "";
let code = 0;
try {
  out = execFileSync(process.execPath, [join(ROOT, "tools", "analytics.mjs"), "--brief"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, ANALYTICS_DIR: SCRATCH },
  });
} catch (e) {
  out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  code = e.status ?? 1;
}

rmSync(SCRATCH, { recursive: true, force: true });

const problems = [];

/*
 * The tool must actually use ANALYTICS_DIR. If it does not, this check silently tests the empty production
 * directory and passes for the wrong reason - which is the failure mode this whole file exists to prevent, so
 * it is tested first.
 */
if (!out.includes("1847")) {
  problems.push("the brief does not contain the snapshot's pageview total, so ANALYTICS_DIR is not honoured and this check would pass against an empty directory");
}

if (/NaN/.test(out)) problems.push("the brief contains NaN - a field name disagrees between fetch and brief");
if (/undefined/.test(out)) problems.push("the brief contains undefined - the ledger join produced a missing value");
if (!/By category/i.test(out)) problems.push("the brief does not report category totals");
if (!/Most read articles/i.test(out)) problems.push("the brief does not report the most read articles");

/* And the production directory must be untouched. */
const prod = join(ROOT, "data", "analytics");
const real = existsSync(prod) ? readFileSync(join(prod, "2026-01-01.json"), { flag: "r" }) : null;
if (real) problems.push("a synthetic snapshot was left in data/analytics, which the writer reads");

console.log(`  pageview total carried through : ${out.includes("1847") ? "yes" : "NO"}`);
console.log(`  category totals                : ${/By category/i.test(out) ? "yes" : "NO"}`);
console.log(`  most read list                 : ${/Most read articles/i.test(out) ? "yes" : "NO"}`);
console.log(`  NaN / undefined                : ${/NaN|undefined/.test(out) ? "PRESENT" : "none"}`);
console.log(`  data/analytics untouched       : ${!real ? "yes" : "NO"}`);
console.log("");

if (!problems.length) {
  console.log("RESULT: PASS - a snapshot becomes a brief with real numbers, and nothing leaks into data/analytics");
  process.exit(0);
}

console.log(`${problems.length} PROBLEM(S):`);
for (const p of problems) console.log("  " + p);
console.log("");
console.log(out.split("\n").slice(0, 14).map((l) => "  | " + l).join("\n"));
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
