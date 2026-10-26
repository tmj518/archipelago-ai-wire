/* Probe an Ark endpoint offline: a long structural prompt, full JSON out. Run locally, never in CI.
 *   $env:ARK_API_KEY = "key"; node tools/probe-pro-endpoint.mjs ep-xxxx
 */
const endpoint = process.argv[2];
if (!endpoint) { console.log("\n  usage: node tools/probe-pro-endpoint.mjs <ep-xxxxxxxx>\n"); process.exit(2); }
const key = process.env.ARK_API_KEY || process.env.DUBAO201628 || process.env.APIKEY20261016201628 || "";
if (!key) { console.log("\n  set the key first:  $env:ARK_API_KEY = \"your key\"\n"); process.exit(2); }

const prompt = [
  "You write for an English site about the landed cost of importing from China.",
  "Return one markdown document only, starting with a --- frontmatter block.",
  "Sections: ## AI Summary (60-100 words), ## What happened, ## Why now, ## So what,",
  "## How confident (three paragraphs beginning **Confirmed.**, **Inferred.**, **What would change my mind.**),",
  "## For you (three lines beginning '- **Label:**'), ## The data point,",
  "## FAQ (three questions, 80-150 word answers), ## How we calculated this (fenced code block), ## The point.",
  "Use only these figures: 40.5 percent, 67.1 percent, five years, 29 April 2026.",
  "Body prose between 1200 and 1800 words.",
].join("\n");

console.log("\n  endpoint : " + endpoint + "\n  prompt   : " + prompt.length + " chars\n");

const t0 = Date.now();
let res, text;
try {
  res = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({
      model: endpoint,
      messages: [
        { role: "system", content: "You are a careful writer. You return markdown and nothing else." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 8192,
    }),
    signal: AbortSignal.timeout(180000),
  });
  text = await res.text();
} catch (e) {
  console.log("  request never completed: " + (e.cause && e.cause.code ? e.cause.code : e.name) + ": " + e.message);
  console.log("  That is network or timeout, not an endpoint problem.");
  process.exit(1);
}

console.log("  HTTP     : " + res.status + "  (" + (Date.now() - t0) + " ms)\n");
let json;
try { json = JSON.parse(text); }
catch { console.log("  body is not JSON. First 600 characters:\n" + text.slice(0, 600)); process.exit(1); }

const msg = (json.choices && json.choices[0] && json.choices[0].message) || {};
const content = typeof msg.content === "string" ? msg.content : "";
const reasoning = typeof msg.reasoning_content === "string" ? msg.reasoning_content : (typeof msg.reasoning === "string" ? msg.reasoning : "");

console.log("  finish_reason    : " + ((json.choices && json.choices[0] && json.choices[0].finish_reason) || "(none)"));
console.log("  usage            : " + JSON.stringify(json.usage || {}));
console.log("  message keys     : " + Object.keys(msg).join(", "));
console.log("  content length   : " + content.length);
console.log("  reasoning length : " + reasoning.length + "\n");

const ok = content.trim() ? "OK - in message.content" : reasoning.trim() ? "OK VIA FALLBACK - in reasoning_content" : "EMPTY";
console.log("  VERDICT: " + ok + "\n");
if (ok === "EMPTY") {
  console.log("  full body, so the reason is visible rather than inferred:\n" + JSON.stringify(json, null, 2).slice(0, 3000));
  console.log("\n  causes of this exact shape:");
  console.log("    - the endpoint needs stream:true and returns nothing buffered");
  console.log("    - max_tokens rejected, model stops at once (finish_reason would say length)");
  console.log("    - a reasoning model whose thinking budget consumed the completion");
  console.log("    - the id is a batch or fine-tune endpoint rather than an inference one");
} else {
  console.log("  first 700 characters:\n\n" + (content || reasoning).slice(0, 700));
}
console.log("");