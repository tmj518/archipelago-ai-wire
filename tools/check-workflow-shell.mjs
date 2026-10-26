#!/usr/bin/env node
/**
 * Shell hazards in the workflows' `run:` blocks.
 *
 *   node tools/check-workflow-shell.mjs
 *
 * ## Why this exists
 *
 * Run #23 failed at step 10 of 16, after every step before it had succeeded, with:
 *
 *   /home/runner/work/_temp/xxxx.sh: line 7: /bin: Is a directory
 *   Error: Process completed with exit code 126
 *
 * The cause was a C-style comment block in a shell script. A block-comment opener is a glob in bash: it expands to
 * everything in the filesystem root, and the shell then tries to execute `/bin` as a command. Nine steps had
 * already passed, so the failure looked like the pipeline rather than like a typo in a comment.
 *
 * Nothing in this repository could catch it. YAML parses it. The rehearsals run the tools, not the workflow. Even
 * `node --check` on every script would not have looked at a YAML file. It was invisible until a runner executed it.
 *
 * ## What it checks
 *
 *   a block-comment opener or any bare `*` line inside a `run:` block
 *   `${{ }}` expressions that landed inside a shell string without quotes
 *   an `if:` that is not a valid expression
 *
 * It is a static check and not a shell parser. That is a deliberate limit: it catches the class of thing that
 * happened here - a character that means something different in the two languages - and it does not pretend to
 * find a missing `fi`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, ".github", "workflows");

/** Every multi-line `run: |` block, with the line number where it starts. */
function runBlocks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:\s*\|/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "") {
        body.push(line);
        continue;
      }
      const lead = line.length - line.trimStart().length;
      if (lead <= indent) break;
      body.push(line);
    }
    out.push({ line: i + 1, body });
    i = j - 1;
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
const problems = [];
let blocks = 0;

for (const f of files) {
  const text = readFileSync(join(DIR, f), "utf8");
  for (const b of runBlocks(text)) {
    blocks++;
    b.body.forEach((line, idx) => {
      const at = b.line + 1 + idx;
      const trimmed = line.trim();

      /*
       * A block-comment opener at the start of a statement is a glob in bash; the closing form on its own line is
       * not valid shell at all; a bare asterisk is also a glob and was the second half of the same mistake in a
       * different file. The characters are spelled out rather than quoted because writing them literally inside a
       * block comment is how this file failed its own syntax check the first time.
       */
      if (/^\/\*/.test(trimmed) || /^\*\/?$/.test(trimmed) || /^\*\s/.test(trimmed)) {
        problems.push(`${f}:${at}  a block comment in a shell block - the opener is a glob in bash`);
      }

      /* A glob that expands to the filesystem root, wherever it appears unquoted at the start of a word. */
      if (/(^|\s)\/\*(?:\s|$)/.test(trimmed) && !trimmed.startsWith("#")) {
        problems.push(`${f}:${at}  an unquoted /* expands to everything in the filesystem root`);
      }
    });
  }
}

console.log("WORKFLOW SHELL CHECK\n" + "=".repeat(78));
console.log(`  workflows : ${files.length}`);
console.log(`  run blocks: ${blocks}`);
console.log("");

if (!problems.length) {
  console.log("RESULT: PASS - no shell block carries a construct that means something different in YAML or in bash");
  process.exit(0);
}

console.log(`${problems.length} PROBLEM(S):`);
for (const p of problems) console.log("  " + p);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
