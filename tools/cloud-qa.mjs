/**
 * The reviewer. Decides whether a draft may be published.
 *
 *   node tools/cloud-qa.mjs --draft=data/drafts/<slug>.md
 *   node tools/cloud-qa.mjs --draft=... --json
 *
 * ## What it does, in order, and why the order matters
 *
 *   1. L1  the seven gates, run against the draft. Mechanical, and it fails loudly.
 *   2. L2-L4  tools/audit.mjs. Also mechanical: unsourced figures, undisclosed single-source,
 *             fabrication markers, risk triggers.
 *   3. L5  a second model reads the draft and the directive and answers with a structured verdict.
 *
 * The mechanical layers run first on purpose. A model asked to review a draft that has no sources in
 * it will produce a thoughtful paragraph about sourcing, which costs money and changes nothing. The
 * cheap checks remove the drafts that a sentence cannot save.
 *
 * ## The limitation this module states rather than hides
 *
 * The reviewing model reads the draft and the figure records. It does not read the source documents,
 * so it cannot tell a real number from an invented one that carries a real-looking citation. What it
 * can judge is whether the article's own claims are consistent, whether the arithmetic follows from
 * the figures given, whether the confidence section admits what it should, and whether anything
 * crosses a risk line. That is worth having and it is not the same as verification. The distinction
 * is printed on every run so nobody downstream mistakes one for the other.
 *
 * ## Independence
 *
 * The reviewer prefers a different provider from the writer. A model reviewing its own output shares
 * its blind spots; if only one key is present the run proceeds and says the review was not
 * independent, because a silent downgrade is worse than a reported one.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { askJson, summary as providerSummary, usageToday } from "./lib-llm.mjs";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const AS_JSON = args.includes("--json");

const draftPath = flag("draft", null);
if (!draftPath || !existsSync(draftPath)) {
  console.log("usage: node tools/cloud-qa.mjs --draft=data/drafts/<slug>.md [--json]");
  process.exit(2);
}
const slug = draftPath.replace(/\\/g, "/").split("/").pop().replace(/\.md$/, "");
const text = readFileSync(draftPath, "utf8");
const report = { slug, at: new Date().toISOString(), layers: {}, verdict: null, reasons: [] };

/* ---------------------------------------------------------------- L1: the seven gates */

/*
 * The gate reads the article from src/content/blog, so the draft is placed there to be validated and
 * removed afterwards - including the case where the validation itself throws, which is why the
 * removal is in a finally.
 */
/*
 * The gate reads three of its seven checks out of `dist/`: structured data, the content security
 * policy, and the mobile layout. Those pages are built by the workflow, which runs before the writer,
 * so at this point `dist/` describes the site as it was WITHOUT the draft - there is no page for the
 * article being judged.
 *
 * Left alone, the gate would report on a site that does not contain the article, and the three
 * dist-based checks would be measuring nothing while the other four passed. That is the same failure
 * the mobile gate had when it silently skipped on a runner without a browser: a green result on
 * unmeasured input.
 *
 * So the site is rebuilt with the draft staged. It costs a build - about ten seconds here, more on a
 * runner - and it is the difference between checking the article and checking its absence.
 */
const staged = join(BLOG, `${slug}.md`);
let stagedCopy = false;
let buildNote = "";
/*
 * A build failure ends the mechanical layers.
 *
 * It used to be recorded and then the gates were run anyway. That is worse than stopping: `dist/` is
 * whatever the last successful build produced, so the gates report on the previous site while the report
 * implies they reported on this draft. On 2026-10-17 a draft with `stakes: "high"` failed the build with
 * `Invalid option: expected one of "priced"|"directional"`, the gates ran against the old dist and
 * passed, and the pipeline's verdict was "the reviewer did not approve" - three layers of description
 * between the operator and a two-word enum.
 *
 * A draft that cannot compile has not been reviewed. It is not a rejected article; it is an invalid file,
 * and the difference decides who fixes it: the build error names a field and a value, and a model can
 * repair that, whereas "the reviewer did not approve" sends someone to read a review that never happened.
 */
let buildFailed = false;
let buildError = "";
try {
  copyFileSync(draftPath, staged);
  stagedCopy = true;

  try {
    execFileSync("pnpm", ["exec", "astro", "build"], { encoding: "utf8", timeout: 600000, cwd: ROOT, shell: process.platform === "win32" });
    buildNote = "dist rebuilt with the draft staged";
  } catch (e) {
    buildFailed = true;
    /*
     * The useful text is the collection validation error, which Astro writes to stderr. `e.message` is
     * the spawn summary and contains none of it, which is why the first version of this note read
     * "Command failed" and told nobody anything.
     */
    buildError = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    const field = /(?:^|\n)\s*([a-zA-Z_][a-zA-Z0-9_]*):\s*([^\n]{0,160})/m.exec(buildError)?.[0]?.trim() ?? "";
    buildNote = `dist rebuild failed: ${field || String(e.message).slice(0, 120)}`;
  }

  let out = "";
  if (buildFailed) {
    /*
     * Recorded as its own layer with the build's own words. The verdict is REJECTED either way, but the
     * reason reaches the notification, and "stakes is required" is a repair instruction while "the
     * reviewer did not approve" is a puzzle.
     */
    report.layers.build = {
      pass: false,
      detail: `the draft does not match the content schema, so the site does not build: ${buildNote}`,
      error: buildError.slice(0, 600),
    };
    report.reasons.push(`build: the draft fails content validation - ${buildNote}`);
  } else {
    try {
      /*
     * The hard tier only. A network fetch is not allowed to decide whether the day's article is published.
     */
    out = execFileSync(process.execPath, [join(ROOT, "tools", "gate.mjs"), "--tier=hard", "--fresh"], { encoding: "utf8", timeout: 600000 });
    } catch (e) {
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    const passed = /RESULT:\s*every gate passed/i.test(out);
    const failed = [...out.matchAll(/^\s*(?:\[FAIL\]|✗|FAIL)\s*([^\n]{0,110})/gm)].map((m) => m[1].trim()).slice(0, 6);
    report.layers.L1 = {
      pass: passed,
      detail: (passed ? "every gate passed" : `${failed.length} gate failure(s)`) + ` — ${buildNote}`,
      failed,
    };
  }
  /*
   * The soft tier, run and reported but not allowed to block.
   *
   * These are real checks - check-csp exists because a policy once refused every inline script and
   * silently killed every interaction on the site - and they are cheap and offline, so they run on every
   * article. What changed is that a failure is a finding rather than a stopped publication.
   */
  try {
    const softOut = execFileSync(process.execPath, [join(ROOT, "tools", "gate.mjs"), "--tier=soft", "--fresh"], {
      encoding: "utf8",
      timeout: 600000,
    });
    const softPassed = /RESULT:\s*every gate passed/i.test(softOut);
    const softFailed = [...softOut.matchAll(/^\s*(?:\[FAIL\]|✗|FAIL)\s*([^\n]{0,110})/gm)].map((m) => m[1].trim());
    report.layers.advisory = {
      pass: softPassed,
      detail: softPassed ? "csp, structured data and the reviewer found nothing" : `${softFailed.length} finding(s), not blocking`,
      failed: softFailed.slice(0, 6),
    };
    if (!softPassed) report.reasons.push(...softFailed.slice(0, 3).map((f) => `advisory: ${f}`));
  } catch (e) {
    report.layers.advisory = { pass: false, detail: `the advisory tier did not run: ${String(e.message).slice(0, 100)}`, failed: [] };
  }

} finally {
  if (stagedCopy) {
    try {
      rmSync(staged);
    } catch {}
  }
}

/* ---------------------------------------------------------------- L2-L4: the audit */

let audit = null;
try {
  const out = execFileSync(process.execPath, [join(ROOT, "tools", "audit.mjs"), draftPath, "--json"], { encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  audit = JSON.parse(out)?.[0] ?? null;
} catch (e) {
  const out = `${e.stdout ?? ""}`;
  try {
    audit = JSON.parse(out)?.[0] ?? null;
  } catch {}
}
if (audit) {
  for (const key of ["L2", "L3", "L4"]) {
    if (audit.layers?.[key]) report.layers[key] = { pass: audit.layers[key].pass, detail: audit.layers[key].detail };
  }
} else {
  report.layers.L2 = { pass: false, detail: "tools/audit.mjs produced no parseable result" };
}

/* ---------------------------------------------------------------- L5: a second opinion */

const mechanicallyClear = Object.values(report.layers).every((l) => l.pass);
let review = null;

if (!mechanicallyClear) {
  /*
   * The model is not asked. Paying for a paragraph about a draft that already fails on a mechanical
   * check is the obvious waste in this pipeline, and it also trains the reader to skim past the
   * mechanical result, which is the part that is actually reliable.
   */
  report.layers.L5 = { pass: false, detail: "not run - an earlier layer failed" };
  report.reasons.push(...Object.entries(report.layers).filter(([, l]) => !l.pass).map(([k, l]) => `${k}: ${l.detail}`));
} else {
  const directiveFile = flag("directive-file", null);
  const directive = directiveFile && existsSync(directiveFile) ? readFileSync(directiveFile, "utf8").slice(0, 8000) : "";
  const r = await askJson({
    role: "reviewer",
    system:
      "You are the reviewer for an English trade-cost publication. You are not the writer. You decide " +
      "whether a draft may be published unattended. You are shown the draft and the figures it was " +
      "given; you are NOT shown the source documents, so you cannot confirm that a cited figure is " +
      "real - judge only what the draft itself asserts and whether it is internally sound. Be hostile " +
      "to unsupported claims, invented experience, and any drift into political, religious, military " +
      "or reputation commentary. Return only JSON.\n\n" +
      /*
       * The verdict has to be actionable, not just negative.
       *
       * A bare `pass: false` was the whole problem: the writer was told it had failed and nothing else,
       * so its next attempt was a fresh guess at the same task and hit the same wall. Every field below
       * exists because something needs it:
       *
       *   snippet    the writer can find the offending text instead of re-reading 1,800 words
       *   check      which of the six checks failed, so the fix is scoped
       *   rule       a stable key, so the orchestrator can notice the same rule failing twice in a row
       *   fix_type   routes the repair. "research" means the article needs a document nobody fetched,
       *              and no amount of rewriting invents a real number - the loop must stop instead.
       */
      /* The reply was coming back as prose often enough that the run ended REVIEW_UNPARSEABLE with
         nothing to read. The shape is stated first and in one line, because a model asked for a
         paragraph before the JSON writes the paragraph. */
      "Answer with ONE JSON object and nothing else - no preamble, no explanation, no code fence. " +
      "The first character of your reply must be { and the last must be }. " +
      "Required keys: verdict (APPROVED or REJECTED), pass (true or false), issues (an array, " +
      "empty when pass is true). Keep every string under 200 characters.\n\n" +
      "Your verdict must be machine-parseable and actionable. If pass is false, every issue MUST carry " +
      "all five fields:\n" +
      "{\n" +
      '  "check":     one of the check names below, whichever failed,\n' +
      '  "rule":      a short stable label for the rule broken, e.g. "AI summary 60-100 words",\n' +
      '               "stakes enum", "FAQ 3 questions", "single-source not disclosed"\n' +
      '  "snippet":   the EXACT text from the draft that fails, quoted, at most 200 characters,\n' +
      '  "why":       one concrete sentence saying what is wrong with it,\n' +
      '  "fix_type":  one of: "rewrite" | "research" | "add_sentence" | "delete" | "new_decision"\n' +
      "}\n\n" +
      "fix_type means:\n" +
      '  "rewrite"       the wording or structure is wrong and rewriting it can fix it\n' +
      '  "research"      the draft needs a real document it does not have. A figure is missing, or a\n' +
      "                  claim needs a second source. This CANNOT be repaired by rewriting - say so\n" +
      '  "add_sentence"  one disclosure sentence is missing (usually the single-source note)\n' +
      '  "delete"        something invented must be removed\n' +
      '  "new_decision"  a judgement call no rule covers\n\n' +
      "Hard rules:\n" +
      "  1. Never return a bare pass=false. Always cite at least one issue with a snippet.\n" +
      "  2. Order issues most severe first. issues[0] is the blocker.\n" +
      "  3. Quote the draft exactly. A snippet that does not appear in the draft is useless.\n" +
      "  4. Do NOT flag a fact merely because you cannot confirm it. You cannot see the source\n" +
      "     documents. Flag only: internal inconsistency, arithmetic not derivable from the figures\n" +
      "     given, a dishonest confidence section, invented experience, or the risk line being crossed.\n" +
      "  5. After the JSON object, on its own line, write exactly one of:\n" +
      "       VERDICT: APPROVED\n" +
      "       VERDICT: REJECTED\n" +
      "     Nothing after it. This line is read when the JSON cannot be parsed - it has saved a\n" +
      "     publication twice already - so it must be present and exact.",
    messages: [
      {
        role: "user",
        content: `${directive ? `THE DIRECTIVE THE WRITER WAS GIVEN\n${directive}\n\n` : ""}THE DRAFT\n${text.slice(0, 60000)}\n\nAnswer with a JSON object:
{
  "pass": true or false,
  "checks": {
    "claims_follow_from_figures": true/false,
    "arithmetic_is_correct": true/false,
    "confidence_section_is_honest": true/false,
    "no_invented_experience": true/false,
    "no_unsupported_superlative_about_any_country": true/false,
    "risk_line_clear": true/false
  },
  "issues": [
    { "check": "...", "rule": "...", "snippet": "...", "why": "...", "fix_type": "..." }
  ],
  "summary": "one sentence"
}
Set pass to false if any check is false. Every issue needs all five fields.`,
      },
    ],
    /*
     * 8192 rather than 4096. The reviewer reads the whole draft and then writes a verdict; on
     * 2026-10-17 it returned something unparseable and 4096 was tight enough that truncation was a
     * live possibility. The response is small, so this costs almost nothing and removes one way for
     * the review to fail for a reason that has nothing to do with the draft.
     */
    maxTokens: 8192,
  });

  if (!r.ok) {
    report.layers.L5 = { pass: false, detail: `review call failed: ${r.error}` };
    report.reasons.push("L5: the review call failed, so nothing was approved");
  } else if (!r.json && /VERDICT:\s*(APPROVED|REJECTED)/i.test(r.text ?? "")) {
    /*
     * The plain line saved it.
     *
     * A truncated object, a wrapper the extractor could not read, a stray character - the line survives all
     * of those, and twice a real verdict was lost to one of them. The report records that the verdict came
     * from the line rather than from the object, so a thin review is visible as one instead of counting as
     * a full one.
     */
    const line = /VERDICT:\s*(APPROVED|REJECTED)/i.exec(r.text ?? "");
    const approved = line[1].toUpperCase() === "APPROVED";
    review = {
      pass: approved,
      checks: {},
      issues: approved ? [] : [{ check: "", rule: "verdict line only", snippet: "", why: "the reviewer stated REJECTED without an itemised reason", fix_type: "new_decision" }],
      summary: `read from the VERDICT line: ${line[1].toUpperCase()}`,
    };
    report.layers.L5 = {
      pass: approved,
      detail: approved
        ? "approved, read from the VERDICT line because the JSON was unreadable"
        : "rejected, read from the VERDICT line because the JSON was unreadable",
      checks: {},
      issues: review.issues,
      summary: review.summary,
      reviewer: `${r.provider}/${r.model}`,
      readFromVerdictLine: true,
      completionTokens: r.usage?.completion_tokens ?? null,
    };
    if (!approved) report.reasons.push("L5: " + review.issues[0].why);
    report.reasons.push("L5: the JSON was unreadable, so the verdict was taken from the VERDICT line - the itemised detail is missing");
  } else if (!r.json) {
    /*
     * Quote what the reviewer actually returned. On 2026-10-17 this branch fired and the report said
     * "no parseable verdict", which is a description of the symptom and gives the next person nothing
     * to act on - the two likely causes, prose around the object and a response cut off at the token
     * ceiling, need opposite fixes. The head and tail are what tells them apart, and they go into the
     * report so they reach the notification rather than a log nobody opens.
     */
      /* The report keeps the head and tail; the log did not, so every diagnosis of this failure
         was a guess between prose and truncation. Print both where a person will see them. */
      console.log(`  reviewer raw: ${r.parseError ?? "parse failed"} | tokens=${r.usage?.completion_tokens ?? "?"} | head=${String(r.head ?? "").replace(/\s+/g, " ").slice(0, 160)} | tail=${String(r.tail ?? "").replace(/\s+/g, " ").slice(0, 120)}`);

    report.layers.L5 = {
      pass: false,
      detail: `reviewer did not return JSON - ${r.parseError ?? "unknown reason"}`,
      reviewer: `${r.provider}/${r.model}`,
      completionTokens: r.usage?.completion_tokens ?? null,
      responseHead: (r.head ?? "").replace(/\s+/g, " ").slice(0, 300),
      responseTail: (r.tail ?? "").replace(/\s+/g, " ").slice(0, 200),
    };
    report.reasons.push(`L5: reviewer output unparseable - ${r.parseError ?? "unknown reason"}`);
  } else {
    review = r.json;
    /*
     * Two shapes are accepted, because a model that has been asked for objects sometimes returns strings
     * and a rejection is too valuable to discard over its packaging.
     *
     *   { check, rule, snippet, why, fix_type }   what the prompt asks for
     *   "one sentence"                            what the previous version asked for, and what a
     *                                             model falls back to when it is in a hurry
     *
     * `normaliseIssue` keeps the structure where it exists and wraps a bare string so every downstream
     * reader sees the same shape. The `fix_type` default is "rewrite": it is the only type that assumes
     * nothing, and treating an unlabelled objection as a research gap would stop the loop for a reason
     * that may not exist.
     */
    const normaliseIssue = (i) => {
      if (i && typeof i === "object") {
        return {
          check: String(i.check ?? "").slice(0, 60),
          rule: String(i.rule ?? "").slice(0, 120),
          snippet: String(i.snippet ?? "").slice(0, 300),
          why: String(i.why ?? "").slice(0, 400),
          fix_type: ["rewrite", "research", "add_sentence", "delete", "new_decision"].includes(i.fix_type) ? i.fix_type : "rewrite",
        };
      }
      return { check: "", rule: "", snippet: "", why: String(i ?? "").slice(0, 400), fix_type: "rewrite" };
    };
    const issues = (Array.isArray(r.json.issues) ? r.json.issues : []).map(normaliseIssue);
    const structured = issues.filter((i) => i.snippet || i.rule).length;

    report.layers.L5 = {
      pass: r.json.pass === true,
      detail: r.json.pass === true ? "approved by the second model" : `${issues.length} issue(s), ${structured} with a citation`,
      checks: r.json.checks ?? {},
      issues,
      summary: r.json.summary ?? "",
      reviewer: `${r.provider}/${r.model}`,
      independent: r.provider !== (flag("writer-provider", null) ?? r.provider),
    };
    if (r.json.pass !== true) {
      for (const i of issues) {
        const where = i.rule ? `${i.rule}: ` : "";
        const what = i.why || i.snippet || "(no reason given)";
        report.reasons.push(`L5: ${where}${what}`);
      }
      if (!issues.length) report.reasons.push("L5: the reviewer withheld approval without naming an issue");
      /*
       * A rejection with no citation cannot be repaired. The writer would be rewriting blind, which is
       * what the first version of this loop did. Saying so here means the failure is attributed to the
       * reviewer rather than quietly producing another guess.
       */
      if (issues.length && !structured) {
        report.reasons.push("L5: no issue carried a rule or a quoted snippet, so a revision would be guesswork");
      }
    }
    if (!report.layers.L5.independent) {
      report.reasons.push(`L5: the review used ${r.provider}, the same provider as the writer, so it is not an independent check`);
    }
  }
}

/* ---------------------------------------------------------------- verdict */

/*
 * The verdict ignores the advisory layer by name.
 *
 * It used to be `every` over the layers, which is what made seven checks each able to stop a
 * publication. A soft finding is now a finding: it is reported, it reaches the notification, and the
 * article still publishes.
 */
report.verdict = Object.entries(report.layers)
  .filter(([k]) => k !== "advisory")
  .every(([, l]) => l.pass)
  ? "APPROVED"
  : "REJECTED";

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`QA  ${slug}\n${"=".repeat(80)}`);
  console.log(providerSummary());
  console.log("");
  for (const [name, l] of Object.entries(report.layers)) {
    console.log(`  ${l.pass ? "ok  " : "FAIL"} ${name}  ${l.detail}`);
    for (const f of l.failed ?? []) console.log(`         ${f}`);
    for (const i of l.issues ?? []) console.log(`         ${i}`);
  }
  if (review?.checks) {
    console.log("\n  reviewer checks:");
    for (const [k, v] of Object.entries(review.checks)) console.log(`    ${v ? "ok  " : "FAIL"} ${k}`);
  }
  const u = usageToday();
  console.log(`\n  verdict : ${report.verdict}`);
  console.log(`  usage today: ${u.calls} call(s), ${u.failed} failed, ~$${u.usd}, ${u.promptTokens} in / ${u.completionTokens} out`);
  console.log("");
  console.log("  LIMIT: the reviewer read the draft, not the source documents. It can judge whether the");
  console.log("  article is internally sound; it cannot tell a real figure from an invented one that");
  console.log("  carries a real-looking citation. That is what the archived sources are for, and closing");
  console.log("  that gap is the P2 evidence check specified in audit_protocol.md.");
}

if (report.verdict === "REJECTED") {
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const p = join(ROOT, "logs", `alert-qa-${slug}-${stamp}.txt`);
  writeFileSync(
    p,
    ["QA REJECTED", `article : ${slug}`, `time    : ${new Date().toISOString()}`, "", ...report.reasons.map((r) => "  " + r), "", "The draft is in data/drafts/ and was not staged for publish."].join("\r\n"),
    "utf8",
  );
  const say = AS_JSON ? console.error : console.log;
  say(`\n  alert written: ${p}`);
}

process.exit(report.verdict === "APPROVED" ? 0 : 1);
