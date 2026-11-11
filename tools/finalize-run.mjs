#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { finalizeRunReport, finalizeState } from "./lib/finalize-run.mjs";

const root = process.cwd();
const latestPath = join(root, "data", "runs", "latest.json");
const statePath = join(root, "data", "state.json");
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
};
const context = {
  at: new Date().toISOString(),
  runId: process.env.GITHUB_RUN_ID ?? "",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
  workflow: process.env.GITHUB_WORKFLOW ?? "",
  event: process.env.GITHUB_EVENT_NAME ?? "",
  executionSha: process.env.GITHUB_SHA ?? "",
  jobStatus: process.env.JOB_STATUS ?? "unknown",
  verifyOutcome: process.env.VERIFY_OUTCOME ?? "unknown",
  publishCommit: process.env.PUBLISH_COMMIT ?? "",
  rejectionReportOutcome: process.env.REJECTION_REPORT_OUTCOME ?? "unknown",
  feishuReleaseOutcome: process.env.FEISHU_RELEASE_OUTCOME ?? "unknown",
  feishuRunLedgerOutcome: process.env.FEISHU_RUN_LEDGER_OUTCOME ?? "unknown",
};

mkdirSync(join(root, "data", "runs"), { recursive: true });
const report = finalizeRunReport(readJson(latestPath), context);
writeFileSync(latestPath, JSON.stringify(report, null, 2) + "\n", "utf8");
writeFileSync(statePath, JSON.stringify(finalizeState(readJson(statePath), report), null, 2) + "\n", "utf8");
console.log(`finalized run ${report.runId ?? "unknown"}: ${report.verdict}; article=${report.article ?? "none"}; commit=${report.commit ?? "none"}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    "",
    "## Final structured publication status",
    `- run: ${report.runId ?? "UNKNOWN"} / attempt ${report.runAttempt ?? "UNKNOWN"}`,
    `- publication: ${report.publicationStatus} (${report.verdict})`,
    `- live checks: ${Object.entries(report.liveChecks ?? {}).map(([name, value]) => `${name}=${value}`).join(", ")}`,
    `- recording: rejection report=${report.recording.rejectionReport}; Feishu release=${report.recording.feishuRelease}; Feishu run ledger=${report.recording.feishuRunLedger}; GitHub run ledger=${report.recording.githubRunLedger}`,
  ].join("\n");
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n", { encoding: "utf8", flag: "a" });
}
