#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewBLineArticle } from "../tools/b-line/review.mjs";
import { finalizeRunReport, finalizeState } from "../tools/lib/finalize-run.mjs";
import { isAcceptableReviewIndependence, reviewIndependenceLevel, verifyClaimEvidence } from "../tools/lib/review-independence.mjs";
import { expectedArticleIdentity, verifyPublication, verifyPublicationWithRetries } from "../tools/lib/verify-publication.mjs";
import { loadDirectiveSourceEvidence, verifyDirectiveSourceChecks } from "../tools/lib/source-evidence.mjs";
import { hasHumanReviewField, humanReviewBlockIsComplete } from "../tools/lib/review-metadata.mjs";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const bWorkflow = read(".github/workflows/b-line.yml");
const alertWorkflow = read(".github/workflows/alert.yml");
const generator = read("tools/b-line/generate.mjs");
const qa = read("tools/cloud-qa.mjs");
const orchestrator = read("tools/cloud-orchestrator.mjs");
const executor = read("tools/cloud-executor.mjs");
const qaGate = read("tools/qa-check.mjs");
const verifyCli = read("tools/verify-publication.mjs");

let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`); };

const approved = JSON.stringify({ verdict: "APPROVED", source_support: true, arithmetic: true, fact_checks: [], issues: [], summary: "All material claims match the fetched evidence." });
const identity = (provider = "reviewer", model = "model-b", text = approved) => ({ ok: true, provider, model, text });
await check("independent source-based reviewer can approve", async () => {
  const result = await reviewBLineArticle({ article: "draft", evidence: "source evidence", writerProvider: "writer", writerModel: "model-a", askFn: async () => ({ ok: true, provider: "reviewer", model: "model-b", text: approved }) });
  assert.equal(result.pass, true);
});
await check("same-provider same-model review fails closed", async () => {
  const result = await reviewBLineArticle({ article: "draft", evidence: "source evidence", writerProvider: "writer", writerModel: "model-a", askFn: async () => ({ ...identity("writer", "model-a"), writerKey: "key-a", reviewerKey: "key-b" }) });
  assert.equal(result.pass, false);
  assert.equal(result.independenceLevel, "same-model");
});
await check("same-provider different-model review is model-level and eligible", async () => {
  const result = await reviewBLineArticle({ article: "draft", evidence: "source evidence", writerProvider: "writer", writerModel: "model-a", askFn: async () => identity("writer", "model-b") });
  assert.equal(result.pass, true);
  assert.equal(result.independenceLevel, "model");
});
await check("missing or unknown model identity fails closed", async () => {
  const missing = await reviewBLineArticle({ article: "draft", evidence: "source", writerProvider: "writer", writerModel: "model-a", askFn: async () => identity("reviewer", "unknown") });
  const unknown = await reviewBLineArticle({ article: "draft", evidence: "source", writerProvider: "unknown", writerModel: "model-a", askFn: async () => identity() });
  assert.equal(missing.pass, false);
  assert.equal(missing.independenceLevel, "unknown");
  assert.equal(unknown.pass, false);
});
await check("missing evidence refuses review", async () => {
  let called = false;
  const result = await reviewBLineArticle({ article: "draft", evidence: "", writerProvider: "writer", askFn: async () => { called = true; } });
  assert.equal(result.pass, false);
  assert.equal(called, false);
});
await check("malformed reviewer response cannot pass", async () => {
  const result = await reviewBLineArticle({ article: "draft", evidence: "source evidence", writerProvider: "writer", writerModel: "model-a", askFn: async () => identity("reviewer", "model-b", "APPROVED") });
  assert.equal(result.pass, false);
});
await check("review call failure and explicit rejection fail closed", async () => {
  const failure = await reviewBLineArticle({ article: "draft", evidence: "source", writerProvider: "writer", writerModel: "model-a", askFn: async () => ({ ok: false, error: "offline" }) });
  const rejection = await reviewBLineArticle({ article: "draft", evidence: "source", writerProvider: "writer", writerModel: "model-a", askFn: async () => identity("reviewer", "model-b", JSON.stringify({ verdict: "REJECTED", source_support: false, arithmetic: false, fact_checks: [], issues: ["unsupported"], summary: "Not supported." })) });
  assert.equal(failure.pass, false);
  assert.equal(rejection.pass, false);
});
await check("3R article is quarantined before model review and cannot self-certify", async () => {
  let called = false;
  const result = await reviewBLineArticle({ article: "<p>A Muslim founder changed the price.</p>", evidence: "source", writerProvider: "writer", writerModel: "model-a", askFn: async () => { called = true; return identity(); } });
  assert.equal(result.pass, false);
  assert.equal(result.needsHumanReview, true);
  assert.equal(called, false);
  const fm = generator.split("const file = `---")[1]?.split("---`;")[0] ?? "";
  assert.doesNotMatch(fm, /human_review/);
  const gate = bWorkflow.indexOf("qa-check.mjs");
  const publish = bWorkflow.indexOf("- name: Publish the article");
  assert.ok(gate >= 0 && publish > gate, "B 3R/quality gate must precede Publish");
});
await check("automated A writer cannot add its own human_review sign-off", () => {
  const spoofed = "---\ntitle: Test\nhuman_review:\n  reviewer: Fake Editor\n  date: 2026-11-10\n---\n<p>Muslim policy.</p>";
  assert.equal(hasHumanReviewField(spoofed), true);
  assert.match(executor, /hasHumanReviewField\(article\)/);
  assert.match(executor, /automated writers cannot self-sign/);
  assert.match(qaGate, /humanReviewBlockIsComplete\(fm\)/);
  assert.equal(humanReviewBlockIsComplete("human_review:\n  reviewer: A Named Human\n  date: 2026-11-10\n"), true);
  assert.equal(humanReviewBlockIsComplete("human_review:\n  reviewer: \n  date: 2026-11-10\n"), false);
  assert.equal(humanReviewBlockIsComplete("human_review:\n  reviewer: A Named Human\n"), false);
  assert.equal(humanReviewBlockIsComplete("other:\n  reviewer: Fake Editor\n"), false);
});
await check("material business figures require an exact quote from curated primary evidence", () => {
  const article = "<p>Revenue reached $1 million.</p>";
  const document = { url: "https://founder.example/metrics", primary: true, body: "Revenue reached $1 million in the reported year." };
  const supported = verifyClaimEvidence({ article, sourceDocuments: [document], factChecks: [{ claim: "Revenue reached $1 million.", source_url: document.url, source_type: "primary", quote: "Revenue reached $1 million in the reported year." }] });
  const aggregator = verifyClaimEvidence({ article, sourceDocuments: [{ ...document, primary: false }], factChecks: [{ claim: "Revenue reached $1 million.", source_url: document.url, source_type: "primary", quote: document.body }] });
  assert.equal(supported.pass, true);
  assert.equal(aggregator.pass, false);
});
await check("review identity policy matrix matches configured provider/model/credential policy", () => {
  assert.equal(reviewIndependenceLevel({ provider: "a", model: "m1" }, { provider: "b", model: "m1" }), "provider");
  assert.equal(reviewIndependenceLevel({ provider: "a", model: "m1" }, { provider: "a", model: "m2" }), "model");
  assert.equal(reviewIndependenceLevel({ provider: "a", model: "m1", key: "k1" }, { provider: "a", model: "m1", key: "k2" }), "same-model");
  assert.equal(reviewIndependenceLevel({ provider: "unknown", model: "m1" }, { provider: "a", model: "m2" }), "unknown");
  assert.equal(isAcceptableReviewIndependence("provider"), true);
  assert.equal(isAcceptableReviewIndependence("model"), true);
  assert.equal(isAcceptableReviewIndependence("same-model"), false);
});
await check("URL verification has explicit failure after retry exhaustion", () => {
  const step = bWorkflow.split("- name: Verify live article, Sitemap and RSS")[1]?.split("- name: Report")[0] ?? "";
  assert.match(step, /B_LINE_OUTCOME=FAILED_LIVE_VERIFY/);
  assert.match(step, /exit 1/);
  assert.match(step, /verify-publication\.mjs/);
});
await check("B-line gates run before any publish step", () => {
  const gate = bWorkflow.indexOf("- name: Validate and gate the article");
  const publish = bWorkflow.indexOf("- name: Publish the article");
  assert.ok(gate >= 0 && publish > gate);
  for (const command of ["validate-article.mjs --changed", "qa-check.mjs", "astro build", "gate.mjs --fresh"]) assert.ok(bWorkflow.slice(gate, publish).includes(command), command);
  assert.match(generator, /required structure is missing/);
  assert.match(generator, /reviewBLineArticle\(/);
});
await check("B-line publish scope is article plus its case pool", () => {
  const step = bWorkflow.split("- name: Publish the article")[1]?.split("- name: Verify live")[0] ?? "";
  assert.match(step, /git add -- "src\/content\/blog\/\$\{slug\}\.md" data\/b-line\/cases\.json/);
  assert.doesNotMatch(step, /for p in src\/content/);
  assert.match(step, /unexpected paths staged/);
  assert.match(step, /staged_paths=\$\(git diff --cached --name-only\)/);
  assert.doesNotMatch(step, /grep -Ev .*\|\| true/);
});
await check("failure alert subscribes to A/B, classifies source-run failures, and reports UNKNOWN when lookup fails", () => {
  assert.match(alertWorkflow, /workflows:.*"Content day".*"B line"/);
  assert.match(alertWorkflow, /actions: read/);
  assert.match(alertWorkflow, /actions\/runs\/\$\{SOURCE_RUN_ID\}\/jobs/);
  assert.match(alertWorkflow, /failed job\/step classification: UNKNOWN/);
  assert.match(alertWorkflow, /run_attempt/);
});
await check("A-line approval requires reviewer independence", () => {
  assert.match(qa, /report\.layers\.L5\.independent !== true/);
  assert.doesNotMatch(orchestrator, /LAUNCH_MODE !== "0"/);
  assert.doesNotMatch(orchestrator, /B_LINE_SKIP_REVIEW/);
  assert.doesNotMatch(orchestrator, /published-despite-review/);
});
await check("A-line compares against the writer's actual reported provider", () => {
  assert.match(orchestrator, /const writerIdentity = .*exec\(writeOut\)/);
  assert.match(orchestrator, /`--writer-provider=\$\{writerProvider\}`/);
  assert.match(orchestrator, /`--writer-model=\$\{writerModel\}`/);
  assert.doesNotMatch(orchestrator, /run\.providers\.includes\("volces"\)/);
  assert.match(qa, /reviewIndependenceLevel/);
  assert.match(qa, /independenceLevel:/);
});
await check("A L5 uses only this-run archived evidence and blocks absent/mismatched source checks", () => {
  const fixtureRoot = "C:/workspace";
  const directivePath = `${fixtureRoot}/data/directive.json`;
  const archivePath = `${fixtureRoot}/data/sources/2026-11-10/release.html`;
  const quote = "DOSM reports exports reached RM 10 billion in October.";
  const directive = {
    figures: [{ value: "RM 10 billion", unit: "ringgit", period: "October", source: "DOSM", retrieved: "2026-11-10", evidence: quote, evidence_from: "data/sources/2026-11-10/release.html" }],
    _research: { fetched: [{ file: "data/sources/2026-11-10/release.html", url: "https://dosm.gov.my/release" }] },
  };
  const readFile = (path) => path === directivePath ? JSON.stringify(directive) : `<p>${quote}</p>`;
  const exists = (path) => String(path).replace(/\\/g, "/") === archivePath;
  const loaded = loadDirectiveSourceEvidence({ directivePath, root: fixtureRoot, readFile, exists });
  assert.equal(loaded.ok, true);
  const checks = [{ evidence_index: 0, figure_value: "RM 10 billion", source_url: "https://dosm.gov.my/release", quote, supported: true }];
  assert.equal(verifyDirectiveSourceChecks(loaded.documents, checks), true);
  assert.equal(verifyDirectiveSourceChecks(loaded.documents, []), false);
  assert.equal(verifyDirectiveSourceChecks(loaded.documents, [{ ...checks[0], quote: "paraphrased" }]), false);
  const badDirective = { ...directive, figures: [{ ...directive.figures[0], evidence: "Invented excerpt" }] };
  const badReadFile = (path) => path === directivePath ? JSON.stringify(badDirective) : `<p>${quote}</p>`;
  assert.equal(loadDirectiveSourceEvidence({ directivePath, root: fixtureRoot, readFile: badReadFile, exists }).ok, false);
  assert.match(qa, /archived source evidence unavailable/);
  assert.match(qa, /sourceEvidenceStatus/);
});

const context = { at: "2026-11-11T04:00:00Z", runId: "123", runAttempt: 1, workflow: "Content day", event: "schedule", executionSha: "a".repeat(40), jobStatus: "success", verifyOutcome: "success", publishCommit: "b".repeat(40) };
await check("PUBLISHED needs run, commit, reviewer-prepared state and live verification", () => {
  const ready = { runId: "123", runAttempt: 1, verdict: "READY_FOR_PUBLISH", article: "sample-article", reviewer: { status: "APPROVED", independent: true }, registry: { status: "REBUILT" } };
  const published = finalizeRunReport(ready, context);
  assert.equal(published.verdict, "PUBLISHED");
  assert.equal(published.runId, "123");
  assert.equal(published.runAttempt, 1);
  assert.equal(published.finalizationKey, "123:1");
  assert.equal(published.executionSha, "a".repeat(40));
  assert.equal(published.commit, "b".repeat(40));
  assert.equal(published.productionUrl, "https://www.ghiblistyled.com/blog/sample-article/");
  assert.equal(published.verifyOutcome, "success");
  assert.deepEqual(published.liveChecks, { canonical: true, titleMatchesGeneratedArticle: true, bodyEvidenceMatches: true, sitemapContainsArticle: true, rssContainsArticle: true });
  assert.equal(finalizeRunReport(ready, { ...context, verifyOutcome: "failure" }).verdict, "FAILED");
  assert.equal(finalizeRunReport(ready, { ...context, publishCommit: "" }).verdict, "FAILED");
  assert.equal(finalizeRunReport({ ...ready, runId: "old" }, context).verdict, "FAILED");
  assert.equal(finalizeRunReport({ ...ready, runAttempt: 2 }, context).verdict, "FAILED");
  assert.equal(finalizeRunReport({ ...ready, runAttempt: undefined }, context).verdict, "FAILED");
});
await check("A/B failures cannot create a PUBLISHED receipt", () => {
  const ready = { runId: "123", runAttempt: 1, verdict: "READY_FOR_PUBLISH", article: "sample-article", reviewer: { status: "APPROVED", independent: true }, registry: { status: "REBUILT" } };
  assert.equal(finalizeRunReport(ready, { ...context, jobStatus: "failure" }).verdict, "FAILED");
  assert.equal(finalizeRunReport(ready, { ...context, verifyOutcome: "failure" }).verdict, "FAILED");
  assert.equal(finalizeRunReport(ready, { ...context, publishCommit: "" }).verdict, "FAILED");
});
await check("Feishu and telemetry failure is explicit without undoing verified publication", () => {
  const ready = { runId: "123", runAttempt: 1, verdict: "READY_FOR_PUBLISH", article: "sample-article", reviewer: { status: "APPROVED", independent: true }, registry: { status: "REBUILT" } };
  const report = finalizeRunReport(ready, { ...context, rejectionReportOutcome: "failure", feishuReleaseOutcome: "failure", feishuRunLedgerOutcome: "unknown" });
  assert.equal(report.verdict, "PUBLISHED");
  assert.equal(report.recording.rejectionReport, "FAILED");
  assert.equal(report.recording.feishuRelease, "FAILED");
  assert.equal(report.recording.feishuRunLedger, "UNKNOWN");
  assert.equal(report.recordingFailure, true);
});
await check("same run and attempt finalization is idempotent", () => {
  const ready = { runId: "123", runAttempt: 1, verdict: "READY_FOR_PUBLISH", article: "sample-article", reviewer: { status: "APPROVED", independent: true }, registry: { status: "REBUILT" } };
  const first = finalizeRunReport(ready, context);
  const repeated = finalizeRunReport(first, { ...context, at: "2026-11-11T04:01:00Z" });
  const state1 = finalizeState({ published: 8 }, first);
  const state2 = finalizeState(state1, repeated);
  assert.equal(repeated.verdict, "PUBLISHED");
  assert.equal(state1.published, 9);
  assert.equal(state2.published, 9);
  assert.equal(state2.lastFinalizedKey, "123:1");
});
await check("different attempts replace final status and count one published run", () => {
  const report = (attempt) => ({ runId: "456", runAttempt: attempt, verdict: "READY_FOR_PUBLISH", article: "retry-article", reviewer: { status: "APPROVED", independent: true }, registry: { status: "REBUILT" } });
  const attempt1 = finalizeRunReport(report(1), { ...context, runId: "456", runAttempt: 1, jobStatus: "failure" });
  const state1 = finalizeState({ published: 3 }, attempt1);
  const attempt2 = finalizeRunReport(report(2), { ...context, runId: "456", runAttempt: 2 });
  const state2 = finalizeState(state1, attempt2);
  const duplicate2 = finalizeRunReport(attempt2, { ...context, runId: "456", runAttempt: 2 });
  const state3 = finalizeState(state2, duplicate2);
  const attempt3 = finalizeRunReport(report(3), { ...context, runId: "456", runAttempt: 3, jobStatus: "failure" });
  const state4 = finalizeState(state3, attempt3);
  assert.equal(attempt1.verdict, "FAILED");
  assert.equal(attempt2.verdict, "PUBLISHED");
  assert.equal(attempt3.verdict, "FAILED");
  assert.equal(state2.published, 4);
  assert.equal(state3.published, 4);
  assert.equal(state4.published, 3);
  assert.equal(state4.lastFinalizedRunAttempt, 3);
  assert.equal(state4.finalizedRuns["456"].verdict, "FAILED");
});
await check("published environment SHA is wired through a publish step output", () => {
  const workflow = read(".github/workflows/content-daily.yml");
  const publish = workflow.split("- name: Publish")[1]?.split("- name: Verify article")[0] ?? "";
  const receipt = workflow.split("- name: Finalize run publication receipt")[1]?.split("- name: Record the outcome")[0] ?? "";
  assert.match(publish, /echo "commit_sha=\$commit_sha" >> "\$GITHUB_OUTPUT"/);
  assert.match(receipt, /PUBLISH_COMMIT: \$\{\{ steps\.publish\.outputs\.commit_sha \}\}/);
  assert.doesNotMatch(receipt, /\$\{\{ env\.ARTICLE_COMMIT \}\}/);
  assert.match(receipt, /REJECTION_REPORT_OUTCOME: \$\{\{ steps\.rejection\.outcome \}\}/);
  assert.match(receipt, /FEISHU_RELEASE_OUTCOME: \$\{\{ env\.RELEASE_RECORD_STATUS \|\| steps\.release_record\.outcome \}\}/);
  assert.match(receipt, /FEISHU_RUN_LEDGER_OUTCOME: \$\{\{ steps\.feishu_console\.outcome \}\}/);
  assert.match(receipt, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /Report final receipt persistence/);
  assert.match(workflow, /publication_status:\.publicationStatus/);
  assert.match(workflow, /recording:\.recording/);
  assert.doesNotMatch(workflow, /git push origin HEAD:main \|\| true/);
  assert.doesNotMatch(workflow, /--run-only \|\| true/);
  assert.doesNotMatch(workflow, /\[ -e "\$p" \] && git add "\$p" \|\| true/);
});
await check("A and B verify the exact generated slug file for title/body identity", () => {
  const a = read(".github/workflows/content-daily.yml");
  assert.match(a, /tools\/verify-publication\.mjs --slug="\$ARTICLE_SLUG"/);
  assert.match(bWorkflow, /tools\/verify-publication\.mjs --slug="\$ARTICLE_SLUG"/);
  assert.match(verifyCli, /expectedArticleIdentity\(readFileSync\(articlePath, "utf8"\)\)/);
  assert.match(verifyCli, /\.\.\.identity/);
  assert.match(bWorkflow, /GITHUB_RUN_ATTEMPT/);
});
await check("A-line release and Feishu rows use only this run's ARTICLE_SLUG", () => {
  const release = read(".github/workflows/content-daily.yml").split("- name: Record and announce")[1]?.split("- name: Record in the Feishu console")[0] ?? "";
  const feishu = read(".github/workflows/content-daily.yml").split("- name: Record in the Feishu console")[1]?.split("- name: Finalize run publication receipt")[0] ?? "";
  assert.match(release, /slug="\$\{ARTICLE_SLUG:-\}"/);
  assert.match(release, /record-publish\.mjs --slug="\$slug"/);
  assert.doesNotMatch(release, /^[ \t]*(?:git log|ls src\/content|head -1)\b/m);
  assert.match(feishu, /SLUG="\$\{ARTICLE_SLUG:-\}"/);
  assert.match(feishu, /--slug="\$\{SLUG\}"/);
  assert.doesNotMatch(feishu, /^[ \t]*(?:git log|ls src\/content|head -1)\b/m);
});
await check("quiet is distinct from failure and increments no publication count", () => {
  const report = finalizeRunReport({ runId: "123", runAttempt: 1, verdict: "QUIET", reviewer: { status: "NOT_RUN" } }, context);
  assert.equal(report.verdict, "QUIET");
  const state = finalizeState({ published: 4 }, report);
  assert.equal(state.published, 4);
});
await check("B idempotent and generator quiet paths skip all publication work", () => {
  const skip = bWorkflow.split("- name: Already published today")[1]?.split("- name: Preflight")[0] ?? "";
  const write = bWorkflow.split("- name: Write the article")[1]?.split("- name: Validate and gate")[0] ?? "";
  assert.match(skip, /B_LINE_OUTCOME=QUIET/);
  assert.match(write, /if: env\.B_SKIP != '1'/);
  assert.match(write, /2\) echo "B_SKIP=1" >> "\$GITHUB_ENV"; echo "B_LINE_OUTCOME=QUIET"/);
  assert.match(write, /3\) echo "B_LINE_OUTCOME=REVIEW_HUMAN_REQUIRED"/);
  assert.match(bWorkflow, /PUBLISHED\|QUIET/);
  assert.match(bWorkflow, /run ID: \$\{GITHUB_RUN_ID\}; attempt: \$\{GITHUB_RUN_ATTEMPT\}; head SHA: \$\{GITHUB_SHA\}/);
});

const fixtureBase = "https://www.ghiblistyled.com";
const fixtureSlug = "offline-case";
const fixtureArticle = `${fixtureBase}/blog/${fixtureSlug}/`;
const fixtureTitle = "Offline case";
const fixtureBody = "This article body is a stable and distinct excerpt used to prove that the published page is this run's actual generated article.";
const fixtureMap = new Map([
  [fixtureArticle, `<html><head><link rel="canonical" href="${fixtureArticle}"></head><body><h1>${fixtureTitle}</h1><p>${fixtureBody}</p></body></html>`],
  [`${fixtureBase}/sitemap-index.xml`, `<sitemapindex><sitemap><loc>${fixtureBase}/sitemap-0.xml</loc></sitemap></sitemapindex>`],
  [`${fixtureBase}/sitemap-0.xml`, `<urlset><url><loc>${fixtureArticle}</loc></url></urlset>`],
  [`${fixtureBase}/rss.xml`, `<rss><channel><item><link>${fixtureBase}/blog/${fixtureSlug}</link></item></channel></rss>`],
]);
const fixtureFetch = async (url) => ({ status: fixtureMap.has(url) ? 200 : 404, url, text: async () => fixtureMap.get(url) ?? "" });
await check("post-publish verification checks article identity, sitemap index/child and RSS offline", async () => {
  const result = await verifyPublication({ slug: fixtureSlug, expectedTitle: fixtureTitle, bodyEvidence: fixtureBody, baseUrl: fixtureBase, fetchFn: fixtureFetch });
  assert.equal(result.ok, true);
  assert.equal(result.checks.titleMatchesH1, true);
  assert.equal(result.checks.bodyEvidence, true);
  assert.equal(result.checks.sitemapChildContainsArticle, true);
  assert.equal(result.checks.rssContainsArticle, true);
});
await check("post-publish verification rejects a wrong title or body identity", async () => {
  await assert.rejects(verifyPublication({ slug: fixtureSlug, expectedTitle: "Different article", bodyEvidence: fixtureBody, baseUrl: fixtureBase, fetchFn: fixtureFetch }), /title/);
  await assert.rejects(verifyPublication({ slug: fixtureSlug, expectedTitle: fixtureTitle, bodyEvidence: "A different expected paragraph that is long enough to satisfy the length floor but is absent from this published page.", baseUrl: fixtureBase, fetchFn: fixtureFetch }), /body evidence/);
});
await check("post-publish verification rejects off-origin redirects and derives identity from the generated markdown", async () => {
  const markdown = `---\ntitle: "${fixtureTitle}"\n---\n\n${fixtureBody}\n`;
  assert.deepEqual(expectedArticleIdentity(markdown), { title: fixtureTitle, bodyEvidence: fixtureBody });
  const redirected = async (url) => ({ status: 200, url: url === fixtureArticle ? "https://outside.example/redirected" : url, text: async () => fixtureMap.get(url) ?? "" });
  await assert.rejects(verifyPublication({ slug: fixtureSlug, expectedTitle: fixtureTitle, bodyEvidence: fixtureBody, baseUrl: fixtureBase, fetchFn: redirected }), /off-origin/);
});
await check("missing post-publish artifact fails after bounded retries", async () => {
  const result = await verifyPublicationWithRetries({ slug: fixtureSlug, expectedTitle: fixtureTitle, bodyEvidence: fixtureBody, baseUrl: fixtureBase, fetchFn: async (url) => ({ status: url.endsWith("/rss.xml") ? 404 : 200, url, text: async () => fixtureMap.get(url) ?? "" }), attempts: 2, delayMs: 0, sleepFn: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 2);
});

console.log(`\n${checks} P0 publishing-safety checks passed`);
