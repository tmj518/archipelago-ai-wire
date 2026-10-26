#!/usr/bin/env node
/**
 * Drive the orchestrator's exit paths locally, with the model calls stubbed out.
 *
 * ## Why this exists
 *
 * Ten runs failed on 2026-10-16/17 and three of those were bugs in code written the same day: a module
 * loader crash that did not reproduce locally, a `let` scoped inside a loop and read after it, and a
 * schema check that discarded a whole article over three characters. Each was pushed after a local check
 * that could not have caught it - `node --check` passes a dangling reference, and running the writer
 * alone never reaches the loop's third iteration.
 *
 * The habit that produced them was: edit, parse, push, ask the operator to press the button. That makes
 * the operator the test harness, and it costs a full CI cycle to learn something that is testable here in
 * seconds.
 *
 * So this runs the real orchestrator as a child process with the real subprocess boundary, and replaces
 * only its two children - the writer and the reviewer - with stubs. Editing the orchestrator to accept
 * fake children would mean the thing under test is not the thing that ships.
 *
 * ## What it proves, and what it does not
 *
 * It proves the control flow terminates and reports on every path, that nothing is referenced outside its
 * scope, and that the revision loop stops. It says nothing about model output quality, and it cannot
 * catch a wrong prompt - only a wrong program.
 *
 *   node tools/rehearse.mjs
 *   node tools/rehearse.mjs --list
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SANDBOX = join(ROOT, "data", "tmp", "rehearse");

/**
 * scenario: what the writer does on each successive call, what the reviewer does, and the verdict the
 * orchestrator must produce. The last element of each array is reused if the loop runs longer.
 */
const SCENARIOS = [
  { name: "happy path", w: ["write"], q: ["approve"], verdict: "PUBLISHED", writerCalls: 1 },
  { name: "rejected once, revision approved", w: ["write"], q: ["reject", "approve"], verdict: "PUBLISHED", writerCalls: 2 },
    /*
   * Three rejections now publish, with the objections recorded. The mechanical layers passed, and the
   * operator's instruction was that a second opinion must not stop the first opinion existing. The
   * rehearsal asserts the advisory record rather than the verdict alone - "published with objections" and
   * "published clean" are different facts and the card distinguishes them.
   */
  { name: "rejected every time publishes with objections", w: ["write"], q: ["reject"], verdict: "PUBLISHED", writerCalls: 3, contains: "advisory" },
  { name: "schema violation then repair", w: ["invalid", "write"], q: ["approve"], verdict: "PUBLISHED", writerCalls: 2 },
  { name: "schema violation every time", w: ["invalid"], q: ["approve"], verdict: "WRITE-FAILED", writerCalls: 3 },
  { name: "writer produces nothing", w: ["nothing"], q: ["approve"], verdict: "WRITE-FAILED", writerCalls: 1, contains: "Cannot find module", notContains: "Node.js v24" },
    /*
   * An unreadable review now publishes, and records why.
   *
   * This scenario expected REJECTED and the change to publish-without-a-review is deliberate: the operator's
   * instruction was that a reviewer which fails or cannot be parsed must not stop the article, and that the
   * fact must be carried into the next run's prompt. The assertion follows the behaviour, and the extra
   * check makes sure the recording happened - a publish without the lesson would be the silent version.
   */
  {
    name: "reviewer unparseable publishes with a lesson",
    w: ["write"],
    q: ["unparseable"],
    verdict: "PUBLISHED",
    writerCalls: 1,
    contains: "recorded as a lesson",
  },
    { name: "revision gets worse still publishes", w: ["write"], q: ["mild", "severe", "severe"], verdict: "PUBLISHED", writerCalls: 3, contains: "advisory" },
  {
    name: "reviewer asks for research",
    w: ["write"],
    q: ["research"],
    verdict: "REQUIRES-RESEARCH",
    writerCalls: 1,
    contains: "rewriting cannot supply a real figure",
  },
  {
    name: "the same rule fails twice",
    w: ["write"],
    q: ["same-rule", "same-rule", "same-rule"],
    verdict: "WRITE-FAILED",
    writerCalls: 2,
    contains: "the same rule failed twice in a row",
  },
  {
    /*
     * The subject is already published, so the run must stop before writing.
     *
     * This is the case that replaced a live article on 2026-10-17 at 06:12. It asserts the verdict and that the
     * writer was never called - the second matters more: a guard that stops the publish but still spends a model
     * call has saved nothing worth saving.
     */
    name: "an already-published subject is refused",
    alreadyPublished: true,
    w: ["write"],
    q: ["approve"],
    verdict: "DUPLICATE-SUBJECT",
    writerCalls: 0,
    contains: "already published",
  },
  { name: "weekly ceiling reached", ceiling: true, verdict: "CEILING", writerCalls: 0 },
  { name: "no credentials", keys: false, verdict: "NO-KEYS", writerCalls: 0 },
  /*
   * "Too few figures" is no longer a reachable state. The floor went to one on the operator's instruction, and a
   * directive with zero figures is not thin, it is unusable - usableDirective() rejects it and research runs. The
   * scenario was proving a branch that can no longer be entered, and it started calling the real API to get there.
   */
];

if (process.argv.includes("--list")) {
  for (const s of SCENARIOS) console.log("  " + s.verdict.padEnd(14) + s.name);
  process.exit(0);
}

/* ---------------------------------------------------------------- the stubs */

const WRITER_STUB = `import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const counter = process.env.STUB_COUNTER;
const seq = (process.env.STUB_WRITER_SEQ || "write").split(",");
let n = 0;
try { n = JSON.parse(readFileSync(counter, "utf8")).writer || 0; } catch {}
try { writeFileSync(counter, JSON.stringify({ writer: n + 1, reviewer: (JSON.parse(readFileSync(counter, "utf8")).reviewer) || 0 }), "utf8"); } catch {}
const mode = seq[Math.min(n, seq.length - 1)];
const dir = join(process.cwd(), "data", "drafts");
mkdirSync(dir, { recursive: true });
console.log("EXECUTOR stub call=" + (n + 1) + " mode=" + mode);
if (mode === "nothing") {
  console.log("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/repo/src/lib/schema-rules.mjs'");
  console.log("    at finalizeResolution (node:internal/modules/esm/resolve:272:11)");
  console.log("    at moduleResolve (node:internal/modules/esm/resolve:879:7)");
  console.log("");
  console.log("Node.js v24.21.0");
  process.exit(1);
}
if (mode === "invalid") {
  console.log("  REFUSED - subtitle is 400 characters and the schema allows 160");
  const v = process.env.EXECUTOR_VIOLATIONS;
  if (v) writeFileSync(v, JSON.stringify({ layers: { L5: { pass: false, issues: ["subtitle is 400 characters, the schema allows 160"] } }, reasons: ["subtitle is 400 characters"] }), "utf8");
  process.exit(4);
}
writeFileSync(join(dir, "rehearse-subject.md"), "---\\ntitle: \\"A rehearsed title\\"\\nsubtitle: \\"Short enough\\"\\ndescription: \\"Short enough\\"\\npublishDate: 2026-10-17\\ncategory: trade-policy\\n---\\n\\n## AI Summary\\n\\nBody.\\n", "utf8");
console.log("  written   : data/drafts/rehearse-subject.md");
process.exit(0);
`;

const REVIEWER_STUB = `import { readFileSync, writeFileSync } from "node:fs";
const counter = process.env.STUB_COUNTER;
const seq = (process.env.STUB_REVIEWER_SEQ || "approve").split(",");
let st = { writer: 0, reviewer: 0 };
try { st = JSON.parse(readFileSync(counter, "utf8")); } catch {}
const n = st.reviewer || 0;
st.reviewer = n + 1;
try { writeFileSync(counter, JSON.stringify(st), "utf8"); } catch {}
const which = seq[Math.min(n, seq.length - 1)];
const L = (pass, checks = {}, issues = []) => ({ pass, detail: pass ? "approved" : issues.length + " issue(s)", checks, issues });
let layers;
if (which === "approve") layers = { L1: L(true), L2: L(true), L5: L(true, { claims_follow_from_figures: true }, []) };
else if (which === "reject") layers = { L1: L(true), L5: L(false, { claims_follow_from_figures: false, arithmetic_is_correct: false }, ["The arithmetic does not follow.", "The confidence section overstates."]) };
else if (which === "mild") layers = { L1: L(true), L5: L(false, { claims_follow_from_figures: false }, ["One objection."]) };
else if (which === "severe") layers = { L1: L(true), L5: L(false, { claims_follow_from_figures: false, arithmetic_is_correct: false, risk_line_clear: false }, ["A.", "B.", "C.", "D."]) };
else if (which === "research") layers = { L1: L(true), L5: L(false, { claims_follow_from_figures: true, arithmetic_is_correct: false }, [{ check: "arithmetic_is_correct", rule: "every figure must cite a real instrument", snippet: "Duty drops by 12% after the April waiver.", why: "The 12% figure appears in no directive figure record.", fix_type: "research" }]) };
else if (which === "same-rule") layers = { L1: L(true), L5: L(false, { confidence_section_is_honest: false }, [{ check: "confidence_section_is_honest", rule: "single-source claim must be disclosed", snippet: "**Inferred.** The waiver will be renewed.", why: "Single-source claim with no disclosure.", fix_type: "add_sentence" }]) };
else layers = { L5: { pass: false, detail: "reviewer did not return JSON - the response ran to the 8192-token ceiling", checks: {}, issues: [] } };
const verdict = Object.values(layers).every((l) => l.pass) ? "APPROVED" : "REJECTED";
console.log(JSON.stringify({ slug: "rehearse-subject", layers, verdict, reasons: verdict === "APPROVED" ? [] : (layers.L5.issues || ["the reviewer did not approve"]).map((i) => "L5: " + (i && typeof i === "object" ? (i.rule || i.why || "issue") : i)) }, null, 2));
process.exit(verdict === "APPROVED" ? 0 : 1);
`;

/* ---------------------------------------------------------------- harness */

function buildWorkdir(s, index) {
  const work = join(SANDBOX, `work-${index}`);
  rmSync(work, { recursive: true, force: true });
  for (const d of ["tools", "src/content/blog", "src/data", "src/lib", "data/tmp"]) mkdirSync(join(work, d), { recursive: true });

  /*
   * src/lib as well as the tools.
   *
   * The writers and gates share modules with the site - prose.mjs counts the words, schema-rules.mjs defines the
   * fields, figure-limits.mjs holds the figure count - and a tool that imports one of them fails in the sandbox with
   * ERR_MODULE_NOT_FOUND unless the directory is copied. The agent rehearsal has copied it for months; this one did
   * not, because until the figure rules moved nothing on the orchestrator's path imported from src/lib.
   */
  for (const f of readdirSync(join(ROOT, "src", "lib"))) {
    if (f.endsWith(".mjs")) copyFileSync(join(ROOT, "src", "lib", f), join(work, "src", "lib", f));
  }

  /*
   * Copy every tool, then overwrite the two under test.
   *
   * An earlier version copied only the three files this harness reasoned about, and the orchestrator
   * failed on the fourth - it rebuilds the instrument registry partway through, and that module was not
   * there. Copying the directory removes the whole class of "which file does this path need" questions;
   * the files are small and a scratch copy is cheap.
   */
  for (const f of readdirSync(join(ROOT, "tools"))) {
    if (f.endsWith(".mjs")) copyFileSync(join(ROOT, "tools", f), join(work, "tools", f));
  }
  writeFileSync(join(work, "tools", "cloud-executor.mjs"), WRITER_STUB, "utf8");
  writeFileSync(join(work, "tools", "cloud-qa.mjs"), REVIEWER_STUB, "utf8");

  /* The registry the publish step rewrites. */
  writeFileSync(join(work, "src", "data", "instruments.json"), JSON.stringify({ instruments: [] }), "utf8");
  writeFileSync(join(work, "data", "ledger.jsonl"), "", "utf8");

  /* One published article so the section-coverage check has something to count. */
  writeFileSync(
    join(work, "src", "content", "blog", "existing.md"),
    '---\ntitle: "Existing"\nsubtitle: "s"\ndescription: "d"\npublishDate: 2026-10-01\ncategory: trade-policy\narticleNumber: 1\n---\n\nBody.\n',
    "utf8",
  );

  /*
   * A scenario can ask for its subject to be already published, which is what the duplicate guard exists for.
   * Seeding the file rather than faking the check means the guard runs against the same filesystem test a real
   * run would: the collection is the authority.
   */
  if (s.alreadyPublished) {
    writeFileSync(
      join(work, "src", "content", "blog", "rehearse-subject.md"),
      '---\ntitle: "Already here"\nsubtitle: "s"\ndescription: "d"\npublishDate: 2026-10-01\ncategory: trade-policy\narticleNumber: 99\n---\n\nBody.\n',
      "utf8",
    );
  }

  writeFileSync(
    join(work, "data", "directive.json"),
    JSON.stringify(
      {
        slug: "rehearse-subject",
        keyword: "rehearsal",
        category: "trade-policy",
        audience: "importer",
        figures: Array.from({ length: s.figures ?? 14 }, (_, i) => ({ value: String(i + 1), unit: "percent", period: "2026", source: "Official Gazette", retrieved: "2026-10-17" })),
        sources: ["Official Gazette, 2026"],
      },
      null,
      2,
    ),
    "utf8",
  );

  if (s.ceiling) {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    for (let i = 0; i < 16; i++) {
      writeFileSync(
        join(work, "src", "content", "blog", `filler-${i}.md`),
        `---\ntitle: "Filler ${i}"\nsubtitle: "s"\ndescription: "d"\npublishDate: ${monday.toISOString().slice(0, 10)}\ncategory: trade-policy\narticleNumber: ${i + 2}\n---\n\nBody.\n`,
        "utf8",
      );
    }
  }

  const counter = join(work, "data", "tmp", "calls.json");
  writeFileSync(counter, JSON.stringify({ writer: 0, reviewer: 0 }), "utf8");
  return { work, counter };
}

function runScenario(s, index) {
  const { work, counter } = buildWorkdir(s, index);
  const env = { ...process.env, STUB_COUNTER: counter, STUB_WRITER_SEQ: (s.w ?? ["write"]).join(","), STUB_REVIEWER_SEQ: (s.q ?? ["approve"]).join(",") };

  if (s.keys === false) {
    for (const k of ["ARK_API_KEY", "ARK_MODEL", "OWNER_KEY_1", "OWNER_KEY_2", "DEEPSEEK_API_KEY", "DEEPSEEK_REVIEW_API_KEY", "DEEPSEEK_WRITE_API_KEY"]) delete env[k];
  } else {
    env.OWNER_KEY_1 = "ark-placeholder";
    env.OWNER_KEY_2 = "sk-placeholder";
    env.ARK_MODEL = "ep-placeholder";
  }

  let out = "";
  try {
    out = execFileSync(process.execPath, [join(work, "tools", "cloud-orchestrator.mjs")], { encoding: "utf8", cwd: work, timeout: 120000, env });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }

  const reportPath = join(work, "data", "tmp", "orchestrator-report.json");
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      report = null;
    }
  }
  let calls = { writer: 0, reviewer: 0 };
  try {
    calls = JSON.parse(readFileSync(counter, "utf8"));
  } catch {}
  return { out, report, calls };
}

/* ---------------------------------------------------------------- run */

rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

console.log("REHEARSAL - every exit path of the orchestrator, model stubbed");
console.log("=".repeat(78));
console.log("");

let pass = 0;
const failures = [];

SCENARIOS.forEach((s, i) => {
  const { out, report, calls } = runScenario(s, i);
  const problems = [];
  if (!report) problems.push("no report written - the orchestrator died before finishing");
  else if (report.verdict !== s.verdict) problems.push(`verdict ${report.verdict}, expected ${s.verdict}`);
  if (s.contains && report && !JSON.stringify(report).includes(s.contains)) problems.push(`report lacks "${s.contains}"`);
  if (s.notContains && report && JSON.stringify(report).includes(s.notContains)) problems.push(`report contains "${s.notContains}", so the real error was lost`);
  if (s.writerCalls != null && calls.writer !== s.writerCalls) problems.push(`writer called ${calls.writer} time(s), expected ${s.writerCalls}`);

  if (problems.length) {
    failures.push({ name: s.name, problems, out });
    console.log(`  FAIL  ${s.name}`);
    for (const p of problems) console.log(`          ${p}`);
  } else {
    pass++;
    console.log(`  ok    ${s.name.padEnd(38)} ${String(report.verdict).padEnd(14)} writer x${calls.writer}`);
  }
});

console.log("");
console.log(`  ${pass} passed, ${failures.length} failed`);

if (failures.length) {
  const f = failures[0];
  console.log("");
  console.log("  A failing scenario here is a program error, not a model error. Full output of the first");
  console.log("  failure, because the alternative is asking someone to run it and report back:");
  console.log("");
  console.log("  --- " + f.name + " ---");
  for (const line of String(f.out).split("\n").slice(-45)) console.log("    " + line);
  process.exit(1);
}
console.log("");
console.log("  Every path terminates and writes a report.");
