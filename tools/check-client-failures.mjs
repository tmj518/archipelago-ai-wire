/**
 * High-pressure test of the send clients' failure paths.
 *
 * The mock tests in check-clients.mjs cover the provider's own rejections - 401, 422, 400, 404. What
 * they do not cover is everything between the caller and the provider: a connection that resets, a
 * timeout, a 500 with an HTML body instead of JSON, a log file that cannot be opened. Those are the
 * paths a real credential will eventually exercise at three in the morning, so they are exercised
 * here first.
 *
 * Run: node tools/check-client-failures.mjs
 * Exits non-zero on a failed case and is wired into preflight.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const { deliver, mockTransport, httpTransport, buildRequest } = await import("./deliver.mjs");

let pass = 0;
let fail = 0;
const failures = [];

async function t(name, fn) {
  try {
    const r = await fn();
    if (r === true) {
      pass++;
      console.log(`  ok    ${name}`);
    } else {
      fail++;
      failures.push(`${name}: ${r}`);
      console.log(`  FAIL  ${name}\n          ${r}`);
    }
  } catch (e) {
    fail++;
    failures.push(`${name}: threw ${e.message}`);
    console.log(`  FAIL  ${name}\n          threw ${e.message}`);
  }
}

const KEY = "test_key_for_failure_paths";
process.env.DEVTO_API_KEY = KEY;
process.env.BUTTONDOWN_API_KEY = KEY;

console.log("SEND CLIENT FAILURE PATHS\n" + "=".repeat(78));

/* ---------------------------------------------------------------- transport errors */

console.log("\ntransport — errors that never reach the provider\n" + "-".repeat(78));

/*
 * A global fetch that rejects, so the real httpTransport runs against a dead network. The whole
 * point is that httpTransport's own await rejects; stubbing the module would test the stub instead.
 */
const realFetch = globalThis.fetch;

await t("a reset connection is returned as a result, not thrown", async () => {
  globalThis.fetch = async () => {
    const e = new Error("socket hang up");
    e.cause = { code: "ECONNRESET" };
    throw e;
  };
  const req = buildRequest("devto").request;
  const r = await httpTransport(req);
  return r.status === 0 && r.ok === false && r.json?.code === "ECONNRESET" ? true : `got ${JSON.stringify(r).slice(0, 160)}`;
});

await t("a timeout is reported with its code", async () => {
  globalThis.fetch = async () => {
    const e = new Error("The operation was aborted due to timeout");
    e.name = "TimeoutError";
    e.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
    throw e;
  };
  const req = buildRequest("devto").request;
  const r = await httpTransport(req);
  return r.status === 0 && r.json?.code === "UND_ERR_CONNECT_TIMEOUT" ? true : `got ${JSON.stringify(r).slice(0, 160)}`;
});

await t("a DNS failure is reported rather than throwing", async () => {
  globalThis.fetch = async () => {
    const e = new Error("getaddrinfo ENOTFOUND api.dev.to");
    e.cause = { code: "ENOTFOUND" };
    throw e;
  };
  const r = await httpTransport(buildRequest("devto").request);
  return r.status === 0 && r.json?.code === "ENOTFOUND" ? true : `got ${JSON.stringify(r).slice(0, 160)}`;
});

await t("deliver survives a dead network and reports stage=transport", async () => {
  globalThis.fetch = async () => {
    const e = new Error("connection refused");
    e.cause = { code: "ECONNREFUSED" };
    throw e;
  };
  const r = await deliver("devto", { mode: "live" });
  globalThis.fetch = realFetch;
  if (r.sent) return "reported as sent";
  if (r.stage !== "transport") return `stage is ${r.stage}`;
  return r.status === 0 ? true : `status is ${r.status}`;
});

globalThis.fetch = realFetch;

/* ---------------------------------------------------------------- provider errors */

console.log("\nprovider — statuses the API can return\n" + "-".repeat(78));

const STATUSES = [
  [500, "an internal server error"],
  [502, "a bad gateway"],
  [503, "a service unavailable"],
  [429, "a rate limit"],
];

for (const [code, what] of STATUSES) {
  await t(`${code} — ${what} — is reported, not thrown`, async () => {
    globalThis.fetch = async () => new Response("<html>Server Error</html>", { status: code, headers: { "content-type": "text/html" } });
    const r = await httpTransport(buildRequest("devto").request);
    globalThis.fetch = realFetch;
    if (r.status !== code) return `status is ${r.status}`;
    /* A non-JSON body must not break the caller. */
    return r.json === null ? true : `json was ${JSON.stringify(r.json).slice(0, 60)}`;
  });
}

await t("a 200 with an unparseable body does not throw", async () => {
  globalThis.fetch = async () => new Response("not json at all", { status: 200 });
  const r = await httpTransport(buildRequest("devto").request);
  globalThis.fetch = realFetch;
  return r.status === 200 && r.ok === true && r.json === null ? true : `got ${JSON.stringify(r).slice(0, 120)}`;
});

await t("a 500 on a live send is BLOCKED, not SENT", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  const r = await deliver("devto", { mode: "live" });
  globalThis.fetch = realFetch;
  return !r.sent && r.status === 500 ? true : `sent=${r.sent} status=${r.status}`;
});

/* ---------------------------------------------------------------- credential gate */

console.log("\ncredentials — the live path must refuse without one\n" + "-".repeat(78));

await t("live with no key is refused before any request", async () => {
  const saved = process.env.DEVTO_API_KEY;
  delete process.env.DEVTO_API_KEY;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  const r = await deliver("devto", { mode: "live" });
  globalThis.fetch = realFetch;
  process.env.DEVTO_API_KEY = saved;
  if (called) return "fetch was called although no key was set";
  return r.stage === "credential" && !r.sent ? true : `stage=${r.stage} sent=${r.sent}`;
});

/* ---------------------------------------------------------------- logging */

/*
 * ------------------------------------------------------------------ logging
 *
 * These run last and each restores the key it needs. The credential-gate test above deletes
 * DEVTO_API_KEY to prove that a live send is refused without one, and the first version of this file
 * left it deleted: every later `mode: "live"` case was then refused at the credential stage, never
 * reached the transport, and the log-write test failed for a reason that had nothing to do with
 * logging. A test that changes global state has to put it back.
 */
console.log("\nlogging — a failed attempt must still be recorded\n" + "-".repeat(78));

await t("a transport failure is written to the delivery log", async () => {
  process.env.DEVTO_API_KEY = KEY;
  const before = existsSync("logs/delivery.jsonl") ? readFileSync("logs/delivery.jsonl", "utf8").split("\n").filter(Boolean).length : 0;
  globalThis.fetch = async () => {
    const e = new Error("network down");
    e.cause = { code: "EHOSTUNREACH" };
    throw e;
  };
  const r = await deliver("devto", { mode: "live" });
  globalThis.fetch = realFetch;
  if (r.stage !== "transport") return `expected a transport failure, got stage=${r.stage} status=${r.status}`;
  const after = readFileSync("logs/delivery.jsonl", "utf8").split("\n").filter(Boolean);
  if (after.length <= before) return "nothing was appended to the log";
  const last = JSON.parse(after[after.length - 1]);
  if (last.status !== 0) return `logged status is ${last.status}`;
  return last.transportFailed === true ? true : "the record does not mark the transport failure";
});

await t("a mock send is recorded with simulated=true", async () => {
  await deliver("devto", { mode: "mock" });
  const lines = readFileSync("logs/delivery.jsonl", "utf8").split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  return last.simulated === true && last.status === 201 ? true : `simulated=${last.simulated} status=${last.status}`;
});

await t("the outbox record carries the body and no credential value", async () => {
  await deliver("devto", { mode: "mock" });
  const log = readFileSync("logs/delivery.jsonl", "utf8");
  if (log.includes(KEY)) return "the API key appears in the log";
  const lines = log.split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  return last.body && last.credentialEnv === "DEVTO_API_KEY" ? true : "the record is missing its body or the env name";
});

/* ---------------------------------------------------------------- one bad platform */

console.log("\nbatch isolation — one failure must not end the run\n" + "-".repeat(78));

await t("an unknown platform returns a result rather than throwing", async () => {
  const r = await deliver("nope-not-a-platform");
  return r.sent === false && r.stage === "build" && Array.isArray(r.problems) ? true : `got ${JSON.stringify(r).slice(0, 120)}`;
});

await t("a platform with no api block is refused with a reason", async () => {
  const r = await deliver("x-post");
  return r.sent === false && /no api block/.test((r.problems ?? []).join(" ")) ? true : `problems: ${JSON.stringify(r.problems)}`;
});

await t("repeated failures do not corrupt the log (every line parses)", async () => {
  for (let i = 0; i < 5; i++) {
    globalThis.fetch = async () => {
      const e = new Error("flaky");
      e.cause = { code: "ECONNRESET" };
      throw e;
    };
    await deliver("devto", { mode: "live" });
  }
  globalThis.fetch = realFetch;
  const lines = readFileSync("logs/delivery.jsonl", "utf8").split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      JSON.parse(l);
    } catch {
      return `a line does not parse: ${l.slice(0, 80)}`;
    }
  }
  return true;
});

console.log("\n" + "=".repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\n  FAILURES:");
  for (const f of failures) console.log(`    - ${f}`);
}
process.exit(fail ? 1 : 0);
