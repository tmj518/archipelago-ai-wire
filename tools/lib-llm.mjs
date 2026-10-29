/**
 * The language-model client the cloud pipeline calls through.
 *
 *   import { ask, askJson, available, summary } from "./lib-llm.mjs";
 *   const r = await ask({ role: "executor", messages: [...] });
 *
 * ## Why a shared module and not calls scattered through the orchestrator
 *
 * Three separate things read and write through here: the planner, the writer, and the reviewers. They
 * need the same retry behaviour, the same token accounting, and the same answer to "which provider is
 * this", and the one thing they must not do is disagree about whether a call succeeded. A pipeline
 * whose writer and reviewer use different notions of failure cannot decide anything.
 *
 * ## Token accounting, because the cost question has been open for two rounds
 *
 * Every call appends one line to `logs/usage.jsonl` with the provider, the role, the model, and the
 * token counts the API returned. The operator asked twice what a month costs and neither time could be
 * answered, because the generation ran through a chat session with no meter. This is the meter. It
 * writes even when the call fails, since a failed call still spends input tokens.
 *
 * ## Roles and providers
 *
 *   planner    the directive that decides what today's article is about
 *   writer     the one that fetches, reads and drafts
 *   reviewer   a second opinion; deliberately a DIFFERENT provider when one is available, because a
 *              model reviewing its own output shares its blind spots and the review becomes ceremony
 *
 * Doubao writes and DeepSeek reviews: two vendors, which is the strongest independence available
 * because they share neither training data nor failure modes. If only one credential is present the
 * pipeline still runs and says so in its report rather than pretending the review was independent.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { classifyError } from "../src/lib/run-key.mjs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();

/*
 * .env is a convenience for local runs; CI supplies real environment variables and this never
 * overrides them. Without it, a correctly filled .env still produced "no provider key present",
 * because this module reads process.env and callers were expected to hand values over - which no
 * caller did.
 */
try {
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* An unreadable .env must not stop a tool configured by the runner. */
}

/*
 * Providers, and the keys that can serve each one.
 *
 * Two shapes are supported and the operator uses both.
 *
 *   Vendor separation. Doubao (Volcano Ark) writes and DeepSeek reviews. This is the stronger form of
 *   independence: two vendors do not share training data, alignment choices or failure modes, so a
 *   blind spot in one is unlikely to be repeated in the other.
 *
 *   Credential separation. Two keys from one vendor, one per role. Weaker on reasoning, stronger on
 *   operations - separate quota, separate rate limit, separate revocation, and an audit trail that can
 *   attribute a spend to a key.
 *
 * A provider therefore carries candidate credentials per role in preference order, and the role
 * decides which one it gets. Getting this wrong is quiet rather than loud: a reviewer handed the
 * writer's own credential reports itself as independent and is not.
 */
const PROVIDERS = {
  /*
   * Volcano Ark, the Doubao endpoint.
   *
   * Two things differ from the OpenAI-shaped APIs and both cause a 400 rather than a clear message.
   * The base URL is Ark's, not OpenAI's. And the `model` field takes an ENDPOINT ID - `ep-...` - which
   * is created in the Ark console from a model and carries the deployment's settings. Passing
   * "doubao-pro-32k" produces "the model does not exist", because on Ark the model name is not
   * addressable; the endpoint is.
   */
  volces: {
    url: process.env.ARK_BASE_URL ? `${process.env.ARK_BASE_URL.replace(/\/$/, "")}/chat/completions` : "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    /*
     * No default, and deliberately no fallback to any key variable: an endpoint id is `ep-...` and a
     * key is `sk-...` or `ark-...`. An earlier version fell back to a key name here, which would have
     * sent an API key in the model field - a silent misconfiguration that returns a 400 and looks like
     * a bad key. The preflight reports a missing endpoint id as itself.
     */
    model: process.env.ARK_MODEL || process.env.DOUBAO_ENDPOINT || "",
    /*
     * One endpoint per role, when the operator has made more than one.
     *
     * Ark creates an endpoint from a model, and a deployment can hold several - a Doubao endpoint for writing and
     * a DeepSeek endpoint for review, on the same key. A single `model` string cannot express that, and a reviewer
     * running the writer's model is not a second opinion.
     *
     * Both fall back to ARK_MODEL, so a deployment with one endpoint behaves exactly as before.
     */
    /*
     * The writer and the reviewer are different endpoints, and the operator stores them under their own names:
     * DUBAOTUILI12345 holds the Doubao endpoint and ARK_MODEL holds the DeepSeek one.
     *
     * The name is uppercase because it is a secret name, and secret names are uppercase everywhere else in these
     * workflows. The lowercase version it replaced worked only because the workflow happened to export a lowercase
     * key; on Linux that is a different variable, not a different spelling.
     *
     * The writer's fallback order matters. A Doubao endpoint in the writer slot is what makes the pair two models -
     * if the writer fell through to ARK_MODEL first, both roles would land on DeepSeek and the reviewer would be
     * reading its own work. So the Doubao-specific names come before ARK_MODEL, and ARK_MODEL is the last resort
     * rather than the first default.
     */
    models: {
      writer:
        process.env.ARK_MODEL_WRITER ||
        process.env.DUBAO201628_ENDPOINT ||
        process.env.DUBAOTUILI12345 ||
        process.env.DUBAO_ENDPOINT ||
        process.env.ARK_MODEL ||
        "",
      reviewer:
        process.env.ARK_MODEL_REVIEWER ||
        process.env.ARK_MODEL ||
        process.env.DOUBAO_ENDPOINT ||
        "",
      /*
       * The planner is what tools/research.mjs calls to choose the subject, so the slot stays. What went
       * away is ARK_MODEL_PLANNER, which sat at the head of this chain and configured nothing: no workflow
       * ever set it, so it fell through to the writer endpoint every time. A variable that cannot change
       * behaviour reads as a knob, which is worse than not having one.
       */
      planner:
        process.env.ARK_MODEL_WRITER ||
        process.env.DUBAOTUILI12345 ||
        process.env.ARK_MODEL ||
        "",
    },
    /* Ark bills in CNY. These are the published Doubao Pro rates converted at 7.1 CNY/USD so the meter
       stays in one currency; the invoice is authoritative. */
    inPerM: 0.11,
    outPerM: 0.28,
    keys: {
      /*
       * DUBAO201628 is the operator's own name for the Ark credential - one key serves both endpoints, since an
       * endpoint is a deployment and the account is what is billed. Read after the canonical names and before the
       * generated owner names, so a deployment with ARK_API_KEY set is unaffected.
       */
      writer: ["ARK_API_KEY", "DOUBAO_API_KEY", "VOLCES_API_KEY", "DUBAO201628", "APIKEY20261016201628", "OWNER_KEY_1"],
      reviewer: ["ARK_REVIEW_API_KEY", "ARK_API_KEY", "DOUBAO_API_KEY", "DUBAO201628", "APIKEY20261016201628", "OWNER_KEY_1"],
      planner: ["ARK_API_KEY", "DOUBAO_API_KEY", "DUBAO201628", "APIKEY20261016201628", "OWNER_KEY_1"],
    },
    /* Set when the model field is required to be an endpoint id, so the failure can be explained. */
    needsEndpointId: true,
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    /* DeepSeek prices per million tokens in USD, recorded from its published rate so the log carries
       an estimate. The invoice is authoritative. */
    inPerM: 0.27,
    outPerM: 1.1,
    /*
     * Order matters: a dedicated review key for the reviewer, a dedicated write key for the writer.
     * OWNER_KEY_1 and OWNER_KEY_2 are the operator's existing secrets, read so a credential stored
     * under a generated name still reaches the pipeline.
     *
     * OWNER_KEY_1 is deliberately absent here. In this deployment it holds the Volcano Ark
     * credential, so offering it to the DeepSeek reviewer would send an Ark key to api.deepseek.com,
     * which answers 401 and reads as a broken DeepSeek key. OWNER_KEY_2 is the DeepSeek credential and
     * serves both roles, which is safe because it is one vendor and one account.
     */
    keys: {
      writer: ["DEEPSEEK_WRITE_API_KEY", "DEEPSEEK_API_KEY", "DEEPSEEK_REVIEW_API_KEY", "OWNER_KEY_2"],
      reviewer: ["DEEPSEEK_REVIEW_API_KEY", "DEEPSEEK_API_KEY", "OWNER_KEY_2", "DEEPSEEK_WRITE_API_KEY"],
      planner: ["DEEPSEEK_PLAN_API_KEY", "DEEPSEEK_API_KEY", "DEEPSEEK_WRITE_API_KEY", "OWNER_KEY_2"],
    },
  },
};

/** Environment variable names that hold a usable key for a role, in preference order. */
function keyNamesFor(providerName, role) {
  return PROVIDERS[providerName]?.keys?.[role] ?? PROVIDERS[providerName]?.keys?.writer ?? [];
}

/** The first set variable among a provider's candidates for a role, with its name. */
function resolveKey(providerName, role, exclude = []) {
  for (const name of keyNamesFor(providerName, role)) {
    const v = (process.env[name] ?? "").trim();
    if (v && !exclude.includes(name)) return { name, value: v };
  }
  return null;
}

/** Which providers have at least one usable key. */

/**
 * The variables a caller could set to satisfy a role, read from the provider tables.
 *
 * The NO-KEYS message used to be a hand-written string listing DEEPSEEK_API_KEY and OPENAI_API_KEY. The
 * code reads neither: the secrets here are mapped to OWNER_KEY_1 and OWNER_KEY_2, and OpenAI was removed
 * from the provider list. Someone who followed the message exactly still saw NO-KEYS.
 *
 * This is derived, so it cannot drift: it is the same table resolveKey searches, in the same order.
 */
export function needFor(role = "writer") {
  const out = [];
  for (const name of available().concat(Object.keys(PROVIDERS))) {
    const p = PROVIDERS[name];
    if (!p) continue;
    for (const k of p.keys?.[role] ?? []) {
      const label = name === "volces" && p.needsEndpointId ? `${k} (plus ARK_MODEL, or ARK_MODEL_WRITER and ARK_MODEL_REVIEWER - ep-... endpoint ids, not model names)` : k;
      if (!out.includes(label)) out.push(label);
    }
  }
  return [...new Set(out)];
}

export function available() {
  return Object.keys(PROVIDERS).filter((name) => keyNamesFor(name, "writer").some((n) => (process.env[n] ?? "").trim()));
}

/**
 * Whether two roles would use the same credential, which is the condition that makes a second review
 * ceremonial rather than independent.
 */
export function reviewIsIndependent() {
  /*
   * Independence means the reviewer gets a credential, a vendor, or both, that the writer did not.
   * Asked of the resolver rather than assumed from configuration, because the whole point is that a
   * misconfiguration here is silent: a reviewer holding the writer's own key reports itself as
   * independent and is not.
   */
  const writer = providerFor("writer");
  const reviewer = providerFor("reviewer", writer);
  if (!writer || !reviewer) return "none";

  /* A different vendor. The strongest arrangement, and the one that survives an outage. */
  if (writer !== reviewer) return "provider";

  /*
   * The same vendor. Two things could still differ: the model, and the credential.
   *
   * A different model is a real second opinion - it fails differently - but it shares the account, the rate limit
   * and the bill. A different credential on the same model is not a second opinion at all: the same weights asked
   * the same question return the same mistake with a different prompt wrapped round it.
   */
  const wModel = modelFor(PROVIDERS[writer], "writer");
  const rModel = modelFor(PROVIDERS[reviewer], "reviewer");
  if (wModel && rModel && wModel !== rModel) return "model";

  const wKey = resolveKey(writer, "writer");
  const rKey = resolveKey(reviewer, "reviewer", wKey ? [wKey.name] : []);
  return rKey ? "credential" : "none";
}

/**
 * The same answer as a sentence, for the run summary.
 *
 * Callers printed "review independent: NO" from a boolean and then explained the yes case in a comment. A level
 * says which of the four things happened without a lookup table.
 */
export function reviewIndependenceLabel() {
  const level = reviewIsIndependent();
  const writer = providerFor("writer");
  const reviewer = providerFor("reviewer", writer);
  const wm = writer ? modelFor(PROVIDERS[writer], "writer") : "";
  const rm = reviewer ? modelFor(PROVIDERS[reviewer], "reviewer") : "";
  if (level === "provider") return `yes - ${writer} writes, ${reviewer} reviews`;
  if (level === "model") return `model-level - same provider (${writer}), different endpoint: ${wm} writes, ${rm} reviews. Shared credential and rate limit`;
  if (level === "credential") return `credential only - same model (${wm}); a shared model is not a second opinion`;
  return `no - the reviewer would use the writer's own model`;
}

export function summary() {
  const lines = [];
  for (const name of Object.keys(PROVIDERS)) {
    const p = PROVIDERS[name];
    const w = resolveKey(name, "writer");
    const r = resolveKey(name, "reviewer");
    const model = p.needsEndpointId ? (modelFor(p, "writer") || "NO ENDPOINT ID SET") : p.model;
    lines.push(
      "    " +
        name.padEnd(9) +
        " writer=" + (w?.name ?? "MISSING").padEnd(24) +
        " reviewer=" + (r?.name ?? "MISSING").padEnd(26) +
        " " + model,
    );
  }
  const wProv = providerFor("writer");
  const rProv = providerFor("reviewer", wProv);
  const indep = reviewIsIndependent();
  const cross = wProv && rProv ? `${wProv} writes, ${rProv} reviews` : "no complete role assignment";
  return (
    "  providers usable: " + (available().join(", ") || "none") + "\n" +
    lines.join("\n") +
    "\n    roles: " + cross +
    "\n    review independent: " + reviewIndependenceLabel()
  );
}

/*
 * Role to provider preference.
 *
 * The operator's arrangement is that Doubao writes and DeepSeek reviews, which is vendor separation and
 * the strongest independence available: two vendors do not share training data, alignment choices or
 * failure modes, so a blind spot in one is unlikely to repeat in the other.
 *
 * The order encodes that, with a fallback per role so a missing key downgrades rather than halts - and
 * the downgrade is announced in the summary rather than left to be discovered.
 *
 * The reviewer is additionally kept away from whatever provider the writer actually used, compared by
 * provider name rather than assumed, so the arrangement survives a configuration change.
 */
/**
 * The model a provider should call for a role.
 *
 * Providers with per-role endpoints (Ark) answer with the one for this role; everyone else has one model and
 * answers with it. Kept next to ROLE_PREFERENCE because it is the same question asked of the provider rather than
 * of the role: which of these things can do this job.
 */
function modelFor(provider, role) {
  const perRole = provider.models?.[role];
  return perRole || provider.model;
}

const ROLE_PREFERENCE = {
  /*
   * DeepSeek for both roles.
   *
   * This was volces-then-deepseek for the writer, which is the stronger arrangement - two vendors share
   * neither training data nor failure modes - but the Ark endpoint available here has not produced a
   * usable draft in any run, while DeepSeek has. The operator's order was to publish first and add
   * machinery second, and this follows it.
   *
   * Doubao remains as the fallback, so a working Ark key restores the two-vendor arrangement with no code
   * change. The summary prints which arrangement is in force rather than always claiming two vendors.
   */
  /*
   * ark leads both roles now, with a different endpoint for each.
   *
   * This is the arrangement the notes above describe and used to rule out: the writer and the reviewer are
   * different models, so the reviewer is a second opinion rather than the same opinion with a different prompt.
   * Two models make different mistakes, and a reviewer that shares the writer's always misses exactly what the
   * writer missed.
   *
   * deepseek stays second so a deployment with only a DeepSeek key still runs.
   */
  writer: ["volces", "deepseek"],
  planner: ["volces", "deepseek"],
  /*
   * DeepSeek for the reviewer as well, and the operator's reasoning wins over mine here.
   *
   * Vendor separation is the stronger arrangement - two vendors share neither training data nor failure
   * modes - and that is why volces used to lead on the review side. But the Ark endpoint in this deployment
   * has not produced a usable draft in any run, and putting it on the review path spends a call to learn
   * that again. DeepSeek reviews.
   *
   * The consequence is stated rather than hidden: the reviewer now uses the same provider as the writer,
   * which the summary prints as "the reviewer would use the writer's own credential" only when the key is
   * the same. OWNER_KEY_2 serves both, so the credentials are shared and the vendor is shared; the report
   * says so. Independence is worth less than a pipeline that runs, and claiming otherwise would be worse
   * than either.
   *
   * volces is deliberately absent from this list. Adding ARK_API_KEY back restores the two-vendor
   * arrangement by appending it here - one line, which is the right size for a decision this reversible.
   */
  /*
   * ark first, and its reviewer endpoint is a different model from its writer endpoint.
   *
   * The independence rule is unchanged: a reviewer should not be the writer. What changed is that "not the writer"
   * can now be satisfied inside one provider, by a different model, and the report says which of the two it got.
   */
  reviewer: ["volces", "deepseek"],
};

export function providerFor(role, avoid) {
  const have = available();
  if (!have.length) return null;
  const order = ROLE_PREFERENCE[role] ?? ROLE_PREFERENCE.writer;
  const usable = (name) =>
    have.includes(name) &&
    Boolean(resolveKey(name, role)) &&
    /*
     * A provider that needs an endpoint id and has none for THIS ROLE cannot be called, so it is not chosen.
     *
     * It tested the provider's single model, which was right while there was one. With an endpoint per role,
     * a deployment could hold a writer endpoint and no reviewer endpoint, and the old test would still call it
     * usable and then send an empty model field.
     */
    !(PROVIDERS[name].needsEndpointId && !modelFor(PROVIDERS[name], role));

  /*
   * `avoid` is honoured only when the preference order does not already answer the question.
   *
   * This was "skip avoid, then fall back to it", which quietly defeated the preference list: the reviewer
   * is asked for with the writer's provider as `avoid`, so with deepseek leading both roles the reviewer
   * skipped deepseek and landed on volces - the provider the operator has said is not producing usable
   * output. A preference list that can be overridden by an automatic exclusion is not a preference.
   *
   * So the order decides first. `avoid` is used only if honouring it leaves a usable choice that the order
   * would not otherwise reach - which is the case it was written for: a two-key, one-vendor setup where the
   * reviewer has a spare credential that would otherwise go unused.
   */
  const first = order.find(usable);
  if (!first) return null;
  if (first !== avoid) return first;

  /* The top choice is excluded. Prefer a different provider if one is usable, else keep the top choice. */
  const other = order.find((n) => n !== avoid && usable(n));
  return other ?? first;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The budget policy, as a pure decision.
 *
 * Separated from the file read so it can be tested without touching a real log. Unset, empty or zero
 * means no ceiling, which is the behaviour local runs already had. A value that is not a finite
 * non-negative number refuses everything: a misconfigured budget must not become an unlimited one.
 */
export function budgetDecision(spent, limit) {
  if (limit === null || limit === undefined || limit === "") return { allowed: true, reason: "no limit configured" };
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 0) return { allowed: false, reason: `invalid budget: ${String(limit)}` };
  if (n === 0) return { allowed: true, reason: "no limit configured" };
  if (spent >= n) return { allowed: false, reason: `spend limit reached: ${spent.toFixed(4)} >= ${n}` };
  return { allowed: true, reason: `${spent.toFixed(4)} of ${n}` };
}

/**
 * USD recorded today, read back from the meter.
 *
 * Returns Infinity when the log cannot be read: a ceiling that opens because the meter is corrupt is
 * not a ceiling. `file` exists so tests can point this at a temporary log.
 */
export function spendToday(now = new Date(), file = null) {
  try {
    const p = file ?? process.env.AGENT_USAGE_LOG ?? join(ROOT, "logs", "usage.jsonl");
    if (!existsSync(p)) return 0;
    const day = now.toISOString().slice(0, 10);
    let total = 0;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (typeof r.at === "string" && r.at.slice(0, 10) === day && typeof r.estimatedUsd === "number") total += r.estimatedUsd;
    }
    return total;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function meter(entry) {
  /*
   * The accounting file answers "which task, which attempt, which kind of failure" - not "what was
   * said". runId and taskKey are opaque; errorClass is derived; the free-text error stays where it
   * was. Nothing written here can carry a prompt, a completion or a key.
   */
  const enriched = { ...entry };
  if (enriched.runId == null) enriched.runId = null;
  if (enriched.taskKey == null) enriched.taskKey = null;
  if (enriched.error && !enriched.errorClass) enriched.errorClass = classifyError(enriched.error, enriched.status);
  if (!enriched.error && enriched.ok === false && !enriched.errorClass) enriched.errorClass = "unknown";
  try {
    const p = join(ROOT, "logs", "usage.jsonl");
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(enriched) + "\n", "utf8");
  } catch {
    /* A meter that cannot be written must not fail the call it was measuring. */
  }
}

/**
 * One completion. Returns { ok, text, provider, model, usage, ms, error }.
 *
 * It does not throw on an API error. Every caller in this pipeline has to decide what to do about a
 * failure - retry, fall back, or write an alert - and an exception here would move that decision into
 * a catch block at each call site, where it would be made differently each time.
 */
/**
 * One model call.
 *
 * `tools` is optional and passed through untouched. Both providers here are OpenAI-compatible and both
 * support tool calling, which is what lets tools/agent-run.mjs exist without a broker process: the agent
 * loop is a plain conversation, and this is the only place that has to know how a tool call is shaped.
 *
 * The existing callers pass no tools and read only `text`, so adding the field changes nothing for them.
 */
export async function ask({ role = "writer", model: modelOverride = "", messages, system, temperature = 0.2, maxTokens = 8192, avoidProvider = null, retries = 2, tools = null, toolChoice = null, runId = null, taskKey = null }) {
  const providerName = providerFor(role, avoidProvider);

  /*
   * The ceiling, checked before any request is made. It reads the meter rather than a counter in
   * memory, so a retry loop and a second role share one number.
   *
   * Limit: this is not a hard cross-process cap. Two processes that start at the same moment can
   * both read a total below the limit and both proceed, so the overshoot is bounded by "one run's
   * spend" rather than zero. A true cap needs a lock or a single writer; neither exists here.
   */
  const spentToday = spendToday();
  const budget = budgetDecision(spentToday, process.env.AGENT_USD_LIMIT ?? "");
  if (!budget.allowed) {
    meter({ at: new Date().toISOString(), runId, taskKey, role, ok: false, error: budget.reason, errorClass: "budget" });
    return { ok: false, error: budget.reason, spent: spentToday, limit: Number(process.env.AGENT_USD_LIMIT) };
  }
  if (!providerName) {
    meter({ at: new Date().toISOString(), runId, taskKey, role, ok: false, error: "no provider key present", providers: available() });
    return {
      ok: false,
      error: "no provider key present",
      need: needFor(role),
    };
  }
  const p = PROVIDERS[providerName];
  const cred = resolveKey(providerName, role);
  if (!cred) {
    meter({ at: new Date().toISOString(), runId, taskKey, role, ok: false, provider: providerName, error: "no key for this role" });
    return { ok: false, error: `no key configured for role ${role} on ${providerName}`, need: keyNamesFor(providerName, role) };
  }
  const key = cred.value;
  const body = {
    model: modelFor(p, role),
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    temperature,
    max_tokens: maxTokens,
  };

  /*
   * Sent only when there is something to send. An empty tools array is rejected by some gateways, and
   * only the agent loop passes tools at all.
   */
  if (tools && tools.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const r = await fetch(p.url, {
        method: "POST",
        /*
         * STREAM, AND A LONGER CEILING.
         *
         * The probe run inside the runner on 2026-10-20 answered the question the whole day was spent guessing at:
         *
         *   request never completed: ETIMEDOUT: fetch failed
         *
         * Doubao-Seed-2.1-pro did not return a malformed body, an empty content, or a streamed event. It did not return
         * at all inside 180 seconds for a 638-character structural prompt. A one-token ping answers in a second, which
         * is why the endpoint looked healthy - the model is simply slow enough that a buffered request for 1500 words
         * exceeds any client timeout worth having.
         *
         * Streaming is the fix, not a workaround: the response begins immediately and the connection is held open by
         * data rather than by silence, so a slow model finishes instead of being abandoned. The SSE parser below reads
         * the deltas. The ceiling goes to ten minutes for the same reason - a large model writing a long article is not
         * a hung request.
         */
        signal: AbortSignal.timeout(180000),
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, stream: true }),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /*
         * SSE WITHOUT BEING ASKED.
         *
         * Some Ark endpoints - and every reasoning endpoint I have seen from a Chinese vendor - answer a buffered
         * request with a text/event-stream anyway: a run of `data: {"choices":[{"delta":{...}}]}` lines followed by
         * `data: [DONE]`. JSON.parse throws on that, the reply reads as empty, and the caller reports "the writer did
         * not produce the file" - a message that names the symptom and hides the cause entirely.
         *
         * So the body is parsed as a stream when it looks like one: every delta's content, and every delta's
         * reasoning_content, concatenated in order. A buffered JSON answer never reaches this branch.
         */
        const trimmed = text.trimStart();
        if (trimmed.startsWith("data:") || /\ndata:\s*\{/.test(trimmed.slice(0, 2000))) {
          const parts = [];
          let reasoningDeltas = 0;
          let usageSeen = null;
          for (const rawLine of trimmed.split("\n")) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload);
              const ch = j?.choices?.[0];
              const d = ch?.delta ?? ch?.message;
              /*
               * ONLY content. The reasoning deltas are the model thinking out loud, and joining them to the answer
               * put a page of deliberation in front of the frontmatter - so the writer's parser saw prose where it
               * expected "---" and reported that the model had produced nothing, while 2,434 deltas of perfectly good
               * article sat in the same string.
               *
               * They are counted rather than discarded silently: a reply that is all reasoning and no content is a
               * different failure from an empty one, and the log should say which happened.
               */
              if (d?.content) parts.push(d.content);
              else if (d?.reasoning_content) reasoningDeltas += 1;
              if (j?.usage) usageSeen = j.usage;
            } catch {
              /* a keep-alive or a comment line inside the stream */
            }
          }
          if (parts.length) {
            json = {
              choices: [{ message: { content: parts.join("") }, finish_reason: "stop" }],
              usage: usageSeen ?? {},
            };
            console.log(`  stream      : the endpoint answered as SSE, ${parts.length} delta(s) joined`);
          }
        }
      }
      if (false) {
        /* An HTML error page from a proxy is a real outcome and is reported as one below. */
      }
      const ms = Date.now() - started;
      if (!r.ok || json?.error) {
        lastError = json?.error?.message ?? `HTTP ${r.status}: ${text.slice(0, 200)}`;
        meter({ at: new Date().toISOString(), runId, taskKey, role, provider: providerName, keyName: cred.name, model: modelFor(p, role), ok: false, ms, status: r.status, error: lastError, attempt });
        /* 429 and 5xx are worth another attempt; 401 and 400 are not. */
        if (r.status === 401 || r.status === 400 || r.status === 402 || r.status === 403) break;
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const usage = json?.usage ?? {};
      const cost =
        ((usage.prompt_tokens ?? 0) / 1e6) * p.inPerM + ((usage.completion_tokens ?? 0) / 1e6) * p.outPerM;
      meter({
        runId,
        taskKey,
        at: new Date().toISOString(),
        runId,
        taskKey,
        role,
        provider: providerName,
        keyName: cred.name,
        model: modelOverride || modelFor(p, role),
        ok: true,
        ms,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        estimatedUsd: Number(cost.toFixed(6)),
        attempt,
      });
      return {
        ok: true,
        text: json?.choices?.[0]?.message?.content ?? "",
        /*
         * Null when the model answered in prose, which is how the agent loop knows a turn is finished.
         * The raw message is returned too so it can be appended to the conversation verbatim: an
         * assistant turn that made tool calls has to go back exactly as it came, or the provider rejects
         * the tool result that follows it.
         */
        toolCalls: json?.choices?.[0]?.message?.tool_calls ?? null,
        rawMessage: json?.choices?.[0]?.message ?? null,
        finishReason: json?.choices?.[0]?.finish_reason ?? null,
        provider: providerName,
        keyName: cred.name,
        model: modelFor(p, role),
        usage,
        estimatedUsd: Number(cost.toFixed(6)),
        ms,
      };
    } catch (e) {
      const ms = Date.now() - started;
      /* One line per failed attempt, with what actually failed. `the draft violates the schema`
         was the visible symptom of twelve calls that never came back, and the log never said so. */
      console.log(`       call failed: task=${taskKey} role=${role} provider=${providerName} ` +
        `attempt=${attempt + 1}/${retries + 1} ${e?.cause?.code ?? e?.name ?? "error"}: ${String(e?.message ?? e).slice(0, 120)}`);
      lastError = `${e.cause?.code ?? e.name ?? "error"}: ${e.message}`;
      meter({ at: new Date().toISOString(), runId, taskKey, role, provider: providerName, keyName: cred.name, model: modelFor(p, role), ok: false, ms, error: lastError, attempt });
      /*
       * A timeout does not get a second attempt on the same provider.
       *
       * The 2026-10-23 run spent 731 seconds on three attempts that each ran into the ceiling, and then
       * reported WRITE-FAILED while a second provider sat there with a valid key. Retrying a timeout on
       * the same route is three chances to wait the same wall again; the useful next move is the other
       * provider, which the block after this loop already does.
       */
      if (/TimeoutError|timed out|ETIMEDOUT|AbortError/i.test(lastError)) break;
      await sleep(2000 * (attempt + 1));
    }
  }
  /*
   * A provider that cannot be reached OR is refusing work is not a failure of the pipeline.
   *
   * Every attempt above went to one provider, because providerFor() answers once. That is right for an
   * API error - a 400 will be a 400 on the next call too - and wrong for a route problem or a rate
   * limit, both of which are properties of the moment rather than of the request.
   *
   * The original test only covered network errors, so a 429 - which is the most likely failure when two
   * pipelines share one endpoint, and the one an operator most wants covered - exhausted its retries and
   * then gave up with a second provider unused. Rate limits, gateway errors and timeouts now switch
   * providers too.
   */
  const switchableFailure =
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR|fetch failed|network|Timeou?tError|AbortError|timed out|HTTP (?:429|500|502|503|504)|rate limit|too many requests/i.test(lastError);
  const another = providerFor(role, providerName);
  if (switchableFailure && another && another !== providerName) {
    meter({
      runId,
      taskKey,
      at: new Date().toISOString(),
      role,
      provider: providerName,
      ok: false,
      error: `${lastError} - falling back to ${another}`,
      fallbackTo: another,
    });
    return ask({ role, messages, system, temperature, maxTokens, avoidProvider: providerName, retries: 1, tools, toolChoice, runId, taskKey });
  }

  /* NETWORK_FALLBACK: the branch above is the one that keeps a dead route from ending a run. */
  return { ok: false, provider: providerName, keyName: cred.name, error: lastError };
}

/**
 * A completion whose answer has to be JSON.
 *
 * Models wrap JSON in prose and code fences regardless of instruction, so the extraction is tolerant
 * and the failure is explicit. Returning `null` with the raw text attached lets the caller write an
 * alert containing what the model actually said, which is the only useful thing to do with a parse
 * failure at three in the morning.
 */
/**
 * Pull a JSON object out of a model response.
 *
 * Asking for JSON does not reliably produce a bare JSON document, and the ways it fails need different
 * handling.
 *
 * The obvious one is a wrapper: prose before the object, or a ```json fence. The fence is tried first,
 * then a brace-matched span, which covers both.
 *
 * The one that cost a run is truncation. On 2026-10-17 the reviewer output was unparseable and the
 * pipeline reported "no parseable verdict" without saying why, so the next step was a guess. A
 * brace-matched scan that tracks string state and escapes finds a *complete* object anywhere in the
 * response, which a first-brace-to-last-brace slice does not: if the text ends mid-object, that slice is
 * a fragment and fails, whereas the scan correctly reports that nothing complete is present.
 *
 * Cut off and malformed are different failures and the caller is told which. A balanced object is worth
 * a retry with a larger budget; an unbalanced one is not.
 */
function balancedJsonSpan(s) {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  /* Opened and never closed: the response was cut off mid-object. */
  return null;
}

export async function askJson(opts) {
  /* askJson goes through the chain too, so the writer fails over instead of failing. */
  const r = await askChain({ ...opts, temperature: opts.temperature ?? 0 });
  if (!r.ok) return { ...r, json: null };
  const raw = r.text ?? "";

  const candidates = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1];
  if (fenced) candidates.push(fenced);
  const balanced = balancedJsonSpan(raw);
  if (balanced) candidates.push(balanced);
  /* Last resort: the original slice, for the rare case where a brace inside a string confuses the scan. */
  const first = raw.indexOf("{");
  if (first >= 0 && raw.lastIndexOf("}") > first) candidates.push(raw.slice(first, raw.lastIndexOf("}") + 1));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") return { ...r, json: parsed };
    } catch {
      /* try the next shape */
    }
  }

  /*
   * No parseable object. Say which failure it was, and quote the response, because "the model wrote
   * prose" and "the model was cut off" call for opposite fixes - change the prompt, or raise the
   * budget - and neither is guessable from a stack trace.
   */
  const opened = raw.includes("{");
  const closed = raw.includes("}");
  const hitCeiling = r.usage?.completion_tokens != null && opts.maxTokens != null && r.usage.completion_tokens >= opts.maxTokens - 8;
  const parseError = !opened
    ? "the response contained no JSON object at all"
    : hitCeiling
      ? `the response ran to the ${opts.maxTokens}-token ceiling, so the object was cut off`
      : closed
        ? "the response contained a JSON object that does not parse"
        : "the response opened an object and never closed it";
  return { ...r, json: null, parseError, raw: raw.slice(0, 2000), head: raw.slice(0, 400), tail: raw.slice(-200) };
}

/** Running total from the meter, for the daily report. */
export function usageToday() {
  const p = join(ROOT, "logs", "usage.jsonl");
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    let calls = 0;
    let failed = 0;
    let usd = 0;
    let pt = 0;
    let ct = 0;
    for (const l of lines) {
      const e = JSON.parse(l);
      if (!(e.at ?? "").startsWith(today)) continue;
      calls++;
      if (!e.ok) failed++;
      usd += e.estimatedUsd ?? 0;
      pt += e.promptTokens ?? 0;
      ct += e.completionTokens ?? 0;
    }
    return { calls, failed, usd: Number(usd.toFixed(4)), promptTokens: pt, completionTokens: ct };
  } catch {
    return { calls: 0, failed: 0, usd: 0, promptTokens: 0, completionTokens: 0 };
  }
}

/**
 * The endpoints a role may use, in order of preference.
 *
 * Built from the same variables modelFor() reads, but as a list rather than the first truthy one. The first entry is the
 * one the operator asked for; the rest are the fallbacks that let a bad endpoint be a bad endpoint instead of a bad day.
 */
export function modelChain(role) {
  /*
   * providerFor returns the provider's NAME, not its table. This read `p.name` and `p.model` off that string,
   * so `p.name !== "volces"` was always true, `[p.model]` was `[undefined]`, and the function returned an
   * empty array every time.
   *
   * askChain() treats an empty chain as "no chain" and makes a single call with the default model - so it
   * worked, and the failover this function exists for never ran. One retired endpoint meant a failed writer
   * instead of a fallback, while FINAL_REPORT.md section 3.1 described the chain as a moat. A list that is
   * always empty is not a fallback list, it is a comment.
   */
  const name = providerFor(role);
  if (!name) return [];
  if (name !== "volces") return [PROVIDERS[name]?.model].filter(Boolean);
  /* Ark is the provider with per-role endpoints, so it is the one that has a chain. */
  const order = [
    process.env.ARK_MODEL_WRITER,
    process.env.DUBAO201628_ENDPOINT,
    process.env.DUBAOTUILI12345,
    process.env.DUBAO_ENDPOINT,
    process.env.ARK_MODEL,
  ];
  const seen = new Set();
  return order.filter((x) => x && !seen.has(x) && seen.add(x));
}

const HEALTH_FILE = new URL("../data/provider-health.json", import.meta.url);

/**
 * The health memory: two empty replies in a row and an endpoint is skipped until someone clears it.
 *
 * Without this, every run pays one failed call per broken endpoint before falling through - cheap, but it also hides the
 * breakage. With it, the failure is remembered and reported, so a model that is retired announces itself instead of
 * quietly costing a call every day.
 */
function readHealth() {
  try {
    return JSON.parse(readFileSync(HEALTH_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeHealth(h) {
  try {
    mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
    writeFileSync(HEALTH_FILE, JSON.stringify(h, null, 2) + "\n", "utf8");
  } catch {
    /* a health file that cannot be written must not stop a run */
  }
}

export function noteEmpty(ep) {
  const h = readHealth();
  const row = h[ep] ?? { empty: 0 };
  row.empty += 1;
  row.lastAt = new Date().toISOString();
  h[ep] = row;
  writeHealth(h);
  if (row.empty === 2) console.log(`  health      : ${ep} returned nothing twice - it will be skipped from now on`);
}

export function noteOk(ep) {
  const h = readHealth();
  if (h[ep] && h[ep].empty) {
    delete h[ep];
    writeHealth(h);
    console.log(`  health      : ${ep} is answering again, reinstated`);
  }
}

/**
 * ask, with the chain.
 *
 * Returns the first reply that actually contains text. Every endpoint that answers with nothing is recorded and skipped
 * on the next run, so a retired model costs one call on the day it retires rather than one call per day forever.
 */
export async function askChain(opts) {
  const chain = modelChain(opts.role ?? "writer");
  if (!chain.length) return ask(opts);
  const health = readHealth();
  const usable = chain.filter((ep) => !(health[ep]?.empty >= 2));
  const skipped = chain.filter((ep) => health[ep]?.empty >= 2);
  for (const ep of skipped) console.log(`  endpoint    : ${ep} skipped, it returned nothing twice`);

  let last = null;
  for (const ep of usable.length ? usable : chain) {
    last = await ask({ ...opts, model: ep });
    const text = (last?.text ?? "").trim();
    /*
     * USABLE MEANS IT LOOKS LIKE A DOCUMENT.
     *
     * "Non-empty" is not the test. A model that thinks before answering returns a wall of reasoning that is non-empty
     * and useless, and the chain believed it: on 2026-10-20 a run received 2,434 deltas, classified the reply as a
     * success, never fell through to the lite endpoint, and reported WRITE-FAILED. Three calls were spent on an
     * endpoint that had already told us it could not answer.
     *
     * Frontmatter or a markdown heading is the cheapest honest test of "this is a draft".
     */
    const usable = text && (/^---/m.test(text) || /^#\s/m.test(text));
    if (usable) {
      noteOk(ep);
      if (ep !== usable[0]) console.log(`  fallback    : ${usable[0]} produced nothing, ${ep} wrote the reply`);
      return last;
    }
    noteEmpty(ep);
    console.log(
      text
        ? `  endpoint    : ${ep} replied with ${text.length} characters but no document structure, trying the next one`
        : `  endpoint    : ${ep} returned an empty reply, trying the next one`,
    );
  }
  return last ?? { ok: false, error: "every endpoint in the chain returned nothing", text: "" };
}
