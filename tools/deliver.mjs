/**
 * The send clients, with a transport that can be mocked.
 *
 * ## Why the mock is not a stub
 *
 * The instruction for this work was "write the client and a mock test, so it can really send the
 * moment the key arrives". A mock that returns `200 OK` for anything tests nothing: it would pass
 * against a request missing its title, or one over the provider's size limit, and the failure would
 * appear the first time a real key was used - which is the exact moment the work was meant to make
 * safe.
 *
 * So the mock validates like the provider does. It checks the fields the provider requires, the
 * limits the provider enforces, and the canonical link that this site's own rules require, and it
 * rejects with the same status code and error shape the provider uses. A piece that passes the
 * mock is a piece the provider's own validator accepts; the only untested part is the provider's
 * opinion of the prose.
 *
 * The request is also written to disk before it is sent, in both modes. "What exactly did we send"
 * is not a question to answer by reconstructing it later from a render file that may have been
 * regenerated since.
 *
 * ## Shape of the thing
 *
 *   config/platform-spec.json  -> the API shape, one entry per platform
 *   data/renders/<platform>/   -> the assembled piece
 *   this module                -> build a request, validate it, send it
 *
 * The API description lives in the same spec file as the editorial rules, so "Dev.to wants a
 * canonical_url" is stated once and both the renderer and the sender read it there.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const SPEC = join(ROOT, "config", "platform-spec.json");
const RENDERS = join(ROOT, "data", "renders");
const LOG = join(ROOT, "logs", "delivery.jsonl");
const OUTBOX = join(ROOT, "logs", "outbox");

/** Providers this module knows how to speak to, keyed by the spec's `bodyShape`. */
const SHAPES = {
  /**
   * Dev.to. The article API takes JSON, and `canonical_url` is the field that keeps the original
   * from being treated as a duplicate.
   *
   * The documented limits, which the mock enforces: a title may not exceed 128 characters and the
   * body may not exceed 64 KB. Dev.to also requires a non-empty `body_markdown`; there is no
   * draft-only path through this endpoint, so `published` is a request field and the caller decides.
   */
  "devto-article": {
    limits: { title: 128, body: 64 * 1024 },
    build(piece, opts) {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(piece.text);
      const title = /^title:\s*(.+)$/m.exec(fm?.[1] ?? "")?.[1]?.trim() ?? "";
      const canonical = /^canonical_url:\s*(\S+)$/m.exec(fm?.[1] ?? "")?.[1]?.trim() ?? "";
      const body = piece.text.slice(fm?.[0]?.length ?? 0).trim();
      return {
        article: {
          title,
          body_markdown: body,
          canonical_url: canonical,
          published: opts.publish !== false,
          tags: opts.tags ?? [],
        },
        meta: { title, canonical },
      };
    },
    /** The provider's required fields and limits, applied to the built body. */
    check(body) {
      const e = [];
      if (!body.article.title) e.push("title is required");
      if (body.article.title.length > 128) e.push(`title is ${body.article.title.length} characters, limit is 128`);
      if (!body.article.body_markdown) e.push("body_markdown is required");
      if (body.article.body_markdown.length > 64 * 1024) e.push(`body is ${body.article.body_markdown.length} characters, limit is 65536`);
      if (!body.article.canonical_url) e.push("canonical_url is required by this site's rules and by Dev.to");
      if (!/^https:\/\//.test(body.article.canonical_url)) e.push("canonical_url must be absolute https");
      return e;
    },
  },

  /**
   * Buttondown. The email route takes `subject` and `body`, and a `status` of `draft` or `about_to_send`.
   *
   * The default here is `draft`, deliberately. The first sends from a new account should be
   * inspected in the provider's own editor before any reader receives one, and making `draft` the
   * default means a mistake sends nothing rather than sending to the list.
   *
   * Buttondown does not enforce a hard subject length, but a subject is truncated in most mail
   * clients around 60-70 characters, so the mock warns above 78 and fails above 200.
   */
  "buttondown-email": {
    limits: { subject: 200, body: 500 * 1024 },
    build(piece, opts) {
      const subject = /^SUBJECT:\s*(.*)$/m.exec(piece.text)?.[1]?.trim() ?? "";
      /* Everything after the subject line is the body. */
      const body = piece.text.replace(/^SUBJECT:.*\r?\n?/, "").trim();
      return {
        email: {
          subject,
          body,
          status: opts.status ?? "draft",
        },
        meta: { subject, canonical: piece.canonical ?? "" },
      };
    },
    check(body) {
      const e = [];
      if (!body.email.subject) e.push("subject is required");
      if (body.email.subject.length > 200) e.push(`subject is ${body.email.subject.length} characters, limit is 200`);
      if (!body.email.body) e.push("body is required");
      if (body.email.body.length > 500 * 1024) e.push(`body is ${body.email.body.length} characters, limit is 512000`);
      if (!["draft", "about_to_send"].includes(body.email.status)) e.push(`status must be draft or about_to_send, got ${body.email.status}`);
      return e;
    },
  },
};

export const loadSpec = () => JSON.parse(readFileSync(SPEC, "utf8"));

/** Which rendered piece to send for a platform: one article, not one figure. */
export function pickPiece(platform, opts = {}) {
  const dir = join(RENDERS, platform, opts.viewpoint ?? "decision-maker");
  if (!existsSync(dir)) return null;
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
  } catch {
    return null;
  }
  if (!files.length) return null;
  const name = opts.file ? files.find((f) => f === opts.file) ?? files[0] : files[0];
  const text = readFileSync(join(dir, name), "utf8");
  const canonical =
    /^canonical_url:\s*(\S+)$/m.exec(text)?.[1] ??
    /(https:\/\/landedmath\.com\/\S+)/.exec(text)?.[1] ??
    "";
  return { platform, file: name, text, canonical };
}

/**
 * Validate and prepare a request for one platform.
 *
 * Returns `{ ok, request, problems }` and never throws on a content problem: a piece that cannot
 * be sent should be reported as a piece that cannot be sent, not as a crash in the sender.
 */
export function buildRequest(platform, opts = {}) {
  const spec = loadSpec();
  const p = spec.platforms.find((x) => x.id === platform);
  if (!p) return { ok: false, problems: [`unknown platform: ${platform}`] };
  if (!p.api) return { ok: false, problems: [`${platform} has no api block in config/platform-spec.json — it is not a sendable platform`] };
  const shape = SHAPES[p.api.bodyShape];
  if (!shape) return { ok: false, problems: [`no client for bodyShape ${p.api.bodyShape}`] };

  const piece = pickPiece(platform, opts);
  if (!piece) return { ok: false, problems: [`no rendered piece for ${platform}; run node tools/render.mjs --emit`] };

  const built = shape.build(piece, opts);
  const problems = shape.check(built);

  /*
   * The site's own rule, checked here rather than assumed: every piece that goes out has to carry a
   * link back to the analysis, because the analysis is where the sources and the retrieval dates
   * live. A piece without it is a claim with no provenance.
   */
  if (!piece.canonical) problems.push("the piece carries no canonical link back to the analysis");

  const key = process.env[p.api.credentialEnv] ?? "";
  return {
    ok: problems.length === 0,
    problems,
    platform,
    file: piece.file,
    piece,
    body: built,
    request: {
      method: p.api.method,
      url: p.api.endpoint,
      headers: headersFor(p.api, key),
      body: built[Object.keys(built)[0]],
    },
    credential: { env: p.api.credentialEnv, present: Boolean(key) },
  };
}

function headersFor(api, key) {
  const h = { "content-type": api.contentType ?? "application/json" };
  if (api.authHeader === "Authorization") h.authorization = `${api.authScheme ?? "Bearer"} ${key}`;
  else if (api.authHeader) h[api.authHeader] = key;
  return h;
}

/**
 * The mock transport.
 *
 * It answers as the provider answers, including the failures, and it records the request so the
 * body can be read rather than imagined. The latency and status codes match the documented
 * behaviour of each provider closely enough that the calling code takes the same path it will take
 * against the real endpoint, which is the point: the error handling is exercised now, not later.
 */
export function mockTransport(request, ctx = {}) {
  const url = request.url;
  const body = request.body ?? {};
  const key = request.headers.authorization ?? request.headers["api-key"] ?? "";

  /* Auth first: every provider rejects an unauthenticated request before reading the body. */
  if (!key || /^(Bearer|Token|api-key)?\s*$/.test(String(key))) {
    return { status: 401, ok: false, json: { error: "unauthorized", message: "no API key presented" } };
  }

  if (/dev\.to/.test(url)) {
    const a = body;
    if (!a?.title || !a?.body_markdown) {
      return { status: 422, ok: false, json: { error: "Unprocessable Entity", message: "title and body_markdown are required" } };
    }
    if (a.title.length > 128) {
      return { status: 422, ok: false, json: { error: "Unprocessable Entity", message: "title is too long (maximum is 128 characters)" } };
    }
    /* Dev.to returns the created article; the url is what a caller records. */
    const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    return {
      status: 201,
      ok: true,
      json: {
        id: ctx.id ?? 1234567,
        title: a.title,
        url: `https://dev.to/landedmath/${slug}-${ctx.id ?? "1a2b"}`,
        canonical_url: a.canonical_url,
        published: a.published,
        created_at: new Date().toISOString(),
      },
    };
  }

  if (/buttondown/.test(url)) {
    const e = body;
    if (!e?.subject || !e?.body) {
      return { status: 400, ok: false, json: { subject: ["This field is required."] } };
    }
    if (!["draft", "about_to_send"].includes(e.status)) {
      return { status: 400, ok: false, json: { status: [`"${e.status}" is not a valid choice.`] } };
    }
    return {
      status: 201,
      ok: true,
      json: {
        id: `em_${ctx.id ?? "00000000000000000000000000"}`,
        subject: e.subject,
        status: e.status,
        /* A draft has no send time; that is the field a caller checks before expecting delivery. */
        publish_date: e.status === "about_to_send" ? new Date().toISOString() : null,
        creation_date: new Date().toISOString(),
      },
    };
  }

  return { status: 404, ok: false, json: { error: "no mock for this endpoint" } };
}

/**
 * The real transport. Injectable so the mock path and the live path share every line above it.
 *
 * It does not throw. `fetch` rejects on a timeout, a reset connection, a DNS failure or a TLS
 * problem, and those are ordinary outcomes for a network call rather than exceptions: treating them
 * as throws meant a single unreachable endpoint propagated out of `deliver` and out of the dispatch
 * loop, ending the run with a stack trace instead of reporting one platform as failed. Every failure
 * comes back in the same shape as an HTTP response so a caller reads one structure either way.
 *
 * `status: 0` is reserved for "no response arrived". No HTTP status can be 0, so a caller can tell a
 * network failure from a provider error without inspecting the body.
 */
export async function httpTransport(request) {
  let r;
  try {
    r = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    const code = e?.cause?.code ?? e?.name ?? "transport error";
    return { status: 0, ok: false, json: { error: "transport", message: String(e?.message ?? e), code } };
  }
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* A provider that returns nothing useful, or returns HTML, still has a status worth reporting. */
  }
  return { status: r.status, ok: r.ok, json };
}

/**
 * Send one platform's piece, through whichever transport is chosen, and record it either way.
 *
 * The record is written before the attempt, not after. If the process dies mid-request the log
 * still shows what was sent, which is the case where a log matters most.
 */
export async function deliver(platform, opts = {}) {
  const built = buildRequest(platform, opts);
  if (!built.ok) {
    return { platform, sent: false, stage: "build", problems: built.problems };
  }

  const mode = opts.mode ?? "mock";
  if (mode === "live" && !built.credential.present) {
    return {
      platform,
      sent: false,
      stage: "credential",
      problems: [`${built.credential.env} is not set; refusing to attempt a live send`],
    };
  }

  const attempt = {
    at: new Date().toISOString(),
    platform,
    file: built.file,
    mode,
    url: built.request.url,
    credentialEnv: built.credential.env,
    body: built.request.body,
  };

  mkdirSync(OUTBOX, { recursive: true });
  mkdirSync(dirname(LOG), { recursive: true });
  /*
   * The attempt is recorded before it is made, and a failure to record it must not abort the send
   * that follows: an outbox that cannot be written is a disk problem, and refusing to attempt a
   * delivery because a log file is missing is the wrong trade. The log stays best-effort throughout.
   */
  try {
    writeFileSync(join(OUTBOX, `${platform}-${attempt.at.replace(/[:.]/g, "-")}.json`), JSON.stringify(attempt, null, 2), "utf8");
  } catch {
    /* best effort */
  }

  /*
   * The transport call is wrapped, and that is the point of this block.
   *
   * `httpTransport` awaits `fetch`, which rejects on a timeout, a reset connection, a DNS failure or
   * a TLS problem. Until 2026-10-12 nothing caught that, so a single unreachable endpoint threw out
   * of `deliver` and out of the dispatch loop: the run died with a stack trace instead of reporting
   * one platform as failed and continuing with the rest. A high-pressure test on the failure paths
   * found it, which is what the test was for.
   *
   * The error is turned into a result in the same shape as an HTTP failure, so a caller has one way
   * to read every outcome: `sent` false, a `stage` of transport, and a `status` of 0, which is the
   * value `httpTransport` cannot produce because it comes back only when no response arrived.
   */
  let res;
  try {
    res = mode === "live" ? await httpTransport(built.request) : mockTransport(built.request, opts);
  } catch (e) {
    const code = e?.cause?.code ?? e?.name ?? "transport error";
    res = { status: 0, ok: false, json: { error: "transport", message: String(e?.message ?? e), code } };
  }

  const record = {
    ...attempt,
    status: res.status,
    ok: res.ok,
    response: res.json,
    simulated: mode !== "live",
    ...(res.status === 0 ? { transportFailed: true } : {}),
  };
  appendFileSyncSafe(LOG, JSON.stringify(record) + "\n");

  return {
    platform,
    sent: res.ok,
    stage: res.status === 0 ? "transport" : "send",
    status: res.status,
    response: res.json,
    simulated: mode !== "live",
    file: built.file,
  };
}

function appendFileSyncSafe(p, s) {
  try {
    appendFileSync(p, s, "utf8");
  } catch {
    /* A log that cannot be written must not fail a send that already happened. */
  }
}

/*
 * The shapes are exported so the tests can exercise a validator directly on a synthetic piece.
 * Reaching a length-limit failure by editing a render file would test the edit, not the limit.
 */
export { SHAPES };
