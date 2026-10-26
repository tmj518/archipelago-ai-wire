#!/usr/bin/env node
/**
 * Workflow YAML structural hazards, without a YAML parser.
 *
 *   node tools/check-workflow-yaml.mjs
 *
 * ## The two failures this exists for
 *
 * Both happened on 2026-10-17, in the same file, within an hour.
 *
 *   1  Two env maps in one workflow each ended up with ARK_MODEL_WRITER twice, because one patch added it with a
 *      fallback and an earlier patch had already added it without. YAML keeps the last, so the fallback would have
 *      been silently discarded - except that GitHub rejects the file outright. The workflow does not run at all, and
 *      the failure appears as an invalid workflow rather than as a failed run.
 *
 *   2  Four lines were inserted into a `run: |` block at column zero, because a text insertion matched the content
 *      and not the indentation. That ends the block scalar early and makes the rest of the file a mapping at the
 *      wrong level: "Nested mappings are not allowed in compact mappings".
 *
 * `yaml` is not a dependency of this project and adding one to validate four files is the wrong trade. This is a
 * structural check against those two shapes, and it says so rather than pretending to be a parser.
 *
 * ## Sequences are the subtle part
 *
 * A workflow is a list of steps, and every step is `- name: ...` followed by keys at a deeper indent. That `-`
 * starts a NEW mapping: `- name: a` and the following `- name: b` are not two `name` keys in one map. The first
 * version of this file did not model that and reported every step as a duplicate. A frame is now closed both when
 * the indent decreases and when a new list item begins.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), ".github", "workflows");
const files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

const problems = [];
let maps = 0;
let blocks = 0;

const KEY = /^([A-Za-z0-9_.-]+):(?:\s|$)/;

for (const f of files) {
  const lines = readFileSync(join(DIR, f), "utf8").split(/\r?\n/);

  /*
   * A block comment is not YAML at all.
   *
   * The check this file exists for missed the mistake that motivated it. check-workflow-shell finds block comments
   * inside run blocks; a block comment in the mapping part of the file is a different failure - "Implicit keys need
   * to be on a single line" - and it made this workflow invalid on 2026-10-17 for the third time in one day. The key
   * scan skipped those lines because they are not keys, so the file passed a check whose whole purpose was to catch
   * them.
   */
  lines.forEach((line, i) => {
    if (/^\s*\/\*/.test(line) || /^\s*\*\//.test(line)) {
      problems.push(`${f}:${i + 1}  block comment NOT YAML AT ALL - use # comments`);
    }
  });
  /** Frames of open mappings: the indent of the keys and the keys seen so far. */
  const stack = [];
  let blockIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;

    if (blockIndent >= 0) {
      if (indent > blockIndent) continue;
      /*
       * The block scalar ends here, and what follows must be a key, a list item or a comment at a shallower
       * indent. Anything else is a line that was inserted into the block without matching its indentation - which
       * ends the scalar early and leaves the rest of the file at the wrong level. That is the second failure this
       * file exists for, and it is the one that produced "Nested mappings are not allowed in compact mappings".
       */
      blockIndent = -1;
      const looksLikeKey = /^[A-Za-z0-9_.-]+:(?:\s|$)/.test(trimmed) || /^-\s/.test(trimmed);
      if (!looksLikeKey && !trimmed.startsWith("#")) {
        problems.push(
          `${f}:${i + 1}  a line inside a block scalar lost its indentation - the scalar ends here and the rest of the file is read at the wrong level`,
        );
      }
    }

    const isItem = /^-\s/.test(trimmed);
    if (isItem) {
      /* A new sequence item: every frame at this indent or deeper is closed. */
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, keys: new Set() });
      maps++;
    }

    let body = isItem ? trimmed.replace(/^-\s+/, "") : trimmed;
    /* `- name: x` also opens the item's mapping one level in; the key belongs to the frame we just pushed. */
    const indentOfKey = isItem ? indent + 2 : indent;

    const m = KEY.exec(body);
    if (!m) continue;
    const name = m[1];

    if (!isItem) {
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        stack.push({ indent, keys: new Set() });
        maps++;
      }
      if (stack[stack.length - 1].indent !== indent) continue; /* an inline `- ` on the same line; not our case */
    }

    const frame = stack[stack.length - 1];
    if (frame.keys.has(name)) {
      problems.push(`${f}:${i + 1}  duplicate key "${name}" in the same mapping - GitHub rejects the whole workflow`);
    }
    frame.keys.add(name);

    if (/:\s*[|>][-+]?\s*$/.test(body)) {
      blockIndent = indentOfKey;
      blocks++;
    }
  }
}

console.log("WORKFLOW YAML CHECK\n" + "=".repeat(78));
console.log(`  workflows    : ${files.length}`);
console.log(`  mappings     : ${maps}`);
console.log(`  block scalars: ${blocks}`);
console.log("");

if (!problems.length) {
  console.log("RESULT: PASS - no duplicate keys, and every block scalar stayed indented");
  process.exit(0);
}

console.log(`${problems.length} PROBLEM(S):`);
for (const p of problems.slice(0, 12)) console.log("  " + p);
if (problems.length > 12) console.log(`  ... and ${problems.length - 12} more`);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
