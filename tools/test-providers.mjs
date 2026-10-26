/**
 * Test the writing provider and the reviewing provider with a real call.
 *
 *   node tools/test-providers.mjs
 *   node tools/test-providers.mjs --ark-key=ark-... --ark-model=ep-...
 *   node tools/test-providers.mjs --deepseek-key=sk-...
 *
 * ## Why a separate tool rather than trusting the preflight
 *
 * The preflight in the workflow answers "is this configured". This answers "does it work", and the two
 * differ in ways that are hard to tell apart from an error code:
 *
 *   - Ark addresses a model by ENDPOINT ID, not by name. Passing a name returns 400 with "the model
 *     does not exist", which reads like a broken key.
 *   - A key with no balance returns 402, which reads like a broken key.
 *   - A key whose app lacks permission returns 401 or 403 on a subset of endpoints.
 *   - An endpoint that exists but is not deployed, or is deployed on a different account, returns 404.
 *
 * Each of those is reported by name here, with the API's own message, so the fix is obvious.
 *
 * ## The prompt sent
 *
 * "Reply with the single word OK." One token of output. It costs a fraction of a cent and it exercises
 * authentication, routing, the endpoint, the deployment and the response shape - everything except
 * generation quality, which is not what this is for.
 */
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const ARK_BASE = (flag("ark-base", process.env.ARK_BASE_URL) || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

/*
 * Key resolution mirrors tools/lib-llm.mjs, including the operator's existing secret names, so a key
 * that works here also works in the pipeline.
 */
const ARK_KEY = flag("ark-key", "") || process.env.ARK_API_KEY || process.env.OWNER_KEY_1 || process.env.DOUBAO_API_KEY || "";
const ARK_MODEL = flag("ark-model", "") || process.env.ARK_MODEL || process.env.DOUBAO_ENDPOINT || "";
const DS_KEY = flag("deepseek-key", "") || process.env.DEEPSEEK_REVIEW_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OWNER_KEY_2 || "";
const DS_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const say = (s) => console.log(s);

/** Turn an API failure into the thing the operator has to change. */
function explain(status, body, provider) {
  const msg = (() => {
    try {
      const j = JSON.parse(body);
      return j?.error?.message ?? j?.message ?? body.slice(0, 240);
    } catch {
      return body.slice(0, 240);
    }
  })();
  const lines = [`      API said: ${msg}`];
  if (status === 401) lines.push("      -> the key is wrong, revoked, or from a different account");
  else if (status === 402) lines.push(`      -> the account has no balance. ${provider === "ark" ? "Ark" : "DeepSeek"} is a paid API; top it up.`);
  else if (status === 403) lines.push("      -> the key is valid but not permitted for this endpoint (Ark: check the endpoint's access settings)");
  else if (status === 404) lines.push("      -> the endpoint or model was not found. On Ark this usually means the value is a MODEL NAME where an ENDPOINT ID (ep-...) is required, or the endpoint is not deployed");
  else if (status === 400) lines.push("      -> the request was rejected. On Ark, check that ARK_MODEL is an endpoint id (ep-...), not a model name");
  else if (status === 429) lines.push("      -> rate limited or out of quota");
  else if (status === 0) lines.push("      -> no response: the network or the proxy is the problem, not the key");
  return lines.join("\n");
}

async function tryProvider({ label, url, key, model, needModel }) {
  say(`\n  ${label}`);
  say(`    url    : ${url}`);
  say(`    model  : ${model || "(not set)"}`);
  say(`    key    : ${key ? key.slice(0, 8) + "..." + key.slice(-4) + `  (${key.length} chars)` : "(not set)"}`);

  if (!key) {
    say("    RESULT : FAIL - no key. Set one of the names listed at the end.");
    return false;
  }
  if (needModel && !model) {
    say("    RESULT : FAIL - no endpoint id. Ark needs `ep-...`, not a model name.");
    return false;
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    max_tokens: 4,
  });

  const started = Date.now();
  let status = 0;
  let text = "";
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body,
    });
    status = r.status;
    text = await r.text();
  } catch (e) {
    status = 0;
    text = `${e.cause?.code ?? e.name}: ${e.message}`;
  }
  const ms = Date.now() - started;

  if (status === 200) {
    let reply = "";
    let tokens = null;
    try {
      const j = JSON.parse(text);
      reply = j?.choices?.[0]?.message?.content ?? "";
      tokens = j?.usage?.total_tokens ?? null;
    } catch {}
    say(`    RESULT : OK  (${ms} ms, HTTP 200${tokens !== null ? `, ${tokens} tokens` : ""})`);
    say(`    reply  : ${JSON.stringify(reply.slice(0, 40))}`);
    return true;
  }
  say(`    RESULT : FAIL  (${ms} ms, HTTP ${status})`);
  say(explain(status, text, label.toLowerCase().includes("doubao") ? "ark" : "deepseek"));
  return false;
}

say("PROVIDER TEST\n" + "=".repeat(80));

const arkOk = await tryProvider({
  label: "WRITER — Doubao (Volcano Ark)",
  url: `${ARK_BASE}/chat/completions`,
  key: ARK_KEY,
  model: ARK_MODEL,
  needModel: true,
});

const dsOk = await tryProvider({
  label: "REVIEWER — DeepSeek",
  url: DEEPSEEK_URL,
  key: DS_KEY,
  model: DS_MODEL,
  needModel: false,
});

say("\n" + "=".repeat(80));
if (arkOk && dsOk) {
  say("  Both work. Doubao writes, DeepSeek reviews — two vendors, which is the strongest");
  say("  independence available because they share neither training data nor failure modes.");
  say("\n  Set these as repository secrets, then run the daily workflow:");
  say("    ARK_API_KEY      (or keep using APIKEY20261016201628)");
  say("    ARK_MODEL        the ep-... endpoint id");
  say("    DEEPSEEK_REVIEW_API_KEY  (or keep using GITHUB66CHINA)");
  process.exit(0);
}
if (dsOk && !arkOk) {
  say("  DeepSeek works, Doubao does not. The pipeline will run anyway: DeepSeek writes and");
  say("  DeepSeek reviews with two separate credentials. Vendor separation is lost, credential");
  say("  separation is not, and the notification says so rather than implying otherwise.");
  process.exit(1);
}
if (arkOk && !dsOk) {
  say("  Doubao works, DeepSeek does not. Fix the review key: a review that uses the writer's own");
  say("  credential is ceremony, and the pipeline labels it as such rather than reporting independence.");
  process.exit(1);
}
say("  Neither works. Nothing can run. The names read, in order of preference:");
say("    ARK_API_KEY | DOUBAO_API_KEY | OWNER_KEY_1");
say("    ARK_MODEL | DOUBAO_ENDPOINT");
say("    DEEPSEEK_REVIEW_API_KEY | DEEPSEEK_API_KEY | OWNER_KEY_2");
process.exit(1);
