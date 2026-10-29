#!/usr/bin/env node
/**
 * The idempotency guard must ask git, not the journal.
 *
 * On 2026-10-29 a run recorded PUBLISHED for deepavali-price-scheme-2026-11-items-nov-4-10. The article
 * never reached main - no commit, no deploy, 404 - and every later run exited in a second believing the
 * day was done. These assertions pin the two halves of the fix: the collection decides, and a git
 * failure is an error rather than a silent "not published".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "tools/cloud-orchestrator.mjs"), "utf8");
const fn = src.slice(src.indexOf("function alreadyPublishedToday"), src.indexOf("const already = alreadyPublishedToday();"));

let pass = 0;
const fails = [];
const rec = (n, ok, d = "") => (ok ? pass++ : fails.push(n + (d ? "  — " + d : "")));

rec("guard consults git HEAD", /git", \["cat-file", "-e", `HEAD:src\/content\/blog\/\$\{slug\}\.md`\]/.test(fn));
rec("guard no longer returns on verdict alone", !/return \{ slug: j\.article \?\? j\.slug \?\? "\?", at: j\.at \}/.test(fn));
rec("guard skips when the file is absent from HEAD", /continue; \/\/ not in HEAD/.test(fn));
rec("a git failure throws instead of guessing", /throw new Error\(`cannot tell whether/.test(fn));

/* Behavioural half: a runaway journal entry must not stop the run when the file is not in HEAD. */
const probe = `
import { execFileSync } from "node:child_process";
for (const slug of ["malaysia-exports-record-rm215-billion-september-2026", "deepavali-price-scheme-2026-11-items-nov-4-10"]) {
  try {
    execFileSync("git", ["cat-file", "-e", "HEAD:src/content/blog/" + slug + ".md"], { stdio: "ignore" });
    console.log(slug + " IN_HEAD");
  } catch (e) {
    console.log(slug + " NOT_IN_HEAD status=" + e.status);
  }
}
`;
const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: ROOT, encoding: "utf8" });
const out = r.stdout ?? "";
rec("real published article is found in HEAD", /malaysia-exports-record[^\n]*IN_HEAD/.test(out), out.split("\n")[0]);
rec("the phantom 2026-10-29 article is not in HEAD", /deepavali[^\n]*NOT_IN_HEAD/.test(out), out.split("\n")[1]);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { console.log(fails.join("\n")); process.exit(1); }
console.log("RESULT: PASS — publication is decided by git HEAD, and an unreadable git is an error");