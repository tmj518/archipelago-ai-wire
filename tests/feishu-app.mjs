#!/usr/bin/env node
/** Offline tests for tools/lib/feishu-app.mjs. No network, no real credential. */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const ROOT = process.cwd();
const m = await import(pathToFileURL(join(ROOT, "tools/lib/feishu-app.mjs")).href);

let pass = 0; const fails = [];
const rec = (n, ok, d = "") => (ok ? pass++ : fails.push(n + (d ? "  — " + d : "")));

const json = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

/* token */
rec("token: missing credentials refused", (await m.tenantToken({})).ok === false);
rec("token: app code!=0 refused",
  (await m.tenantToken({ appId: "a", appSecret: "b", fetchImpl: json({ code: 10003, msg: "invalid" }) })).ok === false);
rec("token: success returns token",
  (await m.tenantToken({ appId: "a", appSecret: "b", fetchImpl: json({ code: 0, tenant_access_token: "t-1" }) })).token === "t-1");

/* message shape */
const msg = m.buildMessage({ receiveId: "oc_1", title: "T", lines: ["l1", "l2"], link: "https://x/" });
rec("message: receive id kept", msg.receive_id === "oc_1");
rec("message: text carries lines and link", msg.content.includes("l1") && msg.content.includes("https://x/"));

/* send */
const okFetch = (() => { let n = 0; return async (url, opt) => {
  n++;
  if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t" }) };
  return { ok: true, status: 200, json: async () => ({ code: 0, data: { message_id: "om_123" } }) };
}; })();
const good = await m.sendMessage({ appId: "a", appSecret: "b", receiveId: "oc_1", title: "T", lines: ["x"], fetchImpl: okFetch });
rec("send: returns message id", good.ok && good.messageId === "om_123", String(good.messageId));

let calls = 0;
const rateLimited = async (url) => {
  calls++;
  if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t" }) };
  return calls < 3 ? { ok: false, status: 429, json: async () => ({ code: 99991400, msg: "too many" }) }
                   : { ok: true, status: 200, json: async () => ({ code: 0, data: { message_id: "om_2" } }) };
};
const retried = await m.sendMessage({ appId: "a", appSecret: "b", receiveId: "oc_1", title: "T", lines: ["x"], fetchImpl: rateLimited, retries: 2 });
rec("send: 429 is retried then succeeds", retried.ok && retried.attempts === 2, JSON.stringify(retried));

let authCalls = 0;
const forbidden = async (url) => {
  authCalls++;
  if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t" }) };
  return { ok: false, status: 403, json: async () => ({ code: 230002, msg: "no permission" }) };
};
const denied = await m.sendMessage({ appId: "a", appSecret: "b", receiveId: "oc_1", title: "T", lines: ["x"], fetchImpl: forbidden, retries: 2 });
rec("send: 403 is not retried", denied.ok === false && denied.attempts === 1, JSON.stringify(denied));

/* redaction */
rec("redact: hides the middle", m.redact("fake-secret-for-redaction-test-0123456789").includes("***"));
rec("redact: short values fully hidden", m.redact("abc") === "***");
rec("redact: empty stays empty", m.redact(undefined) === "");

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { console.log(fails.join("\n")); process.exit(1); }
console.log("RESULT: PASS — token, send, retry policy and redaction");