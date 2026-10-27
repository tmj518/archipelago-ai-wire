/**
 * Run identity: which logical task a model call belonged to, and which attempt it was.
 *
 * The usage log could count tokens but not attribute them. "What did this article cost" was
 * unanswerable, and without an identity a retry was indistinguishable from a new piece of work.
 *
 * ## Two identifiers, for two different questions
 *
 * `runId` answers "which execution was this". It is unique per process run and never derived from
 * content, so two runs of the same task are two runIds - that is the point.
 *
 * `taskKey` answers "which logical task was this". It is derived from the inputs that define the
 * task (kind, locale, subject), so a retry of the same task produces the same key and can be
 * recognised as a retry rather than a second article. A random id could never do this, which is why
 * idempotency cannot be built on runId alone.
 *
 * Neither identifier carries a prompt, a completion, a key, or a person. A task key is a hash, so the
 * subject appears in the log only as a digest - which is deliberate: the usage log is an accounting
 * file, not a copy of the work.
 */
import { createHash } from "node:crypto";

/** Characters that may appear in either identifier. Narrow on purpose: these strings go into logs. */
export const ID_SAFE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/**
 * @param {{now?: Date, entropy?: string}} [opts] injectable so tests are deterministic
 * @returns {string} e.g. `run-20261027t1219-a1b2c3`
 */
export function makeRunId({ now = new Date(), entropy } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
  const suffix = (entropy ?? Math.random().toString(36).slice(2, 8)).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  const id = `run-${stamp}-${suffix || "000000"}`;
  return id.length > 64 ? id.slice(0, 64) : id;
}

/**
 * The stable identity of a logical task.
 *
 * The inputs are normalised before hashing so that a difference which does not change the task does
 * not change the key: case, surrounding whitespace and separator runs are folded. Everything that
 * *does* change the task is included - a different locale or a different subject is a different
 * task, and must not collide with the first.
 *
 * @param {{kind: string, locale?: string, subject: string}} input
 * @returns {string} `task-<16 hex>`
 */
export function taskKeyFor({ kind, locale = "en", subject } = {}) {
  if (!kind || !subject) throw new Error("taskKeyFor needs both kind and subject");
  const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "-");
  const canonical = [norm(kind), norm(locale), norm(subject)].join("|");
  return "task-" + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * A coarse, non-sensitive category for a failure.
 *
 * The log already carried free-text errors, which are useful for a human and useless for counting.
 * This maps them to a small set of categories without copying the message into a second place: the
 * category is derived, the message stays where it was.
 */
export function classifyError(message, status) {
  const s = Number(status);
  if (Number.isFinite(s) && s > 0) {
    if (s === 401 || s === 403) return "auth";
    if (s === 402) return "quota";
    if (s === 429) return "rate_limit";
    if (s >= 500) return "provider_5xx";
    if (s >= 400) return "bad_request";
  }
  const m = String(message ?? "");
  if (!m) return "unknown";
  if (/no provider key|no key for this role|not configured/i.test(m)) return "no_credential";
  if (/timeout|timed out|etimedout|aborterror/i.test(m)) return "timeout";
  if (/enotfound|econnreset|econnrefused|network|socket/i.test(m)) return "network";
  if (/\bjson\b|parse|unexpected token/i.test(m)) return "bad_response";
  return "unknown";
}
