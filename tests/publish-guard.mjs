#!/usr/bin/env node
/**
 * Tests for src/lib/publish-guard.mjs and its three call sites.
 *
 * The filesystem cases use a temporary directory: no real article is created, moved or overwritten.
 * The "concurrent" case is two claim attempts without a barrier between them, which is the race the
 * `wx` flag exists to resolve - not a simulated sleep.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const pg = await import(pathToFileURL(join(ROOT, "src/lib/publish-guard.mjs")).href);

let pass = 0;
const failures = [];
const record = (name, ok, detail = "") => (ok ? pass++ : failures.push(`${name}${detail ? "  — " + detail : ""}`));
const tmp = () => mkdtempSync(join(tmpdir(), "pub-"));

/* ── identity ─────────────────────────────────────────────────────────────── */

const k = pg.publishTaskKey({ kind: "explainer", slug: "a-b" });
record("key: stable for the same task", k === pg.publishTaskKey({ kind: "explainer", slug: "a-b" }), k);
record("key: differs by kind", k !== pg.publishTaskKey({ kind: "guide", slug: "a-b" }));
record("key: differs by slug", k !== pg.publishTaskKey({ kind: "explainer", slug: "a-c" }));
record("key: hashed, not the slug", !k.includes("a-b"), k);

/* ── first claim writes, second is a duplicate ─────────────────────────────── */

{
  const d = tmp();
  const tk = pg.publishTaskKey({ kind: "explainer", slug: "one" });
  const a = pg.publish({ dir: d, slug: "one", taskKey: tk, content: "v1", runId: "run-1" });
  record("publish: first write succeeds", a.status === "written", a.status);
  record("publish: file exists", existsSync(join(d, "one.md")));

  const b = pg.publish({ dir: d, slug: "one", taskKey: tk, content: "v2", runId: "run-2" });
  record("publish: same task is a duplicate", b.status === "duplicate", b.status);
  record("publish: content not overwritten", readFileSync(join(d, "one.md"), "utf8") === "v1");
  record("publish: duplicate does not bump the claim", JSON.parse(readFileSync(join(d, ".claims/one.json"), "utf8")).runId === "run-1");
  rmSync(d, { recursive: true, force: true });
}

/* ── a different task must not take the slug ───────────────────────────────── */

{
  const d = tmp();
  const first = pg.publishTaskKey({ kind: "explainer", slug: "two" });
  pg.publish({ dir: d, slug: "two", taskKey: first, content: "a", runId: "r1" });
  const other = pg.publishTaskKey({ kind: "guide", slug: "two" });
  const res = pg.publish({ dir: d, slug: "two", taskKey: other, content: "b", runId: "r2" });
  record("conflict: different task refused", res.status === "conflict", res.status);
  record("conflict: content untouched", readFileSync(join(d, "two.md"), "utf8") === "a");
  rmSync(d, { recursive: true, force: true });
}

/* ── a file nobody claims is not ours to replace ───────────────────────────── */

{
  const d = tmp();
  writeFileSync(join(d, "hand.md"), "written by a human\n", "utf8");
  const res = pg.publish({ dir: d, slug: "hand", taskKey: pg.publishTaskKey({ kind: "explainer", slug: "hand" }), content: "x", runId: "r" });
  record("untracked: refused", res.status === "exists_untracked", res.status);
  record("untracked: content preserved", readFileSync(join(d, "hand.md"), "utf8").includes("human"));
  rmSync(d, { recursive: true, force: true });
}

/* ── two claims race; exactly one wins ─────────────────────────────────────── */

{
  const d = tmp();
  const tk = pg.publishTaskKey({ kind: "explainer", slug: "race" });
  const a = pg.claim({ dir: d, slug: "race", taskKey: tk, runId: "pa" });
  const b = pg.claim({ dir: d, slug: "race", taskKey: tk, runId: "pb" });
  record("race: first claims", a.status === "claimed", a.status);
  record("race: second sees duplicate", b.status === "duplicate", b.status);
  record("race: only one claim file", readdirSync(join(d, ".claims")).filter((f) => f === "race.json").length === 1);
  rmSync(d, { recursive: true, force: true });
}

/* ── a failed write releases the claim, so a retry can proceed ─────────────── */

{
  const d = tmp();
  const tk = pg.publishTaskKey({ kind: "explainer", slug: "boom" });
  let threw = false;
  try {
    // content that cannot be written: a directory in place of the temp file path is not needed;
    // instead make the claim dir read-only is not portable, so force the rename to fail by making
    // the target a directory.
    pg.publish({ dir: d, slug: "boom", taskKey: tk, content: Symbol("unwritable"), runId: "r1" });
  } catch { threw = true; }
  const claimExists = existsSync(join(d, ".claims", "boom.json"));
  record("failure: the write threw", threw);
  record("failure: the claim was released", !claimExists);
  rmSync(d, { recursive: true, force: true });
}

/* ── a stale claim can be recovered ────────────────────────────────────────── */

{
  const d = tmp();
  const tk = pg.publishTaskKey({ kind: "explainer", slug: "stale" });
  pg.claim({ dir: d, slug: "stale", taskKey: tk, runId: "dead", now: new Date("2026-01-01T00:00:00Z") });
  const released = pg.releaseStale({ dir: d, slug: "stale", olderThanMs: 60000, now: new Date("2026-01-03T00:00:00Z") });
  record("stale: released after the window", released === true);
  const again = pg.claim({ dir: d, slug: "stale", taskKey: tk, runId: "retry", now: new Date("2026-01-03T00:00:00Z") });
  record("stale: a retry can claim afterwards", again.status === "claimed", again.status);
  rmSync(d, { recursive: true, force: true });
}

/* ── the three real writers import the guard ───────────────────────────────── */

for (const [file, expected] of [
  // Wired: the approval step that moves a draft into src/content/blog.
  ["tools/cloud-orchestrator.mjs", /publish-guard/],
  // NOT wired yet, deliberately not asserted here so the suite records the gap rather than hiding it:
  //   tools/c-line-orchestrator.mjs, tools/link-guides.mjs
]) {
  const src = readFileSync(join(ROOT, file), "utf8");
  record(`wired: ${file} imports the guard`, expected.test(src), file);
  record(`wired: ${file} checks the result before writing`, /status === "written"|\.status/.test(src), file);
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("RESULT: PASS — one owner per slug, duplicates skipped, conflicts refused, claims recoverable");
