/**
 * Deciding which Bitable base the run ledger may use, before anything is called.
 *
 * ## Why this is separate from the tool
 *
 * `tools/feishu-run-ledger.mjs` used to decide in the middle of a network call: it took whatever token
 * was recorded, asked Feishu whether it could read that base, and on **any** failure cleared the token
 * and created a brand-new base. The recorded identifier was overwritten on the way out, so the old
 * ledger was not just abandoned - the only pointer to it was destroyed.
 *
 * Two things follow from that design and both are fixed here:
 *
 *   A missing or unreadable configuration is not evidence that no base exists. It is evidence that
 *   somebody has to look. Creating a base is an external, irreversible action against a paid account,
 *   and it must never be a fallback for a failed read.
 *
 *   A decision that spends money or creates cloud resources has to be testable without spending
 *   anything. Keeping it in a pure function means the six states below are exercised in a unit test,
 *   with no credential, no network and no account.
 *
 * ## The decision table
 *
 *   env token set            use it (the environment always wins; a deployment that names a base
 *                            explicitly must not be overridden by a file)
 *   recorded token           use it, and let the caller verify it. A verification failure STOPS the
 *                            run - it does not erase the identifier and it does not create anything
 *   no token, --create-base  create, with the configured or default name
 *   no token, no flag        fail closed with exit 78 and name what to check
 *   corrupt target file      fail closed even with --create-base: a file that will not parse is a
 *                            question for a human, and overwriting it would hide the reason
 */
import { createHash } from "node:crypto";

/** The name a freshly created base gets. The previous project's name is deliberately gone. */
export const DEFAULT_BASE_NAME = "Archipelago AI Wire Operations Ledger";

/** Exit code for "the configuration is not usable", matching the C line's NO-QUEUE convention. */
export const EX_CONFIG = 78;

/**
 * A short, non-reversible reference for a secret.
 *
 * Logs need to say *which* identifier was used, because "the recorded base is not readable" is not
 * actionable when there are several. They must not say what it is: a Bitable app token grants access to
 * the base for as long as it is valid. Eight hex characters identify it to a human who already has it
 * and tell an attacker nothing.
 */
export function fingerprint(value) {
  const v = String(value ?? "").trim();
  if (!v) return "(none)";
  return createHash("sha256").update(v).digest("hex").slice(0, 8);
}

/**
 * Remove secrets from any string before it is printed.
 *
 * The API client builds its error messages from the request path, and the path contains the app token:
 * `GET /bitable/v1/apps/<token>/tables: 91403 Forbidden`. Printing that message - which the old code
 * did - writes a live credential into the run log and into any CI transcript that keeps it.
 */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) {
    const v = String(s ?? "").trim();
    if (v.length >= 6) out = out.split(v).join("<redacted>");
  }
  return out;
}

/**
 * Parse the recorded target file.
 *
 * @returns {{kind: "missing"} | {kind: "corrupt", detail: string} | {kind: "present", target: object}}
 */
export function parseRecordedTarget(text) {
  if (text == null) return { kind: "missing" };
  let target;
  try {
    target = JSON.parse(text);
  } catch (e) {
    return { kind: "corrupt", detail: e.message };
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return { kind: "corrupt", detail: "the file is not a JSON object" };
  }
  return { kind: "present", target };
}

/**
 * Decide what this run is allowed to do with a base.
 *
 * @param {object} input
 * @param {string} [input.envToken]      FEISHU_APP_TOKEN, if the deployment set one
 * @param {object} input.targetState     the result of parseRecordedTarget
 * @param {boolean} [input.createBase]   whether --create-base was passed
 * @param {string} [input.baseName]      FEISHU_BASE_NAME, if the deployment set one
 * @returns {{action:"use", appToken:string, source:string, ref:string}
 *          |{action:"create", name:string}
 *          |{action:"fail", code:number, reason:string, detail:string, missing:string[]}}
 */
export function decideBase({ envToken = "", targetState = { kind: "missing" }, createBase = false, baseName = "" } = {}) {
  const env = String(envToken ?? "").trim();
  if (env) {
    return { action: "use", appToken: env, source: "environment", ref: fingerprint(env) };
  }

  if (targetState.kind === "corrupt") {
    return {
      action: "fail",
      code: EX_CONFIG,
      reason: "corrupt-target",
      detail:
        "the recorded target file exists but could not be parsed (" +
        String(targetState.detail ?? "unknown").slice(0, 120) +
        "). Fix or delete it deliberately; creating a base now would hide the reason it broke.",
      missing: ["data/ledger-target.json"],
    };
  }

  if (targetState.kind === "present") {
    const recorded = String(targetState.target?.appToken ?? "").trim();
    if (recorded) {
      return { action: "use", appToken: recorded, source: "recorded", ref: fingerprint(recorded) };
    }
    if (!createBase) {
      return {
        action: "fail",
        code: EX_CONFIG,
        reason: "no-token-in-target",
        detail:
          "the recorded target file has no appToken. Re-record it with tools/feishu-ledger.mjs, or pass --create-base to create a new base deliberately.",
        missing: ["appToken in data/ledger-target.json"],
      };
    }
    return { action: "create", name: String(baseName ?? "").trim() || DEFAULT_BASE_NAME };
  }

  if (!createBase) {
    return {
      action: "fail",
      code: EX_CONFIG,
      reason: "no-target",
      detail:
        "no base is configured. This tool no longer creates one on its own: creating a base is an external, irreversible action, and a missing configuration is not proof that no base exists.",
      missing: ["FEISHU_APP_TOKEN", "data/ledger-target.json"],
    };
  }
  return { action: "create", name: String(baseName ?? "").trim() || DEFAULT_BASE_NAME };
}
