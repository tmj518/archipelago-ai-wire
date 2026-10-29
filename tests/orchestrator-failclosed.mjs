#!/usr/bin/env node
/**
 * Fail-closed guards in the orchestrator, checked at the source.
 *
 * The expensive mistakes in this pipeline were never logic errors - they were success states reachable
 * without their precondition. A run reported PUBLISHED with no verdict at all because the assignment had
 * no guard. These assertions exist so that guard cannot be removed quietly: they read the file and fail
 * if the unconditional form comes back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "tools/cloud-orchestrator.mjs"), "utf8");

let pass = 0;
const fails = [];
const rec = (n, ok, d = "") => (ok ? pass++ : fails.push(n + (d ? "  — " + d : "")));

/* 1. PUBLISHED must not be assigned outside an APPROVED check. */
const publishedLines = src.split("\n").filter((l) => /run\.verdict = "PUBLISHED"/.test(l));
rec("success state is assigned exactly once", publishedLines.length === 1, `${publishedLines.length} assignments`);
const around = src.slice(Math.max(src.indexOf('run.verdict = "PUBLISHED";') - 400, 0), src.indexOf('run.verdict = "PUBLISHED";') + 40);
rec("success state is behind an APPROVED check", /qa\.verdict === "APPROVED"/.test(around), "guard missing");

/* 2. An unreadable review must not zero the failure code. */
rec("unavailable review keeps qaCode non-zero", !/unavailable[^\n]*publishing anyway/.test(src), "publish-anyway branch is back");

/* 3. The reviewer's objections must reach the log. */
rec("objections are printed into the run reasons", /objection: \$\{/.test(src), "reason printing missing");

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { console.log(fails.join("\n")); process.exit(1); }
console.log("RESULT: PASS — no path reaches PUBLISHED without an approving verdict");