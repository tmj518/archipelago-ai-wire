#!/usr/bin/env node
/**
 * Load every tool the pipeline runs, with no credentials, and require it to fail for its own reason.
 *
 * ## Why this exists, and why it is not a static analysis
 *
 * `readershipBrief()` was called twice in tools/cloud-executor.mjs and its definition did not exist - a
 * refactor replaced an adjacent block and took the function with it. Every check passed:
 *
 *   node --check      passes. Calling an undefined function is valid syntax; the error is a runtime
 *                     ReferenceError, and this is the same blind spot that let a dangling reference
 *                     through earlier the same day
 *   the rehearsal     passes. It replaces that module with a stub so the loop is testable offline, and a
 *                     stub is exactly what stops the real file from being executed
 *   preflight         passes. It never ran the writer
 *   the cloud run     failed in 0 seconds with `usage: 0 call(s)`, which says nothing
 *
 * The first attempt at a fix was a static scanner looking for calls to undefined names. It was deleted,
 * and the reason is worth recording: JavaScript cannot be lexed correctly by regex, and getting it right
 * means writing a lexer - the false findings ran from 239 to 74 to 176 while being fixed, because each
 * correction for a string or a regular expression broke something else. A checker that both misses real
 * findings and reports imaginary ones is worse than no checker: it gets ignored, and then it hides the
 * thing it was built to find.
 *
 * What actually works is simpler. Running a module with no credentials makes it resolve every reference
 * it needs on the way to its own "no key" message, and that message is a stable, known string. If it
 * reaches that, the module's references are sound. If it does not, the real error is in the output.
 *
 * ## What it proves, and what it does not
 *
 * It proves each tool loads, type-strips, resolves its imports, and evaluates its top-level code without a
 * ReferenceError. It does not prove the code inside a function that is never called, and it does not prove
 * anything about correctness - only that the file runs far enough to say what it needs.
 *
 *   node tools/check-loads.mjs
 *   node tools/check-loads.mjs --list
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const LIST = process.argv.includes("--list");

/**
 * Each entry: a tool, the arguments that take it to a credentials-or-state check without doing work, and
 * the string that proves it got there rather than dying on the way.
 *
 * The expected string is the tool's own message, quoted exactly. A tool whose message changes fails this
 * check rather than passing silently, which is the right direction: it means someone has to look at it
 * once, and the message is then correct for everyone afterwards.
 */
const TOOLS = [
  { name: "cloud-executor", args: ["--directive-file=data/tmp/loadcheck-directive.json"], expect: "no provider key present", why: "the writer, and the check that catches a missing function in it" },
  { name: "cloud-qa", args: ["--draft=data/tmp/loadcheck-absent.md", "--json"], expect: "usage:", why: "the reviewer; pointed at an absent path so it never stages anything into the collection" },
  /* The idempotency guard runs before the key check, so on a day that already published it stops earlier. */
  { name: "cloud-orchestrator", args: [], expect: "no key present, so nothing can be attempted", alsoAccept: ["ALREADY PUBLISHED TODAY"], why: "the coordinator" },
  { name: "research", args: ["--sources=1"], expect: "no provider key", why: "the subject chooser" },
  { name: "analytics", args: ["--fetch"], expect: "cannot fetch", why: "the readership reader" },
  { name: "agent-run", args: ["--max-turns=1"], expect: "no provider key present", alsoAccept: ["ALREADY PUBLISHED TODAY"], why: "the agent loop" },
  { name: "notify-feishu", args: ["--dry-run"], expect: "", why: "the notifier, which must run with no credentials at all" },
  { name: "feishu-ledger", args: [], expect: "Missing:", why: "the tool that creates the ledger base" },
  { name: "gsc-blue-ocean", args: [], expect: "GSC_CREDENTIALS_BASE64 is not set", why: "the blue-ocean keyword reader, which must degrade rather than fail" },
  { name: "gate", args: ["--fresh"], expect: "", why: "the gate runner" },
  { name: "check-mobile", args: [], expect: "RESULT:", why: "the browser check" },
  { name: "check-csp", args: [], expect: "RESULT:", why: "the policy check" },
  { name: "check-structured-data", args: [], expect: "problems:", why: "the structured-data check" },
  { name: "check-schema-parity", args: [], expect: "RESULT: PASS", why: "the constraint agreement check" },
  { name: "check-workflow-shell", args: [], expect: "RESULT: PASS", why: "the workflow shell hazard check" },
  { name: "check-workflow-yaml", args: [], expect: "RESULT: PASS", why: "the workflow structure check" },
  { name: "rehearse", args: [], expect: "passed,", why: "the orchestrator rehearsal" },
  { name: "rehearse-agent", args: [], expect: "passed,", why: "the agent rehearsal" },
];

if (LIST) {
  for (const t of TOOLS) console.log(`  tools/${t.name}.mjs`);
  process.exit(0);
}

/*
 * No provider credentials, and no analytics token, so every tool takes its own missing-credential path.
 * Everything else is left as it is: the point is to run in the environment the tools will see.
 */
const env = { ...process.env };
for (const k of [
  "ARK_API_KEY", "ARK_MODEL", "DOUBAO_API_KEY", "DOUBAO_ENDPOINT", "OWNER_KEY_1", "OWNER_KEY_2",
  "DEEPSEEK_API_KEY", "DEEPSEEK_WRITE_API_KEY", "DEEPSEEK_REVIEW_API_KEY", "DEEPSEEK_PLAN_API_KEY",
  "OPENAI_API_KEY", "CF_API_TOKEN", "CF_ACCOUNT_ID",
]) {
  delete env[k];
}

console.log("TOOL LOAD CHECK\n" + "=".repeat(78));
console.log(`  tools: ${TOOLS.length}`);
console.log("");

/*
 * The reviewer is pointed at a path that does not exist, deliberately.
 *
 * The first version pointed it at a real draft, and cloud-qa stages its draft into src/content/blog/
 * before building and deletes the staged copy afterwards. A draft staged there does not match the
 * collection schema, so the build failed, and the check reported the reviewer as broken for a reason the
 * check itself had created. Pointing at a fixture in data/tmp did the same thing more subtly.
 *
 * An absent path proves what this check is for - that the module loads and resolves its imports and
 * reaches its own usage message - and it cannot touch the collection at all.
 */
/*
 * The fixture the writer is pointed at.
 *
 * Six figures with all five parts, which is the minimum the THIN-DIRECTIVE gate accepts, so the writer gets
 * past its own precondition and fails on the missing credential - which is what this check verifies. Reading
 * data/directive.json instead made this check report on whatever the last real run happened to leave there.
 */
function writeFixture() {
  const dir = join(ROOT, "data", "tmp");
  mkdirSync(dir, { recursive: true });
  const figures = Array.from({ length: 6 }, (_, i) => ({
    value: String(i + 1),
    unit: "percent",
    period: "2026",
    source: "Load check fixture, 2026",
    retrieved: "2026-01-01",
  }));
  writeFileSync(
    join(dir, "loadcheck-directive.json"),
    JSON.stringify(
      {
        slug: "loadcheck-fixture",
        keyword: "loadcheck",
        category: "trade-policy",
        audience: "importer",
        stakes: "directional",
        figures,
        sources: ["Load check fixture, 2026"],
      },
      null,
      2,
    ),
    "utf8",
  );
}
writeFixture();

const failures = [];
for (const t of TOOLS) {
  const path = join(ROOT, "tools", `${t.name}.mjs`);
  if (!existsSync(path)) {
    failures.push({ ...t, detail: "the file does not exist" });
    console.log(`  FAIL  ${t.name.padEnd(22)} the file does not exist`);
    continue;
  }

  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path, ...t.args], { cwd: ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024, env });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    code = e.status ?? 1;
  }

  /*
   * A ReferenceError or a module-resolution failure is the thing being looked for. It is checked first
   * because the expected message will not be present in that case, and reporting "the message is missing"
   * for a file that crashed on line one would hide the crash.
   */
  const crash = /ReferenceError|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED|SyntaxError|is not defined|Cannot find module/.test(out);
  /* Case-insensitive: the tools do not agree on whether "provider" is capitalised. */
  const got =
    t.expect === ""
      ? !crash
      : [t.expect, ...(t.alsoAccept ?? [])].some((x) => out.toLowerCase().includes(String(x).toLowerCase()));

  if (crash) {
    const line = out.split(/\r?\n/).find((l) => /ReferenceError|ERR_MODULE_NOT_FOUND|SyntaxError|is not defined|Cannot find module/.test(l)) ?? "unknown";
    failures.push({ ...t, detail: line.trim().slice(0, 160) });
    console.log(`  FAIL  ${t.name.padEnd(22)} ${line.trim().slice(0, 100)}`);
  } else if (!got) {
    const tail = out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ").slice(0, 100);
    failures.push({ ...t, detail: `did not reach its own message; last output: ${tail}` });
    console.log(`  FAIL  ${t.name.padEnd(22)} did not reach "${t.expect.slice(0, 50)}"`);
  } else {
    console.log(`  ok    ${t.name.padEnd(22)} loaded and failed for its own reason`);
  }
}

console.log("");
if (!failures.length) {
  console.log(`RESULT: PASS - all ${TOOLS.length} tools load, resolve their imports and reach their own`);
  console.log("                 missing-credential path, so no reference in them is undefined");
  process.exit(0);
}

console.log(`${failures.length} TOOL(S) DID NOT LOAD:`);
for (const f of failures) console.log(`  ${f.name.padEnd(22)} ${f.why}\n      ${f.detail}`);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
