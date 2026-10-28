/**
 * Publication guard: refuse to publish the same task twice, and refuse to overwrite a file nobody
 * claims.
 *
 * ## Why a claim file rather than "does the target exist?"
 *
 * Checking existence and then writing is a race: two runs can both see "absent" and both write. The
 * mutex here is a **claim file created with `wx`**, which fails atomically if it already exists at
 * the moment of creation. Whoever wins the create owns the task; the loser reads the claim and
 * reports duplicate or conflict instead of writing.
 *
 * ## What the three outcomes mean
 *
 *   claimed        - nobody owned this slug; the caller may write
 *   duplicate      - the same task already claimed it; do not write, do not republish
 *   conflict       - a *different* task owns this slug; refuse, never overwrite
 *   exists_untracked - the target file exists but no claim does (hand-written article, older run, or
 *                    a deleted claim). Treated as a refusal: an unclaimed file is not ours to replace.
 *
 * ## The crash window, stated honestly
 *
 * The claim and the file write are two operations, not a transaction. A process that dies between
 * them leaves a claim with no file. The next run of the **same** task reports `duplicate` and does
 * nothing - safe, but stuck until someone releases the claim; `releaseStale` exists for that and is
 * covered by a test. This is not exactly-once delivery: it is "at most once, and a stuck claim rather
 * than a duplicate publication".
 *
 * The rename is the second half: content is written to a temp file and renamed into place, and the
 * rename is only attempted after re-checking that the target is still absent. That narrows the window
 * but does not remove it; a writer that bypasses this module can still race. Every write path in this
 * repository goes through `publish`.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { taskKeyFor } from "./run-key.mjs";

/** Claims live beside the content, in a dot-directory that the site never builds. */
export const claimDir = (dir) => join(dir, ".claims");
const claimPath = (dir, slug) => join(claimDir(dir), `${slug}.json`);

/**
 * The identity of a publish task.
 *
 * A publish task is "this kind of thing, at this slug, in this language". It deliberately ignores
 * the run and the attempt: those change on every execution, which is exactly what a retry must not
 * do. The slug is the subject because the slug *is* the destination.
 *
 * The three writers in this repository do not share a task vocabulary, so each names its own kind:
 *   cloud-orchestrator  kind="explainer"
 *   c-line-orchestrator kind="guide"
 *   link-guides         kind="link-update"
 */
export function publishTaskKey({ kind, locale = "en", slug }) {
  return taskKeyFor({ kind, locale, subject: slug });
}

/**
 * Try to take ownership of a slug. Does not write content.
 * @returns {{status:"claimed"|"duplicate"|"conflict"|"exists_untracked", claim?:object, existing?:object}}
 */
export function claim({ dir, slug, taskKey, runId = null, now = new Date() }) {
  mkdirSync(claimDir(dir), { recursive: true });
  const target = join(dir, `${slug}.md`);
  const file = claimPath(dir, slug);

  const record = { slug, taskKey, runId, at: now.toISOString() };

  let fd;
  try {
    fd = openSync(file, "wx"); // atomic: throws EEXIST if it already exists
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let existing = null;
    try { existing = JSON.parse(readFileSync(file, "utf8")); } catch { existing = null; }
    if (!existing) return { status: "conflict", existing: null };
    return { status: existing.taskKey === taskKey ? "duplicate" : "conflict", existing };
  }
  try {
    writeFileSync(fd, JSON.stringify(record, null, 2) + "\n", "utf8");
  } finally {
    closeSync(fd);
  }

  // The claim is ours. A file that already exists was not written by this task - refuse it now
  // rather than after the caller has done the work.
  if (existsSync(target)) return { status: "exists_untracked", claim: record };
  return { status: "claimed", claim: record };
}

/** Give up a claim. Safe to call when absent; used when the write itself fails. */
export function release({ dir, slug }) {
  const file = claimPath(dir, slug);
  try { unlinkSync(file); return true; } catch { return false; }
}

/**
 * Claim, then write through a temp file and a rename.
 * @returns {{status:string, path?:string, existing?:object}}
 */
export function publish({ dir, slug, taskKey, content, runId = null, now = new Date() }) {
  const taken = claim({ dir, slug, taskKey, runId, now });
  if (taken.status !== "claimed") return taken;

  const target = join(dir, `${slug}.md`);
  const tmp = join(claimDir(dir), `.tmp-${slug}-${runId ?? process.pid}`);
  try {
    writeFileSync(tmp, content, "utf8");
    // Re-check immediately before the rename. The claim makes this redundant for cooperating
    // writers; it is here because a non-cooperating writer is the case that costs a published file.
    if (existsSync(target)) {
      unlinkSync(tmp);
      return { status: "exists_untracked", claim: taken.claim };
    }
    renameSync(tmp, target);
    return { status: "written", path: target };
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    release({ dir, slug }); // a failed write must not leave the task permanently stuck
    throw e;
  }
}

/**
 * Drop a claim older than `olderThanMs`. For a run that died between claim and write.
 * @returns {boolean} whether a claim was removed
 */
export function releaseStale({ dir, slug, olderThanMs = 24 * 60 * 60 * 1000, now = new Date() }) {
  const file = claimPath(dir, slug);
  if (!existsSync(file)) return false;
  let at;
  try { at = Date.parse(JSON.parse(readFileSync(file, "utf8")).at); } catch { at = NaN; }
  if (!Number.isFinite(at) || now.getTime() - at < olderThanMs) return false;
  return release({ dir, slug });
}

/**
 * Which of these slugs already have a file?
 *
 * This is the non-destructive check for tools that edit published articles rather than create new
 * ones. It answers one question and makes no decision: the caller decides what to do about a
 * non-empty result. Kept here so a tool cannot invent its own subtly different version of "exists".
 */
export function existingTargets(dir, slugs) {
  return slugs.filter((s) => existsSync(join(dir, `${s}.md`)));
}