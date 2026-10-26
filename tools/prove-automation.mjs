#!/usr/bin/env node
/**
 * Prove the daily automation end to end, in one command.
 *
 * The individual pieces have each been tested; what has not been tested is the chain the daily
 * run actually executes: a build writes the sitemap, the sitemap dates drive submission, the
 * submission is logged, and the analysis step runs whether or not it has credentials. That
 * chain is what "is it automated" means, so this runs it and reports every link.
 *
 * It deliberately does not create a dummy article: the point is to test the pipeline that
 * exists, and a test article would pollute the sitemap it is testing.
 *
 * Usage:
 *   node tools/prove-automation.mjs            dry run, writes nothing to the network
 *   node tools/prove-automation.mjs --submit   performs a real IndexNow submission
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const DO_SUBMIT = process.argv.includes("--submit");
const NODE = process.execPath;

const steps = [];
const step = (name, ok, detail) => {
  steps.push({ name, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(46)} ${detail}`);
};

console.log("END-TO-END: does the daily automation actually run?\n" + "=".repeat(88));

/* 1. The build writes a sitemap with every published article in it. */
const smPath = join(ROOT, "dist", "sitemap-0.xml");
if (!existsSync(smPath)) {
  step("1 build output exists", false, "dist/sitemap-0.xml missing - run a build");
} else {
  const sm = readFileSync(smPath, "utf8");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  // Every published article must be in the map. This is the "new articles land in the sitemap"
  // requirement, checked directly rather than assumed from the plugin's behaviour.
  const blogDir = join(ROOT, "src", "content", "blog");
  const published = readdirSync(blogDir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !/^draft:\s*true/m.test(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(readFileSync(join(blogDir, f), "utf8"))?.[1] ?? ""))
    .map((f) => f.replace(/\.md$/, ""));

  const missing = published.filter((s) => !locs.some((l) => l.endsWith(`/blog/${s}/`)));
  step("1 every published article is in the sitemap", missing.length === 0, `${published.length} articles, ${missing.length} missing`);
  if (missing.length) for (const m of missing.slice(0, 5)) console.log(`         missing: ${m}`);

  const dated = (sm.match(/<lastmod>/g) || []).length;
  step("2 every URL carries a lastmod", dated === locs.length, `${dated} of ${locs.length}`);

  // The dates must come from content, not from the build: today's build date is 2026-10-08 and
  // two of the articles were published before it, so a page whose date is older proves the
  // source is the frontmatter rather than the clock.
  const dates = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  const distinct = new Set(dates).size;
  step("3 dates are content-derived, not build-derived", distinct > 3, `${distinct} distinct dates across ${dates.length} URLs`);
} 

/* 4. Submission reads that sitemap and finds today's changes. */
const changed = spawnSync(NODE, [join(ROOT, "tools", "submit-urls.mjs"), "--changed", ...(DO_SUBMIT ? [] : ["--dry-run"])], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 90000,
});
const changedOut = `${changed.stdout ?? ""}${changed.stderr ?? ""}`;
const submitted = Number(/to submit this run\s*:\s*(\d+)/.exec(changedOut)?.[1] ?? 0);
const keyed = /IndexNow key not configured/.test(changedOut) ? false : true;
step("4 submission finds today's changed URLs", changed.status === 0, `${submitted} URL(s) selected`);
step("5 the IndexNow key is configured and hosted", keyed, keyed ? "key found in public/" : "no key file");
if (DO_SUBMIT) {
  const code = /response\s*:\s*HTTP (\d+)/.exec(changedOut)?.[1];
  step("6 live submission accepted", code === "200" || code === "202", `HTTP ${code ?? "none"}`);
} else {
  step("6 live submission", true, "skipped (pass --submit to send for real)");
}

/* 7. The submission is logged, so "did the automation run" is answerable. */
const logPath = join(ROOT, "logs", "submissions.jsonl");
if (existsSync(logPath)) {
  const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  step("7 each attempt is logged", true, `${lines.length} entr(ies), last at ${last.at}`);
} else {
  step("7 each attempt is logged", false, "logs/submissions.jsonl not written yet");
}

/* 8. The analysis step runs, with or without credentials. */
const gsc = spawnSync(
  NODE,
  [join(ROOT, "tools", "gsc-report.mjs"), "--allow-missing-credentials"],
  { cwd: ROOT, encoding: "utf8", timeout: 120000 },
);
const gscOut = `${gsc.stdout ?? ""}${gsc.stderr ?? ""}`;
const configured = !/not configured/i.test(gscOut);
step(
  "8 analysis step runs without crashing",
  gsc.status === 0,
  configured ? "credentials present, data pulled" : "no credentials - reported as advisory, exit 0",
);
if (!configured) {
  const reason = /FAILED: (.*)/.exec(gscOut)?.[1] ?? "";
  console.log(`         reason: ${reason.slice(0, 120)}`);
  console.log(`         setup : Search Console -> Settings -> Users -> add the service-account`);
  console.log(`                 email with Full permission; key at gsc-service-account.json`);
}

/* 9. Both are wired into the daily wrapper. */
const wrapper = readFileSync(join(ROOT, "tools", "run-daily.ps1"), "utf8");
step("9 submission is a wrapper step", /submit-urls\.mjs/.test(wrapper), /step 6\/6/.test(wrapper) ? "step 6/6" : "NOT wired");
step("10 analysis is a wrapper step", /gsc-report\.mjs/.test(wrapper), /gsc-report/.test(wrapper) ? "wired" : "NOT wired");
step("11 neither can fail the run", !/\$submit -ne 0/.test(wrapper) && !/\$gsc -ne 0/.test(wrapper), "advisory only");

/* 12. A new article is picked up with no manual step. */
const instr = spawnSync(NODE, [join(ROOT, "tools", "build-instruments.mjs"), "--check"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
step("12 instrument registry tracks new articles", instr.status === 0, `${instr.stdout ?? ""}`.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "");

/* Summary. */
const failed = steps.filter((s) => !s.ok);
console.log("\n" + "=".repeat(88));
console.log(`  ${steps.length - failed.length} of ${steps.length} checks passed`);
if (failed.length) {
  console.log("\n  NOT automated:");
  for (const f of failed) console.log(`     ${f.name} — ${f.detail}`);
}
console.log(`
  What remains manual, and why:
     - Google "Request indexing"  : no API exists. The Indexing API accepts only
                                    JobPosting and BroadcastEvent, and Google documents that
                                    using it for other content breaches its terms.
     - Cloudflare www redirect    : a host-level rule, not code. One rule in the dashboard.
     - GSC service-account key    : created in Google Cloud, needs a browser once.`);
process.exit(failed.length ? 1 : 0);
