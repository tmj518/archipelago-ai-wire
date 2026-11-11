#!/usr/bin/env node
/**
 * Regression checks for workflow shell values that originate in GitHub event metadata.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = readFileSync(join(process.cwd(), ".github/workflows/alert.yml"), "utf8");
const start = file.indexOf("- name: Record the failure");
const end = file.indexOf("- name: Classify failed job and step", start);
const step = start >= 0 && end > start ? file.slice(start, end) : "";
const runStart = step.indexOf("run: |");
const envStart = step.indexOf("\n        env:");
const run = runStart >= 0 && envStart > runStart ? step.slice(runStart, envStart) : "";

const checks = [
  ["failure summary writes its header with printf", /printf '%s\\n' '## Failure record' ''/.test(run)],
  ["event values are passed through environment fields", /SOURCE_WORKFLOW: .*github\.event\.workflow_run\.name/.test(step) && /SOURCE_BRANCH: .*github\.event\.workflow_run\.head_branch/.test(step)],
  ["summary script does not interpolate GitHub expressions", !/\$\{\{/.test(run)],
  ["summary script does not use echo", !/echo\s+/.test(run)],
  ["metadata values are printed as data and line breaks are flattened", /printf '%s' "\$SOURCE_WORKFLOW" \| tr/.test(run) && /printf '%s' "\$SOURCE_BRANCH" \| tr/.test(run)],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
console.log("WORKFLOW SUMMARY REGRESSION");
for (const [name, ok] of checks) console.log((ok ? "  PASS " : "  FAIL ") + name);
console.log("RESULT: " + (failed.length ? "FAIL" : "PASS"));
if (failed.length) process.exit(1);