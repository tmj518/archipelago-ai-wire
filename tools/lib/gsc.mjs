/**
 * Shared plumbing for the data scripts: curl-backed HTTP, and Search Console
 * access with a service account.
 *
 * Everything goes through curl rather than node fetch. On this workstation curl reads
 * %USERPROFILE%\.curlrc, which carries the local proxy and ssl-no-revoke; node fetch
 * honours neither, and this machine cannot reach Google without both. On a GitHub
 * runner there is no .curlrc and no proxy, and the same call connects directly - which
 * is why the binary is resolved by platform in httpCurl rather than named as curl.exe.
 */

import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** Synchronous sleep. setTimeout in a child process does not block. */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * .env files are read directly rather than with a dependency, and they do not
 * go through dotenv because the harness that spawns these shells captured its
 * environment at startup — new processes never inherit user-level variables.
 */
export function loadEnv(path) {
  const env = { ...process.env };
  if (path && existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

/**
 * curl under the name this platform gives it.
 *
 * It is curl.exe on Windows and curl everywhere else. The literal string used to be
 * "curl.exe", which is why this module had never once reached Google from a GitHub
 * runner: on ubuntu-latest the spawn fails with ENOENT before any request is made.
 *
 * That defect stayed invisible for as long as it did because gscAccessToken returned
 * null on a credential it could not read *before* it got this far. The ENOENT only
 * appeared once the credential was read correctly - on 2026-10-21, as a stack trace
 * in the place where a "0 rows" report had been.
 */
const CURL = process.platform === "win32" ? "curl.exe" : "curl";

export function httpCurl(args, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  return execFileSync(CURL, args, {
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * GET with retries. Not optional: this proxy path drops 25-50% of requests,
 * measured, and the loss is on the path rather than at any one provider.
 * Budget roughly 1.6 attempts per request.
 */
export function getWithRetry(url, { retries = 4, accept = "application/json", stats } = {}) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const raw = httpCurl([
        "-4", "-sS", "--max-time", "30",
        "-H", `Accept: ${accept}`,
        "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        "-w", "\n%{http_code}",
        url,
      ]);
      const idx = raw.lastIndexOf("\n");
      const status = parseInt(raw.slice(idx + 1).trim(), 10);
      const body = raw.slice(0, idx);
      if (status >= 200 && status < 300) return { status, body };
      if (status >= 400 && status < 500 && status !== 429) return { status, body };
      lastErr = new Error(`HTTP ${status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < retries) {
      if (stats) stats.retries++;
      sleepSync(i * 1500);
    }
  }
  throw lastErr;
}

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/**
 * Resolve GSC_CREDENTIALS into the service-account JSON, whichever of its three
 * real shapes arrived.
 *
 * The variable is one name with three honest values: the path to the key file
 * (the local .env.keywords mode, which is what .env.keywords.example documents),
 * the key document itself, or base64 of it (the mode .github/workflows/seo-audit.yml
 * uses, because a secret is a string and cannot be a file).
 *
 * All three used to be read as a path. existsSync() answers false for a blob of
 * base64 rather than throwing, so a workflow that put the document in this
 * variable was told "no credentials" - and gscAccessToken returned null, which
 * gscSearchAnalytics returned, which the caller rendered as *zero rows*. On
 * 2026-10-21 the ninety-day audit therefore reported an empty property while the
 * UI showed 718 impressions, and the empty result was read as "traffic is spread
 * over three months".
 *
 * Only an empty value is an absence. A value that cannot be read is a
 * configuration error and says so.
 */
export function gscCredentials(env) {
  const raw = String(env.GSC_CREDENTIALS ?? "").trim();
  if (!raw) return null;

  const attempts = [];
  const parse = (shape, text) => {
    const clean = String(text).replace(/^\uFEFF/, "").trim();
    if (!clean.startsWith("{")) {
      attempts.push(`${shape}: not a JSON document`);
      return null;
    }
    try {
      return { creds: JSON.parse(clean), shape };
    } catch (e) {
      attempts.push(`${shape}: ${e.message.slice(0, 80)}`);
      return null;
    }
  };

  /* A base64 secret is kilobytes long and carries no braces; a path is short and
     carries none either, but it is short. The test only avoids a pointless stat
     on a blob that could never be a filename. */
  const looksLikePath = raw.length <= 1024 && !/[{}]/.test(raw);
  if (looksLikePath && existsSync(raw)) {
    const fromFile = parse(`file ${raw}`, readFileSync(raw, "utf8"));
    if (fromFile) return fromFile;
    throw new Error(`GSC_CREDENTIALS names the file ${raw}, but that file is not a JSON document: ${attempts.at(-1)}.`);
  }
  if (looksLikePath) attempts.unshift(`file: ${raw} does not exist`);

  const inline = parse("inline JSON", raw);
  if (inline) return inline;
  const decoded = parse("base64 of the JSON", Buffer.from(raw, "base64").toString("utf8"));
  if (decoded) return decoded;

  throw new Error(
    "GSC_CREDENTIALS is set but holds no readable service-account key: " +
    `it names no existing file and parses neither as inline JSON nor as base64 of it. Tried - ${attempts.join("; ")}. ` +
    `Value begins with ${JSON.stringify(raw.slice(0, 8))} and is ${raw.length} character(s) long.`,
  );
}

/**
 * Service-account auth without the googleapis dependency: sign a JWT with the
 * key from the JSON file and exchange it for an access token. node:crypto does
 * RS256 natively, and googleapis would add tens of megabytes for two calls.
 */
export function gscAccessToken(env, stats, scope = "https://www.googleapis.com/auth/webmasters.readonly") {
  const resolved = gscCredentials(env);
  if (!resolved) return null;
  const creds = resolved.creds;
  if (!creds?.client_email || !creds?.private_key) {
    throw new Error(
      `GSC_CREDENTIALS (${resolved.shape}) has no client_email or private_key - is this a service-account key?`,
    );
  }
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      exp: iat + 3600,
      iat,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const jwt = `${signingInput}.${b64url(signer.sign(creds.private_key))}`;

  const body =
    `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}` +
    `&assertion=${jwt}`;
  const raw = httpCurl([
    "-4", "-sS", "--max-time", "30", "-X", "POST",
    "-H", "Content-Type: application/x-www-form-urlencoded",
    "-d", body, "https://oauth2.googleapis.com/token",
  ], { maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  if (!parsed.access_token) throw new Error(`token exchange failed: ${raw.slice(0, 200)}`);
  if (stats) stats.gscCalls = (stats.gscCalls ?? 0) + 1;
  return parsed.access_token;
}

/** Run a Search Analytics query. Returns the raw parsed response. */
export function gscSearchAnalytics(env, payload, stats) {
  const site = env.GSC_SITE_URL;
  if (!site) return null;
  const token = gscAccessToken(env, stats);
  if (!token) return null;
  if (stats) stats.gscCalls = (stats.gscCalls ?? 0) + 1;

  const url =
    "https://searchconsole.googleapis.com/webmasters/v3/sites/" +
    `${encodeURIComponent(site)}/searchAnalytics/query`;
  const raw = httpCurl([
    "-4", "-sS", "--max-time", "90", "-X", "POST",
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify(payload), url,
  ], { maxBuffer: 128 * 1024 * 1024 });

  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(`GSC: ${parsed.error.message}`);
  return parsed;
}

export function isoDaysAgo(days) {
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
