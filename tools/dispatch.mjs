/**
 * Dispatch — send rendered pieces, mock by default.
 *
 *   node tools/dispatch.mjs --list
 *   node tools/dispatch.mjs --platform devto
 *   node tools/dispatch.mjs --platform beehiiv --status about_to_send
 *   node tools/dispatch.mjs --all
 *   node tools/dispatch.mjs --platform devto --live        # needs DEVTO_API_KEY
 *
 * Mock is the default and `--live` is the only way to reach the network, because the failure mode
 * of the wrong default is sending to a real audience. The reverse default cannot be undone.
 *
 * Credentials are read from the environment, and from `.env.<name>` at the repository root if it
 * exists. No key is ever written to the log or the outbox: the request is recorded with the header
 * names it used and without their values, so a log can be shared without leaking a token.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadSpec, deliver } from "./deliver.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
/**
 * Read a flag's value in either spelling.
 *
 * `--platform=devto` and `--platform devto` are both natural to type, and the first version of this
 * only understood the equals form: passing a space produced "nothing to do" and looked like the
 * platform was unknown. Both are accepted here so the tool never silently ignores an argument.
 */
const val = (f) => {
  const eq = args.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = args.indexOf(f);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return null;
};

/** Load `.env` files if present. Real environment variables always win. */
function loadEnvFiles() {
  const loaded = [];
  for (const name of [".env", ".env.keywords", ".env.r2"]) {
    const p = join(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const [, k, raw] = m;
      const v = raw.replace(/^["']|["']$/g, "");
      if (process.env[k] === undefined) process.env[k] = v;
      loaded.push(k);
    }
  }
  return loaded;
}

const spec = loadSpec();
/** Platforms that have an api block: those are the ones that can actually be sent. */
const sendable = spec.platforms.filter((p) => p.api);

if (has("--list")) {
  console.log(`SENDABLE PLATFORMS (${sendable.length} of ${spec.platforms.length})\n${"=".repeat(74)}`);
  for (const p of sendable) {
    const key = process.env[p.api.credentialEnv];
    console.log(`  ${p.id.padEnd(16)} ${p.api.bodyShape.padEnd(20)} ${p.api.credentialEnv.padEnd(20)} ${key ? "key present" : "no key"}`);
  }
  const notYet = spec.platforms.filter((p) => !p.api);
  console.log(`\n  without an api block (${notYet.length}): ${notYet.map((p) => p.id).join(", ")}`);
  console.log("\n  Those need a decision about whether they have a usable API at all, not a key.");
  process.exit(0);
}

const loaded = loadEnvFiles();
if (loaded.length) console.log(`  loaded from .env files: ${[...new Set(loaded)].join(", ")}`);

const mode = has("--live") ? "live" : "mock";
const opts = {
  mode,
  status: val("--status") ?? undefined,
  viewpoint: val("--viewpoint") ?? undefined,
  file: val("--file") ?? undefined,
  tags: val("--tags") ? val("--tags").split(",") : undefined,
};

let targets = [];
if (has("--all")) targets = sendable.map((p) => p.id);
else if (val("--platform")) targets = val("--platform").split(",").map((s) => s.trim()).filter(Boolean);
else {
  console.log("  nothing to do. Use --list, --platform <id>, or --all.");
  process.exit(0);
}

console.log(`\nDISPATCH — mode=${mode}${mode === "mock" ? " (nothing leaves this machine)" : " (REAL SENDS)"}\n${"=".repeat(74)}`);

let sent = 0;
let blocked = 0;

for (const platform of targets) {
  /*
   * Each platform is attempted inside its own try, so one failure cannot end the batch.
   *
   * `deliver` turns a transport error into a result rather than throwing, but this guard stays: an
   * unexpected throw - a render file that cannot be read, a shape with no client - should cost one
   * platform rather than the run. Before the guard existed a single unreachable endpoint ended the
   * loop and the remaining platforms were never attempted, with nothing in the output saying so.
   */
  let r;
  try {
    r = await deliver(platform, opts);
  } catch (e) {
    console.log(`  CRASHED  ${platform}`);
    console.log(`             - ${String(e?.message ?? e).slice(0, 140)}`);
    blocked++;
    continue;
  }
  const mark = r.sent ? "SENT" : "BLOCKED";
  console.log(`  ${mark.padEnd(8)} ${platform.padEnd(16)} ${r.stage ?? ""}`.trimEnd());
  if (r.problems) for (const p of r.problems) console.log(`             - ${p}`);
  if (r.response && r.sent) {
    const url = r.response.url ?? r.response.id ?? "";
    console.log(`             status ${r.status}${r.simulated ? " (simulated)" : ""}  ${url}`);
  }
  if (!r.sent && r.status === 0) {
    console.log(`             transport failure: ${r.response?.code ?? "no response"} - ${String(r.response?.message ?? "").slice(0, 90)}`);
  }
  if (r.sent) sent++;
  else blocked++;
}

console.log(`\n  ${sent} sent, ${blocked} blocked.`);
console.log(`  requests recorded in logs/outbox/ and logs/delivery.jsonl`);
if (mode === "mock") console.log(`  \n  Nothing was sent. Re-run with --live once the key is in place.`);
