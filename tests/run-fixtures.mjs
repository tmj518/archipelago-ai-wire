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
import { tmpdir } from "node:os";
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
  ["5", "days of holiday"],
  ["12", "weekends"],
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

/* ── the single vocabulary source (P0-4) ─────────────────────────────────────────────────────── */

const rules = await import(pathToFileURL(join(ROOT, "src/lib/schema-rules.mjs")).href);

for (const gone of ["trade-policy", "platforms", "supply-chain", "sourcing", "logistics"]) {
  record(`vocabulary: ENUMS.category rejects retired "${gone}"`, !rules.ENUMS.category.includes(gone));
}
for (const live of tax.CATEGORY_SLUGS) {
  record(`vocabulary: ENUMS.category accepts "${live}"`, rules.ENUMS.category.includes(live));
}
for (const gone of ["importer", "platform-seller", "both"]) {
  record(`vocabulary: ENUMS.audience rejects retired "${gone}"`, !rules.ENUMS.audience.includes(gone));
}
for (const live of tax.AUDIENCE_VALUES) {
  record(`vocabulary: ENUMS.audience accepts "${live}"`, rules.ENUMS.audience.includes(live));
}

const schemaParity = spawnSync(process.execPath, [join(ROOT, "tools/check-schema-parity.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
record("parity: schema and vocabulary agree", schemaParity.status === 0, firstLine(schemaParity.stdout ?? "", "RESULT"));

/* ── integration: the writer's prompt (P0-3) ────────────────────────────────────────────────── */

const prompt = await import(pathToFileURL(join(ROOT, "src/lib/writer-prompt.mjs")).href);
record("prompt: names the three questions", /what happened/i.test(prompt.WRITER_SYSTEM) && /what it means for malaysia/i.test(prompt.WRITER_SYSTEM));
record("prompt: every required section appears in the structure", tax.SECTIONS.every((s) => prompt.STRUCTURE.includes(`## ${s}`)));
record("prompt: the Malaysian consequence has a rule", /concrete carrier/.test(prompt.RULES));
const STALE_PROMPT = ["Landed Math", "Chinese", "trade-policy", "platform-seller", "per-unit cost consequences"];
record(
  "prompt: no retired positioning survives",
  STALE_PROMPT.every((s) => !(`${prompt.WRITER_SYSTEM}${prompt.RULES}${prompt.STRUCTURE}`).includes(s)),
);

/* ── integration: the two new quality rules ─────────────────────────────────────────────────── */

const f4 = gate("quarantine-3r.md");
record("gate: a 3R subject without a reviewer is quarantined", f4.code !== 0);
record("gate: it says why", /3R review/.test(f4.out));

const f5 = gate("primary-source-unbound.md");
record("gate: a document named only in prose does not ground the figures", f5.code !== 0);
record("gate: it says the numbers are not tied to the document", /not tied to the document/.test(f5.out));

/* ── the gate suite actually runs the parity check ──────────────────────────────────────────── */

const gateSrc = readFileSync(join(ROOT, "tools/gate.mjs"), "utf8");
record("gate.mjs: the parity check is a hard gate", /id:\s*"check-schema-parity"/.test(gateSrc) && /tier:\s*"hard"/.test(gateSrc));

/* ── the guide queue (P0-1) ─────────────────────────────────────────────────────────────────── */

const queueLib = await import(pathToFileURL(join(ROOT, "src/lib/guide-queue.mjs")).href);

const validTopic = {
  slug: "ringgit-and-the-import-bill",
  topic: "money",
  audience: ["general"],
  unit: "one month",
  title: "What the ringgit does to an imported bill",
  status: "queued",
};

const okQueue = queueLib.parseGuideQueue(JSON.stringify({ version: 2, topics: [validTopic] }));
record("queue: a valid queue loads", okQueue.ok === true && okQueue.topics.length === 1);
record("queue: it keeps the raw object for write-back", okQueue.ok === true && okQueue.queue.version === 2);

const emptyQueue = queueLib.parseGuideQueue(JSON.stringify({ version: 2, topics: [] }));
record("queue: an explicitly empty queue is valid, not broken", emptyQueue.ok === true && emptyQueue.topics.length === 0);

const missing = queueLib.loadGuideQueue(join(tmpdir(), `no-such-queue-${Date.now()}.json`));
record("queue: a missing file is reported as missing", missing.ok === false && missing.kind === "missing");
record("queue: the message names the file and does not pretend it is empty", /no queue at/i.test(missing.detail));

const broken = queueLib.parseGuideQueue("{ this is not json ");
record("queue: malformed JSON is reported", broken.ok === false && broken.kind === "invalid-json");

const noTopics = queueLib.parseGuideQueue(JSON.stringify({ version: 2 }));
record("queue: a missing topics key is a structure fault, not an empty queue", noTopics.ok === false && noTopics.kind === "invalid-structure");

const wrongType = queueLib.parseGuideQueue(JSON.stringify({ topics: "ringgit" }));
record("queue: topics that is not an array is a structure fault", wrongType.ok === false && wrongType.kind === "invalid-structure");

const oldChina = queueLib.parseGuideQueue(
  JSON.stringify({ topics: [{ ...validTopic, slug: "z-visa", topic: "work-visa" }] }),
);
record("queue: a restored China-era topic is rejected by the vocabulary", oldChina.ok === false && /work-visa/.test(oldChina.detail));

const retiredAudience = queueLib.parseGuideQueue(
  JSON.stringify({ topics: [{ ...validTopic, audience: ["importer"] }] }),
);
record("queue: a retired audience is rejected", retiredAudience.ok === false && /importer/.test(retiredAudience.detail));

const dupSlugs = queueLib.parseGuideQueue(JSON.stringify({ topics: [validTopic, { ...validTopic }] }));
record("queue: duplicate slugs are rejected", dupSlugs.ok === false && /duplicate/i.test(dupSlugs.detail));

const cLineSrc = readFileSync(join(ROOT, "tools/c-line-orchestrator.mjs"), "utf8");
record("queue: the orchestrator uses the validated loader", /loadGuideQueue\(QUEUE_FILE\)/.test(cLineSrc));
record("queue: a missing queue stops the line with its own verdict", /"NO-QUEUE"/.test(cLineSrc) && /finish\(78\)/.test(cLineSrc));

/* ── the evidence checker (P0-2) ───────────────────────────────────────────────────────────── */

const evidence = spawnSync(process.execPath, [join(ROOT, "tools/check-evidence.mjs"), "--selftest"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
record("evidence: the self-test runs without the old archive", evidence.status === 0, firstLine(evidence.stdout ?? "", "correct"));
record("evidence: it still rejects what it must", /expect REJECT\s+got REJECT/.test(evidence.stdout ?? ""));
record("evidence: it still accepts what it must", /expect PASS\s+got PASS/.test(evidence.stdout ?? ""));
record("evidence: a source that exists but is empty is rejected", /source exists but is empty/.test(evidence.stdout ?? ""));
const evidenceSrc = readFileSync(join(ROOT, "tools/check-evidence.mjs"), "utf8");
record(
  "evidence: the fixture is committed under tests/",
  /const doc = "tests\/fixtures\/evidence\/sample-source\.txt"/.test(evidenceSrc),
);
record("evidence: the self-test no longer reads the old archive", !/const doc = "data\/sources/.test(evidenceSrc));

/* ── the Feishu safety suite (command 06) ──────────────────────────────────────────────────── */

const feishu = spawnSync(process.execPath, [join(ROOT, "tests/feishu-safety.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
record("feishu: the safety suite passes", feishu.status === 0, firstLine(feishu.stdout ?? "", "passed"));
record("feishu: no base is created by the tests", /no base was created/.test(feishu.stdout ?? ""));

/* ── the A-line call sites use the shared vocabulary (P0-4) ─────────────────────────────────── */

const execSrc = readFileSync(join(ROOT, "tools/cloud-executor.mjs"), "utf8");
record("A-line: the writer prompt is imported, not inlined", /from "\.\.\/src\/lib\/writer-prompt\.mjs"/.test(execSrc));
record("A-line: an illegal directive is refused, not defaulted", /REFUSED - the directive carries a value/.test(execSrc));

const orchSrc = readFileSync(join(ROOT, "tools/cloud-orchestrator.mjs"), "utf8");
record(
  "A-line: the enum repair derives from the taxonomy",
  /setEnum\("category",\s*CATEGORY_SLUGS\[0\],\s*CATEGORY_SLUGS\)/.test(orchSrc) &&
    /setEnum\("audience",\s*AUDIENCE_VALUES\[0\],\s*AUDIENCE_VALUES\)/.test(orchSrc),
);

const researchSrc = readFileSync(join(ROOT, "tools/research.mjs"), "utf8");
record("A-line: subject selection is written for Malaysia", researchSrc.includes("Archipelago AI Wire"));
record(
  "A-line: the subject prompt lists the live categories, not a hardcoded copy",
  researchSrc.includes('"category": "${CATEGORY_SLUGS.join(" | ")}"'),
);
record("A-line: retired enums are gone from the subject prompt", !/"category": "trade-policy/.test(researchSrc));

/* ── report ─────────────────────────────────────────────────────────────────────────────────── */

/* ── sources with an optional URL (command 09, B) ──────────────────────────────────────────── */

const srcLib = await import(pathToFileURL(join(ROOT, "src/lib/sources.mjs")).href);

record("sources: https URL is kept", srcLib.safeSourceUrl("https://www.bnm.gov.my/rates-statistics") === "https://www.bnm.gov.my/rates-statistics");
record("sources: http URL is kept", srcLib.safeSourceUrl("http://example.org/doc").startsWith("http://example.org/doc"));
record("sources: javascript: is refused", srcLib.safeSourceUrl("javascript:alert(1)") === null);
record("sources: data: is refused", srcLib.safeSourceUrl("data:text/html,<script>x</script>") === null);
record("sources: protocol-relative is refused", srcLib.safeSourceUrl("//evil.example/x") === null);
record("sources: relative path is refused", srcLib.safeSourceUrl("/docs/x.pdf") === null);
record("sources: empty is refused", srcLib.safeSourceUrl("   ") === null);
record("sources: garbage is refused", srcLib.safeSourceUrl("not a url") === null);
record("sources: hostless http is refused", srcLib.safeSourceUrl("http:///path") === null);

const mixed = srcLib.toSourceEntries([
  "Plain name with no link",
  { name: "Named with link", url: "https://example.org/a" },
  { name: "Named with a bad link", url: "javascript:alert(1)" },
  { name: "Named with empty link", url: "" },
  { url: "https://example.org/only-url" },
  { name: "   " },
  42,
  null,
]);
record("sources: plain strings survive as names without a link", mixed[0].name === "Plain name with no link" && mixed[0].href === null);
record("sources: a valid URL becomes a link", mixed[1].href === "https://example.org/a");
record("sources: an unsafe URL keeps the name and drops the link", mixed[2].name === "Named with a bad link" && mixed[2].href === null);
record("sources: an empty URL drops the link", mixed[3].href === null);
record("sources: a URL-only entry still renders", mixed[4].href === "https://example.org/only-url");
record("sources: an empty name is dropped", mixed.length === 5, `${mixed.length} entries`);
record("sources: a non-array is tolerated", Array.isArray(srcLib.toSourceEntries(null)) && srcLib.toSourceEntries(null).length === 0);

const articleSrc = readFileSync(join(ROOT, "src/layouts/ArticleLayout.astro"), "utf8");
record("sources: the article layout renders links through the sanitiser", /toSourceEntries\(data\.sources\)/.test(articleSrc));
record("sources: external citation links are nofollow noopener", /rel="nofollow noopener"/.test(articleSrc));

const urlFixture = gate("sources-with-urls.md");
record("gate: object-form sources still satisfy the source count", urlFixture.code === 0, firstLine(urlFixture.out, "RESULT"));
record("gate: it is not warned as having zero sources", !/named sources[^\n]*0 sources/.test(urlFixture.out));

/* ── empty archives are not indexed (command 09, A) ────────────────────────────────────────── */

const archLib = await import(pathToFileURL(join(ROOT, "src/lib/archive-state.mjs")).href);
record("archive: zero is empty", archLib.isEmptyArchive(0) === true);
record("archive: one is not empty", archLib.isEmptyArchive(1) === false);
record("archive: a larger count is not empty", archLib.isEmptyArchive(25) === false);
record("archive: undefined counts as empty", archLib.isEmptyArchive(undefined) === true);
record("archive: NaN counts as empty", archLib.isEmptyArchive(NaN) === true);
record("archive: a negative count is empty", archLib.isEmptyArchive(-3) === true);

const astroCfg = readFileSync(join(ROOT, "astro.config.mjs"), "utf8");
record("sitemap: the noindex filter integration is registered", /sitemapNoindex\(\)/.test(astroCfg));
record("sitemap: the sitemap itself was not disabled", /sitemap\(\{/.test(astroCfg));

const categorySrc2 = readFileSync(join(ROOT, "src/pages/category/[category].astro"), "utf8");
const guideSrc2 = readFileSync(join(ROOT, "src/pages/guide/index.astro"), "utf8");
const topicSrc2 = readFileSync(join(ROOT, "src/pages/topic/index.astro"), "utf8");
record("archive: the category route gates on its own count", /noindex=\{isEmptyArchive\(posts\.length\)\}/.test(categorySrc2));
record("archive: the guide route gates on its own count", /noindex=\{isEmptyArchive\(guides\.length\)\}/.test(guideSrc2));
record("archive: the topic route gates on its own count", /noindex=\{isEmptyArchive\(hubs\.length\)\}/.test(topicSrc2));

/* ── keyboard focus (command 09, C) ────────────────────────────────────────────────────────── */

const css = readFileSync(join(ROOT, "src/styles/global.css"), "utf8");
record("a11y: a global :focus-visible rule exists", /:focus-visible\s*\{/.test(css));
record("a11y: the focus ring uses a design token", /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--c-red\)/.test(css));

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
