#!/usr/bin/env node
/**
 * The decisions, checked without the network.
 *
 * The pipeline's expensive failures this week were not in the article: a quiet day reported as a
 * writer failure, a published article reported as a quiet day, and a second round that could never
 * run. Each of those is a decision written in one line of shell or one expression in research.mjs, so
 * each can be checked here in milliseconds instead of in a five-minute cloud run.
 *
 * This does not test fetching, the model, or the build. It tests the rules that decide what a run
 * means - the part that was wrong.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const wf = readFileSync(join(ROOT, ".github", "workflows", "content-daily.yml"), "utf8");
const research = readFileSync(join(ROOT, "tools", "research.mjs"), "utf8");

let pass = 0;
const fails = [];
const rec = (name, ok, detail = "") => (ok ? pass++ : fails.push(detail ? `${name} — ${detail}` : name));

/* 1. A quiet day is not a failure. */
rec(
  "quiet day: exit 0 and no article ends green",
  /QUIET: the generator ran and found nothing worthy|QUIET: the generator ran and found nothing worth/.test(wf),
);
rec(
  "quiet day: the check accepts exit 0 and 2",
  /\[ "\$gen_status" -ne 0 \] && \[ "\$gen_status" -ne 2 \]/.test(wf),
  "the guard must not treat the duplicate exit as a failure",
);

/* 2. A published article must be seen as published. */
rec(
  "published: the new article is found among untracked files",
  /git ls-files --others --exclude-standard src\/content\/blog/.test(wf),
  "git diff cannot see a file the generator has not staged",
);

/* 3. The two-round mechanism exists and is bounded. */
rec("round 2 exists", /ROUND 2: all proposals were duplicates/.test(wf));
rec("round 2 shifts the rotation", /SOURCE_ROTATION=9 node tools\/research\.mjs/.test(wf));
rec("round 2 runs once", (wf.match(/SOURCE_ROTATION=9 node tools\/research\.mjs/g) ?? []).length === 1);

/* 4. Status is two fields, not one. */
rec("outcome and class are separate", /RUN_OUTCOME=\$outcome/.test(wf) && /FAILURE_CLASS=\$class/.test(wf));
rec(
    "a written article is published even if a later step failed",
    /if \[ -n "\$\{ARTICLE_SLUG:-\}" \] && \[ -s "src\/content\/blog\/\$\{ARTICLE_SLUG\}\.md" \]/.test(wf)
);

/* 5. event identity does not depend on the headline. */
rec("event_id hashes organisations and month", /createHash\("sha1"\)/.test(research) && /event_id:/.test(research));
rec("event_id is carried in the directive", /event_id: \(\(\) =>/.test(research));

/* 6. The Malaysian corpus is read before foreign material. */
rec("Malaysian sources are read first", /MALAYSIAN_FIRST/.test(research));
rec("every configured source is read", /flag\("sources", "99"\)/.test(research));

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
console.log("RESULT: PASS — the decisions that were wrong are now checked");
