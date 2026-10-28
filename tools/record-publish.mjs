#!/usr/bin/env node
/**
 * Record a publication, and announce it.
 *
 *   node tools/record-publish.mjs --slug=<slug> [--url=<url>] [--status=published|failed]
 *
 * Two jobs, both after the fact:
 *   1. append one line to data/ledger/publications.jsonl - the machine-readable ledger the workbook
 *      is built from, so nobody fills a spreadsheet by hand;
 *   2. send a Feishu card when credentials exist, and say plainly when they do not.
 *
 * It never fails the pipeline: a notification that cannot be sent must not turn a published article
 * into a failed run. It reports what it did on stdout and exits 0 either way.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sendMessage } from "./lib/feishu-app.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d = "") => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};

const slug = flag("slug");
const status = flag("status", "published");
if (!slug) {
  console.log("  no --slug, nothing recorded");
  process.exit(0);
}

const url = flag("url", `https://www.toolsai.club/blog/${slug}/`);
const at = new Date().toISOString();
const runId = process.env.GITHUB_RUN_ID ?? "";
const sha = (process.env.GITHUB_SHA ?? "").slice(0, 7);
const repo = process.env.GITHUB_REPOSITORY ?? "tmj518/archipelago-ai-wire";
const runUrl = runId ? `https://github.com/${repo}/actions/runs/${runId}` : "";

const record = { at, status, slug, url, runId, sha, runUrl, workflow: process.env.GITHUB_WORKFLOW ?? "local" };
const ledger = join(ROOT, "data", "ledger", "publications.jsonl");
mkdirSync(dirname(ledger), { recursive: true });
appendFileSync(ledger, JSON.stringify(record) + "\n", "utf8");
console.log(`  recorded: ${status} ${slug}`);

/* The card is a courtesy, not the record. The ledger above is the record. */
const appId = process.env.FEISHU_APP_ID ?? "";
const appSecret = process.env.FEISHU_APP_SECRET ?? "";
const chatId = process.env.FEISHU_CHAT_ID ?? "";
if (!appId || !appSecret || !chatId) {
  console.log("  feishu: skipped (FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_CHAT_ID not all set)");
  process.exit(0);
}

const title = status === "published" ? "Published" : "Publish failed";
const lines = [
  `${title}: ${slug}`,
  `time: ${at}`,
  `url: ${url}`,
  `commit: ${sha || "(unknown)"}`,
  `run: ${runUrl || "(manual)"}`,
];
const sent = await sendMessage({ appId, appSecret, receiveId: chatId, title, lines, link: url });
if (sent.ok) {
  console.log(`  feishu: sent, message_id=${sent.messageId}`);
} else {
  console.log(`  feishu: not sent (${sent.error}) - the ledger entry above still stands`);
}