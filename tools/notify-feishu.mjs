/**
 * The daily notification. What the operator reads instead of the pipeline.
 *
 *   node tools/notify-feishu.mjs
 *   node tools/notify-feishu.mjs --dry-run        print the card and send nothing
 *   node tools/notify-feishu.mjs --webhook=...    override FEISHU_WEBHOOK
 *
 * ## What it reads
 *
 * `data/tmp/orchestrator-report.json` and the tail of `logs/orchestrator.jsonl`, both written by the
 * orchestrator. If neither exists the notification says so rather than sending an empty card, because
 * "no report" and "nothing happened" are different states and only one of them means the pipeline is
 * broken.
 *
 * ## Why the card leads with the verdict and not the article
 *
 * The operator's question in the morning is "does anything need me". So the first line is the verdict,
 * the second is what happened, and the list of what needs a decision comes before the article details.
 * An article title at the top would read as success on a day the pipeline was stuck.
 *
 * ## Feishu's payload shape
 *
 * a plain `msg_type: text` body. The rich card format needs a signature when the bot has a secret
 * configured, and a notification that silently stops arriving because of a signature mismatch is worse
 * than a plain one that always works. If the bot is set up with a signature, `FEISHU_SECRET` is used;
 * otherwise the request is unsigned.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DRY = args.includes("--dry-run");

const webhook = flag("webhook", process.env.FEISHU_WEBHOOK ?? "");
const secret = (process.env.FEISHU_SECRET ?? "").trim();

const REPORT = join(ROOT, "data", "tmp", "orchestrator-report.json");

const LEDGER = join(ROOT, "logs", "orchestrator.jsonl");
const USAGE = join(ROOT, "logs", "usage.jsonl");
const DIRECTOR = join(ROOT, "总监指令.md");
const STAFF = join(ROOT, "员工汇报.md");

/**
 * A short list of why the failed calls failed.
 *
 * The meter writes one JSON line per call with `ok`, `status` and `error`. This reads that back and
 * folds the failures into "how many × what", because the three kinds of failure need three different
 * responses: a 429 is a rate limit that clears, a 401 is a key that never will, and a timeout is
 * neither. "36 failed" alone tells the operator nothing they can act on.
 */
function failureBreakdown(limit = 4) {
  if (!existsSync(USAGE)) return "";
  const counts = new Map();
  let total = 0;
  try {
    for (const line of readFileSync(USAGE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j.ok !== false) continue;
      total++;
      const key = j.status
        ? `HTTP ${j.status}`
        : /fetch failed|ETIMEDOUT|ECONNRESET|socket hang up|undici/i.test(String(j.error ?? ""))
          ? "network timeout"
          : /no provider key|no key configured/i.test(String(j.error ?? ""))
            ? "no provider key"
            : String(j.error ?? "unknown").replace(/\s+/g, " ").slice(0, 42);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } catch {
    return "";
  }
  if (!total) return "";
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return `Failed calls: ${total} — ${top.map(([k, n]) => `${n}× ${k}`).join(", ")}`;
}

let report = null;

/*
 * The agent route writes its report somewhere else.
 *
 * Every "STOPPED BEFORE PUBLISHING [agent]" card was wrong: the agent had written data/tmp/agent-report.json and the
 * notifier was only looking at the script route's file. It said the pipeline never started while the pipeline's own
 * verdict sat one filename away - TURN-LIMIT, thirty turns, a hundred and fifty-five model calls.
 *
 * The agent's file wins when both exist, because the agent route never writes the orchestrator's.
 */
const AGENT_REPORT = join(ROOT, "data", "tmp", "agent-report.json");
if (!existsSync(REPORT) && existsSync(AGENT_REPORT)) {
  report = JSON.parse(readFileSync(AGENT_REPORT, "utf8"));
}
if (existsSync(REPORT)) {
  try {
    report = JSON.parse(readFileSync(REPORT, "utf8"));
  } catch {}
}

/* The last few runs, so the card can say whether a failure is new or the third day running. */
let recent = [];
if (existsSync(LEDGER)) {
  try {
    recent = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).slice(-5).map((l) => JSON.parse(l));
  } catch {}
}

/* ---------------------------------------------------------------- the message */

const lines = [];
/*
 * Which pipeline this run was, known from the workflow rather than from the report.
 *
 * The report carries its own route, but on this path there is no report - and this is the path that fires when
 * something broke, so it is the one where knowing the route matters most. The workflow passes ROUTE and the failed
 * step's name.
 */
const routeFromEnv = (process.env.ROUTE ?? "").trim().toLowerCase();
const failedStep = (process.env.FAILED_STEP ?? "").trim();
/*
 * "c" is the guide line. It is a third route with its own report file and its own workflow, and without
 * its own tag every guide card would arrive labelled [unknown] - which reads as "something broke in a
 * way nobody predicted" rather than "the guide line did not find a figure today".
 */
const routeTag = ["agent", "script", "c"].includes(routeFromEnv) ? routeFromEnv : "unknown";

/*
 * A no-op is not a failure.
 *
 * When the backup cron fires after the primary one has already published, the pipeline stops on its
 * idempotency guard and writes no report - so this branch used to print a red "STOPPED BEFORE
 * PUBLISHING" card for a run that did exactly the right thing. Six red cards a week for correct
 * behaviour is how an operator learns to ignore red cards, which is the one failure a notification
 * channel must never have. The step's own outcome says which case this is.
 */
const pipelineFinishedCleanly = (process.env.PIPELINE_OUTCOME ?? "").trim().toLowerCase() === "success";

if (!report && pipelineFinishedCleanly) {
  /*
   * A no-op sends nothing at all.
   *
   * The first version drew a yellow "NO-OP (already published today)" card, which was better than the
   * red one it replaced and still wrong: with four crons, two of them are backups, so a normal day
   * produced up to two cards saying nothing happened. On 2026-10-26 three of them arrived in a row
   * while the GA4 reader was being tested, which is exactly the shape of a channel an operator learns
   * to swipe away - and a swiped channel is how a real failure goes unread for a week.
   *
   * The run is already recorded: the run ledger writes a row with its verdict and cost, and the job
   * summary carries it too. A message is for things that need a person, and this needs nobody.
   */
  console.log("NOTIFY: no-op (already published today) - nothing to send");
  process.exit(0);
}
if (!report) {
  lines.push(`🔴 Archipelago AI Wire — STOPPED BEFORE PUBLISHING   [${routeTag}]`);
  lines.push("");
  /*
   * What actually happened, in the order a reader needs it: where it stopped, then what to do.
   *
   * "data/tmp/orchestrator-report.json is absent" was true and told the operator nothing - it named an internal
   * file instead of the step. A step before the pipeline can fail (a build, an install, a probe) and the report is
   * only written by the pipeline, so its absence means "something earlier failed".
   */
  if (failedStep) {
    lines.push(`The run failed at: ${failedStep}`);
    lines.push("");
    lines.push("Everything before that step succeeded. The pipeline never started, which is why there is no");
    lines.push("article and no report - the report is written by the pipeline, not before it.");
  } else {
    lines.push("A step before the pipeline failed, so the pipeline never started. The report is written by the");
    lines.push("pipeline itself, which is why there is none.");
  }
  lines.push("");
  lines.push("Where to look: Actions -> the failed run -> the red step. Its last twenty lines carry the reason.");
  /*
   * The raw codes, even when the pipeline never wrote a report.
   *
   * This is the branch where something broke BEFORE anything could be recorded, which is exactly the case
   * where the operator has nothing else to go on. The meter is a file, not a report, so it survives a
   * run that died early - and it carries the status code of every failed call.
   */
  const failuresBeforeReport = failureBreakdown();
  if (failuresBeforeReport) {
    lines.push("");
    lines.push(failuresBeforeReport);
  }
  if (routeTag === "agent") {
    lines.push("");
    lines.push("The agent route has one failure mode the script route does not: it can run out of turns. If the");
    lines.push("step is \"Run the pipeline\" and the log ends with TURN-LIMIT, the transcript at");
    lines.push("data/tmp/agent-transcript.jsonl has every turn it took.");
  }
} else {
  const verdict = report.verdict ?? "(none)";
  /*
   * Which pipeline spoke.
   *
   * The script route and the agent route write the same kind of card, and the same failure means different things
   * on each: a rejected draft is a writing problem, a TURN-LIMIT is a budget problem. Naming the route is the
   * difference between reading a card and looking one up.
   */
  const route = report.route ?? (report.turns != null ? "agent" : "script");

  /*
   * PUBLISHED-WITHOUT-FINISH is green.
   *
   * The article is in the collection and the site has it. That the model never called finish is a detail worth reading
   * in the summary, not a reason to paint the card red - a red card on a day that produced an article teaches the
   * operator to ignore red cards, which is the one thing a notification must never do.
   */
  const PUBLISHED_ISH = verdict === "PUBLISHED" || verdict === "PUBLISHED-WITHOUT-FINISH";
  const icon = PUBLISHED_ISH ? "✅" : verdict === "NO-DIRECTIVE" || verdict === "CEILING" || verdict === "IDLE" || verdict === "NO-SUBJECT" || verdict === "DUPLICATE-SUBJECT" ? "🟡" : "🔴";
  lines.push(`${icon} Archipelago AI Wire — ${verdict}   [${route}]`);
  lines.push("");
  if (report.article) lines.push(`Article: ${report.article}`);
  if (report.qa?.verdict) lines.push(`Review: ${report.qa.verdict}`);
  const u = report.usage ?? {};
  if (u.calls !== undefined) lines.push(`Usage: ${u.calls} call(s), ${u.failed ?? 0} failed, ~$${u.usd ?? 0}`);
  /*
   * WHY the calls failed, next to how many.
   *
   * "46 calls, 36 failed" is a number an operator cannot act on: a 429 is a rate limit that clears by
   * itself, a 401 is a key that will never work, and a timeout is neither. The meter already records the
   * status and the message for every call; this reads that file back and counts the reasons.
   *
   * On a runner the file is created empty at checkout and holds only this run's calls, so the summary
   * describes the run in the card and nothing older.
   */
  const failures = failureBreakdown();
  if (failures) lines.push(failures);
  if (report.seconds !== undefined) lines.push(`Took: ${report.seconds}s`);

  /*
   * A publication the reviewer objected to is not the same as one it approved, and the card has to say
   * which happened. Otherwise "PUBLISHED" reads as a clean pass when the second opinion was against it.
   */
  if (report.reviewAdvisory?.length) {
    lines.push("");
    lines.push("Published with the reviewer's objections recorded:");
    for (const o of report.reviewAdvisory.slice(0, 4)) lines.push(`  · ${String(o).slice(0, 180)}`);
    lines.push("  They are in data/lessons.jsonl and feed the next article's prompt.");
  }

  if (report.reasons?.length) {
    lines.push("");
    lines.push("Needs a decision or a fix:");
    for (const r of report.reasons.slice(0, 6)) lines.push(`  • ${String(r).slice(0, 220)}`);
    if (report.reasons.length > 6) lines.push(`  … and ${report.reasons.length - 6} more in the report`);
    /*
     * Quote the reviewer's own output when the failure was a response we could not parse.
     *
     * The card is the only thing the operator sees, and on 2026-10-17 it said "no parseable verdict",
     * which describes the symptom and gives nothing to act on: the two likely causes - prose around
     * the object, and a response cut off at the token ceiling - need opposite fixes. The first and
     * last few hundred characters are what tells them apart.
     */
    const l5 = report.qa?.layers?.L5;
    if (l5 && l5.responseHead) {
      lines.push("");
      lines.push(`  reviewer said: ${String(l5.responseHead).slice(0, 220)}`);
      if (l5.responseTail) lines.push(`  reviewer ended: ${String(l5.responseTail).slice(0, 140)}`);
      if (l5.completionTokens != null) lines.push(`  completion tokens: ${l5.completionTokens}`);
    }
  }

  if (report.qa?.layers) {
    const failed = Object.entries(report.qa.layers).filter(([, l]) => !l.pass);
    if (failed.length) {
      lines.push("");
      lines.push("Layers that failed:");
      for (const [k, l] of failed) lines.push(`  ${k}: ${String(l.detail).slice(0, 180)}`);
    }
  }

  /*
   * Whether the two integrations that fail quietly are actually connected.
   *
   * Readership and the Feishu ledger are both optional by design, and both were silently absent for weeks.
   * The operator asked twice whether they were wired, and the only honest answer was "I do not know" - which
   * is a message problem, not a credential problem. The daily workflow writes their state to
   * data/tmp/integrations.json and this reads it.
   *
   * Shown on every card, not only on failure: "not configured" on a good day is exactly the information that
   * is missing today.
   */
  try {
    const ip = join(ROOT, "data", "tmp", "integrations.json");
    if (existsSync(ip)) {
      const s = JSON.parse(readFileSync(ip, "utf8"));
      const r = s.readership, l = s.ledger, g = s.google;
      lines.push("");
      lines.push("Integrations:");
      lines.push(
        r?.configured
          ? `  readership  ok - ${r.pageviews} pageview(s) over ${r.days} day(s), ${r.articles} article(s)`
          : `  readership  NOT CONFIGURED - needs ${r?.missing ?? "CF_ACCOUNT_ID, CF_API_TOKEN"}`,
      );
      /*
       * The Feishu ledger line is gone by instruction. It reported a tool that is optional by design and that
       * exits naming its own variables when they are missing; printing that on every card taught the reader to
       * skim the card. tools/feishu-sync.mjs still exists and still runs.
       */
      if (g) {
        /*
         * Read from the built artefact rather than from configuration: the tag is either in dist or it is not,
         * and that is the difference between "registered somewhere" and "reporting".
         */
        lines.push(
          g.ga
            ? "  Google Analytics ok - tag present in the build"
            : "  Google Analytics NOT IN THE BUILD - set PUBLIC_GA_MEASUREMENT_ID on the Cloudflare Pages project",
        );
        lines.push(
          g.searchConsole
            ? "  Search Console  ok - verification tag present (URL-prefix property)"
            : "  Search Console  ok if the property is sc-domain: - a Domain property is verified by DNS and needs no tag",
        );
      }
    }
  } catch {
    /* a missing status file is reported on the next run, not turned into an error here */
  }

  if (report.verdict === "NO-KEYS") {
    lines.push("");
    lines.push("Nothing can run until these exist as repository secrets:");
    /*
   * The names come from the report, which builds them from the provider tables. This file used to carry
   * its own list - DEEPSEEK_API_KEY and OPENAI_API_KEY - and neither is read by this build: OpenAI was
   * removed from the provider list, and the DeepSeek credentials here are mapped to OWNER_KEY_2.
   *
   * The operator set exactly what that list asked for and the pipeline reported NO-KEYS again. A message
   * that looks like instruction and names the wrong variables is worse than no message.
   */
  const need = report.need ?? [];
  if (need.length) {
    for (const n of need.slice(0, 10)) lines.push(`  • ${n}`);
  } else {
    lines.push("  • run node tools/cloud-orchestrator.mjs locally to see which names this build reads");
  }
  }
  if (report.verdict === "NO-DIRECTIVE") {
    lines.push("");
    lines.push("No directive at data/directive.json, so there was nothing to write. This is the");
    lines.push("intended behaviour: the pipeline does not choose its own subject.");
  }
}

if (recent.length > 1) {
  const tail = recent.slice(0, -1).map((r) => r.verdict).join(" → ");
  lines.push("");
  lines.push(`Previous runs: ${tail}`);
}

const text = lines.join("\n");

/* ---------------------------------------------------------------- send */

console.log("NOTIFY\n" + "=".repeat(78));
console.log(text);
console.log("=".repeat(78));

if (DRY) {
  console.log("--dry-run: nothing sent.");
  process.exit(0);
}

if (!webhook) {
  console.log("");
  console.log("FEISHU_WEBHOOK is not set, so there is nobody to notify. The message above is what would");
  console.log("have been sent. Set it as a repository secret and this becomes the daily report.");
  /*
   * A missing webhook is not a pipeline failure. Exiting non-zero here would fail the whole job on a
   * day when the article published perfectly, which would train the operator to ignore red runs.
   */
  process.exit(0);
}

const payload = { msg_type: "text", content: { text } };
let url = webhook;
if (secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sign = createHmac("sha256", `${ts}\n${secret}`).update("").digest("base64");
  url = `${webhook}&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
}

try {
  const r = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  console.log(`\n  sent: HTTP ${r.status} ${body.slice(0, 200)}`);
  try {
    mkdirSync(join(ROOT, "logs"), { recursive: true });
    writeFileSync(join(ROOT, "logs", "notify-last.json"), JSON.stringify({ at: new Date().toISOString(), status: r.status, body: body.slice(0, 500) }, null, 2), "utf8");
  } catch {}
  process.exit(r.ok ? 0 : 1);
} catch (e) {
  console.log(`\n  send failed: ${e.cause?.code ?? e.message}`);
  process.exit(1);
}
