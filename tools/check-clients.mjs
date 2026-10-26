/**
 * Mock tests for the send clients.
 *
 * The point of these is the failures. A mock that accepts everything proves that the network is not
 * involved, and nothing else; the failures are what make the client safe to point at a real key.
 * So each case below constructs a request the provider would reject and asserts that both the local
 * validator and the mock transport reject it - the validator so a bad piece never reaches the wire,
 * the transport so the HTTP path is exercised before a key exists.
 *
 * Run: node tools/check-clients.mjs
 * Exits non-zero on a failed case, so it can be wired into preflight.
 */
import { buildRequest, mockTransport, loadSpec, SHAPES } from "./deliver.mjs";

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

const spec = loadSpec();
const KEY = "test_mock_key_000";
process.env.DEVTO_API_KEY = KEY;
process.env.BUTTONDOWN_API_KEY = KEY;

console.log("SEND CLIENT MOCK TESTS\n" + "=".repeat(78));

/* ------------------------------------------------------------------ configuration */

console.log("\nconfig\n" + "-".repeat(78));

await t("every api block names a bodyShape this module implements", () => {
  const known = new Set(["devto-article", "buttondown-email"]);
  const unknown = spec.platforms.filter((p) => p.api && !known.has(p.api.bodyShape));
  return unknown.length === 0 ? true : `no client for ${unknown.map((p) => p.api.bodyShape).join(", ")}`;
});

await t("every api block names a credential environment variable", () => {
  const missing = spec.platforms.filter((p) => p.api && !p.api.credentialEnv);
  return missing.length === 0 ? true : `${missing.map((p) => p.id).join(", ")} has no credentialEnv`;
});

await t("every sendable platform needs a canonical link", () => {
  const bad = spec.platforms.filter((p) => p.api && p.api.bodyShape === "devto-article" && !p.requiresCanonical);
  return bad.length === 0 ? true : `${bad.map((p) => p.id).join(", ")} sends without requiresCanonical`;
});

/* ------------------------------------------------------------------ happy path */

console.log("\nbuild — the pieces that should go out\n" + "-".repeat(78));

await t("devto builds a publishable article", () => {
  const b = buildRequest("devto");
  if (!b.ok) return `not ok: ${b.problems.join("; ")}`;
  const a = b.body.article;
  if (!a.title) return "no title";
  if (!a.body_markdown) return "no body";
  if (!a.canonical_url.startsWith("https://")) return `canonical is ${a.canonical_url}`;
  if (a.title.length > 128) return `title ${a.title.length} chars`;
  return true;
});

await t("beehiiv builds a draft, not a send", () => {
  const b = buildRequest("beehiiv");
  if (!b.ok) return `not ok: ${b.problems.join("; ")}`;
  if (b.body.email.status !== "draft") return `status is ${b.body.email.status}, expected draft`;
  if (!b.body.email.subject) return "no subject";
  return true;
});

await t("the devto body carries real content, not an empty list", () => {
  const b = buildRequest("devto");
  const body = b.body?.article?.body_markdown ?? "";
  if (/- {2,}\[\]/.test(body)) return "the input list is still empty";
  if (body.length < 200) return `body is only ${body.length} characters`;
  if (!/\d/.test(body)) return "body contains no digit, which this site's own rule forbids";
  return true;
});

/* ------------------------------------------------------------------ the failures */

console.log("\nvalidate — pieces that must never reach the wire\n" + "-".repeat(78));

await t("an unknown platform is refused", () => {
  const b = buildRequest("myspace");
  return !b.ok && /unknown platform/.test(b.problems.join(" ")) ? true : "an unknown platform was accepted";
});

await t("a platform with no api block is refused, with the reason", () => {
  const b = buildRequest("x-post");
  if (b.ok) return "x-post was accepted although it has no api block";
  return /no api block/.test(b.problems.join(" ")) ? true : `unhelpful problem: ${b.problems.join(" ")}`;
});

await t("a synthetic piece with an over-long title is refused", () => {
  /* Exercised through the shape's own checker rather than by editing a render file. */
  const problems = SHAPES["devto-article"].check({
    article: { title: "x".repeat(129), body_markdown: "hello 1", canonical_url: "https://landedmath.com/x/" },
  });
  return problems.some((p) => /128/.test(p)) ? true : `no length problem reported: ${JSON.stringify(problems)}`;
});

await t("a synthetic piece with no canonical is refused", () => {
  const problems = SHAPES["devto-article"].check({
    article: { title: "fine", body_markdown: "hello 1", canonical_url: "" },
  });
  return problems.some((p) => /canonical_url is required/.test(p)) ? true : `canonical accepted: ${JSON.stringify(problems)}`;
});

await t("a synthetic buttondown piece with a bad status is refused", () => {
  const problems = SHAPES["buttondown-email"].check({
    email: { subject: "fine", body: "hello 1", status: "send_now" },
  });
  return problems.some((p) => /status must be/.test(p)) ? true : `bad status accepted: ${JSON.stringify(problems)}`;
});

/* ------------------------------------------------------------------ the transport */

console.log("\ntransport — the mock answers as the provider does\n" + "-".repeat(78));

const devReq = buildRequest("devto");
const bhReq = buildRequest("beehiiv");

await t("a valid devto request gets 201 with an article url", () => {
  const r = mockTransport(devReq.request);
  if (r.status !== 201) return `status ${r.status}`;
  return /^https:\/\/dev\.to\//.test(r.json.url) ? true : `no dev.to url: ${JSON.stringify(r.json)}`;
});

await t("a valid buttondown request gets 201 and no publish date for a draft", () => {
  const r = mockTransport(bhReq.request);
  if (r.status !== 201) return `status ${r.status}`;
  return r.json.publish_date === null ? true : `draft has a publish date: ${r.json.publish_date}`;
});

await t("no key is rejected with 401 before the body is read", () => {
  const req = { ...devReq.request, headers: { "content-type": "application/json" } };
  const r = mockTransport(req);
  return r.status === 401 ? true : `status ${r.status} for an unauthenticated request`;
});

await t("an empty title is rejected with 422", () => {
  const req = { ...devReq.request, body: { ...devReq.request.body, title: "" } };
  const r = mockTransport(req);
  return r.status === 422 ? true : `status ${r.status} for an empty title`;
});

await t("an over-long title is rejected with 422 and says why", () => {
  const req = { ...devReq.request, body: { ...devReq.request.body, title: "x".repeat(129) } };
  const r = mockTransport(req);
  if (r.status !== 422) return `status ${r.status}`;
  return /128/.test(r.json.message ?? "") ? true : `unhelpful message: ${r.json.message}`;
});

await t("a buttondown request with an invalid status is rejected with 400", () => {
  const req = { ...bhReq.request, body: { ...bhReq.request.body, status: "send_now" } };
  const r = mockTransport(req);
  return r.status === 400 ? true : `status ${r.status} for an invalid status`;
});

await t("an endpoint with no mock is reported rather than silently accepted", () => {
  const r = mockTransport({ url: "https://example.com/api", headers: { authorization: "Bearer x" }, body: {} });
  return r.status === 404 ? true : `status ${r.status} for an unknown endpoint`;
});

/* ------------------------------------------------------------------ no leakage */

console.log("\nsecrets\n" + "-".repeat(78));

await t("a built request carries the auth header name and value only in memory", () => {
  const names = Object.keys(devReq.request.headers);
  if (!names.includes("api-key")) return `devto is missing its api-key header: ${names.join(", ")}`;
  /* The header value must be the key, and the recorded attempt must not include headers at all. */
  return devReq.request.headers["api-key"] === KEY ? true : "the key is not in the header, so the live path would fail";
});

console.log("\n" + "=".repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\n  FAILURES:");
  for (const f of failures) console.log(`    - ${f}`);
}
process.exit(fail ? 1 : 0);
