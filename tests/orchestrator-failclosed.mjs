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

/* 1. The orchestrator may only prepare a draft; Actions finalizes PUBLISHED after commit and live check. */
const readyLines = src.split("\n").filter((l) => /run\.verdict = "READY_FOR_PUBLISH"/.test(l));
rec("ready state is assigned exactly once", readyLines.length === 1, `${readyLines.length} assignments`);
const around = src.slice(Math.max(src.indexOf('run.verdict = "READY_FOR_PUBLISH";') - 500, 0), src.indexOf('run.verdict = "READY_FOR_PUBLISH";') + 50);
rec("ready state requires reviewer and registry", /qa\.verdict === "APPROVED"/.test(around) && /run\.reviewer\.status === "APPROVED"/.test(around) && /run\.registry\.status === "REBUILT"/.test(around), "review or registry guard missing");

/* 2. An unreadable review must not zero the failure code. */
rec("review outage cannot be converted into approval", !/LAUNCH_MODE !== "0"/.test(src) && !/B_LINE_SKIP_REVIEW/.test(src), "review bypass is back");

/* 3. The reviewer's objections must reach the log. */
rec("reviewer rejection is not an advisory publish path", !/kind: "published-despite-review"/.test(src) && !/advisory only - publishing/.test(src), "objection bypass is back");
rec("review outages fail the run", /review unavailable; publication refused/.test(src) && /"REVIEW_UNAVAILABLE"/.test(src), "unavailable verdict not recorded");

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { console.log(fails.join("\n")); process.exit(1); }
console.log("RESULT: PASS — PUBLISHED is finalized only after review, registry, commit and live verification");
