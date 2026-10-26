#!/usr/bin/env node
/**
 * The Feishu ledger safety suite.
 *
 *   node tests/feishu-safety.mjs
 *
 * ## What it is protecting against
 *
 * On 2026-10-26 the data audit found `tools/feishu-run-ledger.mjs` doing this: read the recorded base
 * identifier, ask Feishu whether it could read that base, and on **any** failure clear the identifier
 * and create a brand-new base. A permissions error, a rate limit, a deleted base or an offline network
 * all produced a second base and overwrote the only pointer to the first.
 *
 * Creating a base is an external, irreversible action against a real account. It must not be a fallback
 * for a failed read, and it must not be possible to test it by doing it. So the decision was extracted
 * into `src/lib/feishu-target.mjs` as a pure function, and this suite exercises both that function and
 * the command's `--check-config` path, which answers and exits before the first request.
 *
 * ## How "no network request" is proven
 *
 * Three ways, because "it returned quickly" is not evidence:
 *
 *   1. the decision cases run against a pure function that imports no network module at all;
 *   2. every spawned case uses `--check-config`, and the suite asserts that this block appears in the
 *      source BEFORE the first call that could dial out (`apiRetry`);
 *   3. the spawned cases run with HTTPS_PROXY pointing at a closed port, so a request would fail loudly
 *      rather than quietly succeed. They pass, which they could not if anything dialled.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "tools", "feishu-run-ledger.mjs");
const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok, detail });

const lib = await import(pathToFileURL(join(ROOT, "src", "lib", "feishu-target.mjs")).href);

/* ── the pure decision table ─────────────────────────────────────────────────────────────────── */

const missing = { kind: "missing" };
const present = (appToken) => ({ kind: "present", target: { appToken } });

const d1 = lib.decideBase({ targetState: missing, createBase: false });
record("decision: no config and no flag refuses", d1.action === "fail" && d1.code === 78, d1.reason);
record("decision: the refusal names what to check", Array.isArray(d1.missing) && d1.missing.length > 0);

const d2 = lib.decideBase({ targetState: missing, createBase: true });
record("decision: no config WITH --create-base may create", d2.action === "create");
record("decision: the default name is the new one", d2.name === "Archipelago AI Wire Operations Ledger", d2.name);
record("decision: the old base name is gone", !/Landed Math|数据中控台/.test(JSON.stringify(d2)));

const d3 = lib.decideBase({ targetState: missing, createBase: true, baseName: "Custom Ledger" });
record("decision: a configured name wins", d3.action === "create" && d3.name === "Custom Ledger");

const d4 = lib.decideBase({ targetState: present("app-token-abc123"), createBase: false });
record("decision: a recorded token is used, not recreated", d4.action === "use" && d4.source === "recorded");

const d5 = lib.decideBase({ targetState: present("app-token-abc123"), createBase: true });
record("decision: --create-base does not override an existing token", d5.action === "use");

const d6 = lib.decideBase({ envToken: "env-token-xyz", targetState: present("app-token-abc123") });
record("decision: the environment wins over the file", d6.action === "use" && d6.source === "environment");

const d7 = lib.decideBase({ targetState: { kind: "corrupt", detail: "Unexpected token" }, createBase: true });
record("decision: a corrupt target file stops even with --create-base", d7.action === "fail" && d7.reason === "corrupt-target");

const d8 = lib.decideBase({ targetState: present(""), createBase: false });
record("decision: a target file with no appToken refuses", d8.action === "fail" && d8.reason === "no-token-in-target");

const d9 = lib.decideBase({ targetState: present(""), createBase: true });
record("decision: a target file with no appToken may create only with the flag", d9.action === "create");

/* ── secrets never reach a log line ─────────────────────────────────────────────────────────── */

const SECRET = "app-token-SUPERSECRET-123";
record("redact: a token is removed from a message", !lib.redact(`GET /x/${SECRET}/tables failed`, [SECRET]).includes(SECRET));
record("redact: the message survives around it", /GET \/x\/<redacted>\/tables failed/.test(lib.redact(`GET /x/${SECRET}/tables failed`, [SECRET])));
record("redact: short strings are left alone", lib.redact("code 91403", ["1"]) === "code 91403");
const fp = lib.fingerprint(SECRET);
record("fingerprint: identifies without revealing", fp.length === 8 && !SECRET.includes(fp) && fp !== SECRET);

/* ── the command, without a network ─────────────────────────────────────────────────────────── */

const work = mkdtempSync(join(tmpdir(), "feishu-safety-"));
const targetFile = join(work, "ledger-target.json");
const emptyEnv = { ...process.env, FEISHU_APP_ID: "", FEISHU_APP_SECRET: "", FEISHU_APP_TOKEN: "", FEISHU_BASE_NAME: "" };
const fakeEnv = { ...process.env, FEISHU_APP_ID: "test-app-id", FEISHU_APP_SECRET: "test-app-secret", FEISHU_APP_TOKEN: "", FEISHU_BASE_NAME: "" };

// A base that resolves nowhere, so a request would fail rather than succeed silently.
for (const key of Object.keys(emptyEnv)) if (/^(HTTPS?_PROXY|ALL_PROXY)$/i.test(key)) delete emptyEnv[key];
emptyEnv.HTTPS_PROXY = "http://127.0.0.1:1";
emptyEnv.HTTP_PROXY = "http://127.0.0.1:1";
Object.assign(fakeEnv, { HTTPS_PROXY: emptyEnv.HTTPS_PROXY, HTTP_PROXY: emptyEnv.HTTP_PROXY });

function run(args, env) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: "utf8", timeout: 60000, env });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// 1  no config, no flag
const c1 = run(["--check-config", `--target-file=${targetFile}`], emptyEnv);
record("cli: no config and no flag exits 78", c1.code === 78, `exit ${c1.code}`);
record("cli: it says STOP and not 'would CREATE'", /STOP/.test(c1.out) && !/would CREATE/.test(c1.out));

// 2  no config, with the flag: reaches the create decision, still no request
const c2 = run(["--check-config", "--create-base", `--target-file=${targetFile}`], fakeEnv);
record("cli: --create-base reaches a controlled create decision", c2.code === 0, `exit ${c2.code}`);
record("cli: the decision names the new base", /would CREATE a base named "Archipelago AI Wire Operations Ledger"/.test(c2.out));
record("cli: the old base name is not used", !/Landed Math|数据中控台/.test(c2.out));

// 3  a recorded identifier is used, never recreated
writeFileSync(targetFile, JSON.stringify({ appToken: SECRET }), "utf8");
const c3 = run(["--check-config", `--target-file=${targetFile}`], fakeEnv);
record("cli: a recorded identifier is used", c3.code === 0 && /use the base from the recorded/.test(c3.out), `exit ${c3.code}`);
record("cli: the identifier is never printed", !c3.out.includes(SECRET));
record("cli: but a fingerprint is shown", new RegExp(lib.fingerprint(SECRET)).test(c3.out));

// 4  a corrupt target file stops, and the file is left exactly as it was
writeFileSync(targetFile, "{ not json ", "utf8");
const before = readFileSync(targetFile, "utf8");
const c4 = run(["--check-config", "--create-base", `--target-file=${targetFile}`], fakeEnv);
record("cli: a corrupt target stops even with --create-base", c4.code === 78, `exit ${c4.code}`);
record("cli: the corrupt file is not rewritten", readFileSync(targetFile, "utf8") === before);

rmSync(work, { recursive: true, force: true });

/* ── the source-level guarantees ───────────────────────────────────────────────────────────── */

const src = readFileSync(TOOL, "utf8");

record(
  "source: the create call appears exactly once",
  (src.match(/api\("\/bitable\/v1\/apps"/g) ?? []).length === 1,
  `${(src.match(/api\("\/bitable\/v1\/apps"/g) ?? []).length} occurrence(s)`,
);
record("source: the create call is guarded by the missing-token branch", /if \(!APP_TOKEN\) \{[\s\S]{0,200}api\("\/bitable\/v1\/apps"/.test(src));
record("source: a failed read no longer clears the identifier", !/catch[\s\S]{0,200}APP_TOKEN = ""/.test(src.slice(src.indexOf("the configured base is not readable") - 200, src.indexOf("the configured base is not readable") + 800)));
record("source: a failed read stops the run", /is not readable[\s\S]{0,400}process\.exit\(1\)/.test(src));
record("source: it says the identifier is kept", /the recorded identifier is kept/.test(src));

const idxCheck = src.indexOf("if (CHECK_CONFIG)");
const idxFirstDial = src.indexOf("await apiRetry(");
record("source: --check-config answers before anything dials out", idxCheck > 0 && idxFirstDial > idxCheck, `${idxCheck} < ${idxFirstDial}`);

/* ── the sibling tools ─────────────────────────────────────────────────────────────────────── */

const syncSrc = readFileSync(join(ROOT, "tools", "feishu-sync.mjs"), "utf8");
record("sibling: feishu-sync never creates a base", !/api\("\/bitable\/v1\/apps"/.test(syncSrc) && !/\/bitable\/v1\/apps`, \{[\s\S]{0,80}method: "POST"/.test(syncSrc));
record("sibling: feishu-sync refuses to run without a token", /if \(MISSING\.length && !DRY\)/.test(syncSrc));

const ledgerSrc = readFileSync(join(ROOT, "tools", "feishu-ledger.mjs"), "utf8");
record("sibling: the explicit creator requires --force before replacing a target", /existsSync\(TARGET\) && !FORCE/.test(ledgerSrc));
record("sibling: the explicit creator does not use the old base name", !/Landed Math/.test(ledgerSrc));

/* ── report ────────────────────────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.ok);
console.log("FEISHU LEDGER SAFETY\n" + "=".repeat(78));
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
console.log("");
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("\nFAILURES:");
  for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("RESULT: PASS - no request was made; no base was created");
