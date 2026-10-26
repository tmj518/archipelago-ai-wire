#!/usr/bin/env node
/**
 * Drive tools/agent-run.mjs with a scripted model, so the loop and the guards are tested offline.
 *
 * The agent loop has three properties that matter and none of them can be checked by reading it:
 *
 *   1. it terminates, whatever the model does
 *   2. the guards hold - the allowlist, the collection write refusal, the check-before-publish rule
 *   3. a run that cannot finish reports a verdict instead of looping until the turn limit
 *
 * The model is replaced by a script that returns predetermined tool calls, one per turn, by copying the
 * real lib-llm.mjs aside and putting a stub in its place inside a scratch tree. The agent under test is
 * the real file, because editing it to accept fake replies would mean testing something other than what
 * ships - the same rule tools/rehearse.mjs follows for the orchestrator.
 *
 *   node tools/rehearse-agent.mjs
 *   node tools/rehearse-agent.mjs --list
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SANDBOX = join(ROOT, "data", "tmp", "rehearse-agent");

/**
 * A scenario is a script of turns. Each entry is the tool calls the fake model makes on that turn; an
 * empty array means it answered in prose. The assertions are on the verdict, on what got published, and
 * on what the transcript says was refused.
 */
const SCENARIOS = [
  {
    name: "happy path: write, check, publish, finish",
    why: "the loop must be able to complete the day's work",
    turns: [
      [{ name: "list_dir", args: { path: "src/content/blog" } }],
      [{ name: "write_file", args: { path: "data/drafts/rehearsed.md", content: "---\ntitle: \"x\"\npublishDate: 2026-10-19\ncategory: trade-policy\nstakes: directional\naudience: both\ninformation_gain: primary-source\npriority: P2\ndraft: false\n---\n\n" + "The duty adds a measurable amount to every shipment, and the amount is what this paragraph exists to make long enough for the publish gate, which refuses a file under two hundred characters as effectively empty. ".repeat(3) } }],
      [{ name: "check_draft", args: { path: "data/drafts/rehearsed.md" } }],
      [{ name: "publish_draft", args: { path: "data/drafts/rehearsed.md" } }],
      [{ name: "finish", args: { verdict: "PUBLISHED", summary: "one article" } }],
    ],
    verdict: "PUBLISHED",
    published: ["rehearsed"],
  },
  {
    name: "publish without a green check is allowed",
    why: "an article reaches the collection only through the checks, and the refusal must be visible",
    turns: [
      [{ name: "write_file", args: { path: "data/drafts/x.md", content: "---\ntitle: \"x\"\npublishDate: 2026-10-19\ncategory: trade-policy\nstakes: directional\naudience: both\ninformation_gain: primary-source\npriority: P2\ndraft: false\n---\n\n" + "The duty adds a measurable amount to every shipment, and the amount is what this paragraph exists to make long enough for the publish gate, which refuses a file under two hundred characters as effectively empty. ".repeat(3) } }],
      [{ name: "publish_draft", args: { path: "data/drafts/x.md" } }],
      [{ name: "check_draft", args: { path: "data/drafts/x.md" } }],
      [{ name: "publish_draft", args: { path: "data/drafts/x.md" } }],
      [{ name: "finish", args: { verdict: "PUBLISHED", summary: "after the checks" } }],
    ],
    verdict: "PUBLISHED",
    published: ["x"],
  },
  {
    name: "over-long fields are trimmed, not rejected",
    why: "194 characters against a limit of 160 is arithmetic, not judgement, and must not cost a round",
    turns: [
      [
        {
          name: "write_file",
          args: {
            path: "data/drafts/long.md",
            content:
              '---\ntitle: "A title"\nsubtitle: "' +
              "A subtitle that runs well past one hundred and sixty characters because that is exactly what the agent produced in the failing run, and it keeps going for a while yet to be sure it is over\n".replace("\\n", "") +
              '\ndescription: "' +
              "A description that is also far too long. ".repeat(12) +
              '\npublishDate: 2026-10-17\ncategory: trade-policy\nstakes: directional\naudience: importer\n---\n\n## AI Summary\n\nBody.\n"',
          },
        },
      ],
      [{ name: "check_draft", args: { path: "data/drafts/long.md" } }],
      [{ name: "publish_draft", args: { path: "data/drafts/long.md" } }],
      [{ name: "finish", args: { verdict: "PUBLISHED", summary: "trimmed and published" } }],
    ],
    verdict: "PUBLISHED",
    published: ["long"],
    transcriptContains: "Trimmed before checking",
  },
  {
    name: "writing the collection directly is refused",
    why: "the agent must not be able to bypass the checks by writing the file itself",
    turns: [
      [{ name: "write_file", args: { path: "src/content/blog/bypass.md", content: "---\ntitle: \"x\"\npublishDate: 2026-10-19\ncategory: trade-policy\nstakes: directional\naudience: both\ninformation_gain: primary-source\npriority: P2\ndraft: false\n---\n\n" + "The duty adds a measurable amount to every shipment, and the amount is what this paragraph exists to make long enough for the publish gate, which refuses a file under two hundred characters as effectively empty. ".repeat(3) } }],
      [{ name: "finish", args: { verdict: "NO-SUBJECT", summary: "could not write" } }],
    ],
    verdict: "NO-SUBJECT",
    published: [],
    transcriptContains: "src/content/blog/ is off limits",
  },
  {
    name: "a forbidden command is refused",
    why: "the allowlist is the boundary between assistance and drift",
    turns: [
      [{ name: "run", args: { command: "git push --force origin main" } }],
      /*
       * An allowed command, deliberately a cheap one. This was `node tools/preflight.mjs`, and preflight
       * inside the sandbox prints its whole check list against a tree that is incomplete on purpose -
       * tens of thousands of characters into a single tool result, which crowded out the rest of the
       * conversation and left the loop at its turn limit with no report at all. The output cap in
       * agent-run.mjs is the real fix; this is the scenario not asking for the worst case on purpose.
       */
      [{ name: "run", args: { command: "node tools/qa-check.mjs --all" } }],
      [{ name: "finish", args: { verdict: "NO-SUBJECT", summary: "ran the allowed one" } }],
    ],
    verdict: "NO-SUBJECT",
    transcriptContains: "REFUSED",
  },
  {
    name: "finish is refused when the verdict lies",
    why: "a report of PUBLISHED with nothing published is the failure that loses a day silently",
    turns: [
      [{ name: "finish", args: { verdict: "PUBLISHED", summary: "claiming success" } }],
      [{ name: "finish", args: { verdict: "NO-SUBJECT", summary: "honest this time" } }],
    ],
    verdict: "NO-SUBJECT",
    transcriptContains: "verdict says PUBLISHED but nothing was published",
  },
  {
    name: "a repeated call is answered, not re-run",
    why: "four reads of the same file cost sixteen turns in the run that failed",
    turns: [
      [{ name: "read_file", args: { path: "daily-task.txt" } }],
      [{ name: "read_file", args: { path: "daily-task.txt" } }],
      [{ name: "read_file", args: { path: "daily-task.txt" } }],
      [
        {
          name: "write_file",
          args: {
            path: "data/drafts/repeat.md",
            content:
              '---\ntitle: "A title"\nsubtitle: "A subtitle that is short enough to pass the schema check"\ndescription: "A description that is also short enough to pass the schema check on the first attempt."\npublishDate: 2026-10-17\ncategory: trade-policy\nstakes: directional\naudience: importer\n---\n\n## AI Summary\n\nBody.\n"',
          },
        },
      ],
      [{ name: "check_draft", args: { path: "data/drafts/repeat.md" } }],
      [{ name: "publish_draft", args: { path: "data/drafts/repeat.md" } }],
      [{ name: "finish", args: { verdict: "PUBLISHED", summary: "wrote after three redundant reads" } }],
    ],
    verdict: "PUBLISHED",
    published: ["repeat"],
    transcriptContains: "answered from memory",
  },
  {
    /*
     * A model that keeps reading is cut off at PREP_TURNS and told to write.
     *
     * The run that failed read six documents and ran ten checks for twenty-four turns. The prompt said the
     * reading phase ended at turn ten and nothing enforced it. This asserts the refusal reaches the model - if
     * it does not, the wall is only a paragraph.
     */
    name: "preparation runs out and reading is refused",
    turns: Array.from({ length: 14 }, () => [
      { name: "read_file", args: { path: "README.md" } },
    ]),
    verdict: "TURN-LIMIT",
    published: [],
    transcriptContains: "preparation is over",
  },
  {
    /*
     * One command, run five times with a different range each time.
     *
     * Turns 25 to 40 of the failing run were exactly this: the same tool paged with a moving sed window. The
     * guard keys on the command base, so a changed range is the same command.
     */
    name: "one command run five times is refused",
    turns: Array.from({ length: 5 }, (_, i) => [
      { name: "run", args: { command: `node tools/qa-check.mjs --all 2>&1 | sed -n '${30 + i * 2},${36 + i * 2}p'` } },
    ]),
    verdict: "TURN-LIMIT",
    published: [],
    transcriptContains: "same command",
  },
  {
    name: "a model that only talks",
    why: "the loop must end, and it must report a verdict rather than running to the turn limit quietly",
    turns: [[], [], [], []],
    verdict: "TURN-LIMIT",
    maxTurns: 3,
  },
  {
    name: "a model that calls an unknown tool",
    why: "an invented tool must be reported to the model, not crash the run",
    turns: [
      [{ name: "delete_everything", args: {} }],
      [{ name: "finish", args: { verdict: "NO-SUBJECT", summary: "unknown tool" } }],
    ],
    verdict: "NO-SUBJECT",
    transcriptContains: "unknown tool",
  },
];

if (process.argv.includes("--list")) {
  for (const s of SCENARIOS) console.log(`  ${s.verdict.padEnd(14)} ${s.name}`);
  process.exit(0);
}

/** The stub answers with the tool calls the current turn's script names, in OpenAI shape. */
const LLM_STUB = `let turn = 0;
const script = JSON.parse(process.env.STUB_TURNS || "[]");
export async function ask() {
  const calls = script[turn] ?? [];
  turn++;
  return {
    ok: true,
    provider: "stub",
    model: "stub",
    text: calls.length ? "" : "I am thinking about it.",
    toolCalls: calls.map((c, i) => ({ id: "call_" + turn + "_" + i, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })),
    rawMessage: { role: "assistant", content: calls.length ? null : "I am thinking about it.", tool_calls: calls.map((c, i) => ({ id: "call_" + turn + "_" + i, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) },
    usage: { prompt_tokens: 10, completion_tokens: 10 },
    estimatedUsd: 0,
  };
}
export function summary() { return "  providers: stubbed"; }
export function usageToday() { return { calls: 1, failed: 0, usd: 0 }; }
`;

/** The stub checker approves, so the publish path can be exercised. */
/** The structure check reports nothing blocked, so the publish path can be exercised against a fixture. */
const QA_CHECK_STUB = 'console.log(JSON.stringify({ blocked: false, blockingCount: 0, unguided: [], results: [] }));';
const QA_STUB = `console.log(JSON.stringify({ verdict: "APPROVED", layers: { L1: { pass: true }, L5: { pass: true } }, reasons: [] }));
process.exit(0);
`;

const BUILD_STUB = `process.exit(0);`;

function buildWorkdir(s, index) {
  const work = join(SANDBOX, `work-${index}`);
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  for (const d of ["tools", "src/content/blog", "src/data", "src/lib", "data/drafts", "data/tmp", "docs"]) mkdirSync(join(work, d), { recursive: true });
  /*
   * The constraint table travels with the sandbox. check_draft shells out to trim-draft, which imports it,
   * and a sandbox without it made the trim fail silently - the draft stayed over the limit, the scenario
   * failed, and the failure looked like a broken guard rather than a missing file.
   */
  for (const f of readdirSync(join(ROOT, "src", "lib"))) {
    if (f.endsWith(".mjs")) copyFileSync(join(ROOT, "src", "lib", f), join(work, "src", "lib", f));
  }

  for (const f of readdirSync(join(ROOT, "tools"))) {
    if (f.endsWith(".mjs")) copyFileSync(join(ROOT, "tools", f), join(work, "tools", f));
  }
  /* The model, the reviewer and the registry rebuild are the three things the loop talks to. */
  writeFileSync(join(work, "tools", "lib-llm.mjs"), LLM_STUB, "utf8");
  writeFileSync(join(work, "tools", "cloud-qa.mjs"), QA_STUB, "utf8");
  writeFileSync(join(work, "tools", "qa-check.mjs"), QA_CHECK_STUB, "utf8");
  writeFileSync(join(work, "tools", "build-instruments.mjs"), BUILD_STUB, "utf8");

  writeFileSync(join(work, "src", "data", "instruments.json"), JSON.stringify({ instruments: [] }), "utf8");
  writeFileSync(join(work, "data", "ledger.jsonl"), "", "utf8");
  writeFileSync(join(work, "daily-task.txt"), "Rehearsal instructions. Do the day's work.\n", "utf8");
  return work;
}

function runScenario(s, index) {
  const work = buildWorkdir(s, index);
  const env = { ...process.env, STUB_TURNS: JSON.stringify(s.turns), OWNER_KEY_1: "ark-x", OWNER_KEY_2: "sk-y", ARK_MODEL: "ep-z" };
  let out = "";
  try {
    out = execFileSync(process.execPath, [join(work, "tools", "agent-run.mjs"), `--max-turns=${s.maxTurns ?? 10}`], { encoding: "utf8", cwd: work, timeout: 120000, env });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const reportPath = join(work, "data", "tmp", "agent-report.json");
  const transcriptPath = join(work, "data", "tmp", "agent-transcript.jsonl");
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      report = null;
    }
  }
  const transcript = existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : "";
  return { out, report, transcript };
}

/*
 * A failed cleanup must not fail the rehearsal. On Windows rmSync throws ENOTEMPTY when a file is still
 * held - an editor, an indexer, an antivirus scan - and the first version let that escape and killed the
 * whole run, so a guard that worked was reported as broken because the previous scenario's directory
 * could not be deleted. The sandbox is rebuilt per scenario anyway; clearing it is an optimisation.
 */
function clearSandbox() {
  try {
    rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* a scenario builds its own clean work directory, so a stale parent is harmless */
  }
}

clearSandbox();
try { mkdirSync(SANDBOX, { recursive: true }); } catch {}

console.log("AGENT REHEARSAL - the loop and its guards, model stubbed");
console.log("=".repeat(78));
console.log("");

let pass = 0;
const failures = [];

SCENARIOS.forEach((s, i) => {
  const { out, report, transcript } = runScenario(s, i);
  const problems = [];
  if (!report) problems.push("no report written - the agent died before finishing");
  else {
    if (report.verdict !== s.verdict) problems.push(`verdict ${report.verdict}, expected ${s.verdict}`);
    if (s.published) {
      const got = [...(report.published ?? [])].sort().join(",");
      const want = [...s.published].sort().join(",");
      if (got !== want) problems.push(`published [${got}], expected [${want}]`);
    }
  }
  if (s.transcriptContains && !transcript.includes(s.transcriptContains)) {
    problems.push(`the transcript does not contain "${s.transcriptContains}", so that guard did not fire`);
  }

  if (problems.length) {
    failures.push({ name: s.name, problems, out });
    console.log(`  FAIL  ${s.name}`);
    for (const p of problems) console.log(`          ${p}`);
  } else {
    pass++;
    console.log(`  ok    ${s.name.padEnd(46)} ${String(report.verdict).padEnd(12)} ${(report.published ?? []).length} published`);
  }
});

console.log("");
console.log(`  ${pass} passed, ${failures.length} failed`);

if (failures.length) {
  const f = failures[0];
  console.log("");
  console.log("  A failing scenario is a program error, not a model error. Full output of the first:");
  console.log("");
  console.log("  --- " + f.name + " ---");
  for (const line of String(f.out).split("\n").slice(-40)) console.log("    " + line);
  process.exit(1);
}
console.log("");
console.log("  The loop terminates, the guards hold, and every path writes a report.");
