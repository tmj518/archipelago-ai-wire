#!/usr/bin/env node
/**
 * The link-guides overwrite refusal.
 *
 * This tool edits articles that are already published, so the property under test is a refusal:
 * with any target present, `--write` must exit non-zero and leave every article byte-identical.
 * The filesystem cases use a temporary directory; the end-to-end case hashes the real article
 * before and after, because "it printed REFUSED" is not the same claim as "nothing changed".
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const pg = await import(pathToFileURL(join(ROOT, "src/lib/publish-guard.mjs")).href);

let pass = 0;
const failures = [];
const record = (n, ok, d = "") => (ok ? pass++ : failures.push(`${n}${d ? "  — " + d : ""}`));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/* ── the helper ───────────────────────────────────────────────────────────── */

{
  const d = mkdtempSync(join(tmpdir(), "lg-"));
  writeFileSync(join(d, "exists.md"), "x");
  const found = pg.existingTargets(d, ["exists", "absent"]);
  record("helper: lists only the target that exists", found.length === 1 && found[0] === "exists", JSON.stringify(found));
  record("helper: absent target is not reported", !pg.existingTargets(d, ["absent"]).length);
  record("helper: empty input is empty output", pg.existingTargets(d, []).length === 0);
  rmSync(d, { recursive: true, force: true });
}

/* ── the tool refuses to rewrite published articles ───────────────────────── */

const BLOG = join(ROOT, "src/content/blog");
const before = new Map(readdirSync(BLOG).filter((f) => f.endsWith(".md")).map((f) => [f, sha(join(BLOG, f))]));

const dry = spawnSync(process.execPath, [join(ROOT, "tools/link-guides.mjs")], { encoding: "utf8" });
record("dry run: exits 0", dry.status === 0, `code=${dry.status}`);

const write = spawnSync(process.execPath, [join(ROOT, "tools/link-guides.mjs"), "--write"], { encoding: "utf8" });
record("write: refused with non-zero exit", write.status === 1, `code=${write.status}`);
record("write: says why", /REFUSED/.test(write.stderr) && /no update path/.test(write.stderr), write.stderr.split("\n")[0]);
record("write: tells the human what to do", /edit the article/i.test(write.stderr));

const after = new Map(readdirSync(BLOG).filter((f) => f.endsWith(".md")).map((f) => [f, sha(join(BLOG, f))]));
const changed = [...before.keys()].filter((f) => before.get(f) !== after.get(f));
record("write: no article changed", changed.length === 0, changed.join(","));
record("write: article count unchanged", before.size === after.size, `${before.size} -> ${after.size}`);

/* ── the guard is in the source, not just in behaviour ────────────────────── */

const src = readFileSync(join(ROOT, "tools/link-guides.mjs"), "utf8");
record("source: imports the shared helper", /existingTargets/.test(src));
record("source: refuses before writing", src.indexOf("process.exit(1)") < src.indexOf("for (const p of planned) writeFileSync"));
record("source: no force flag added", !/--force|forceWrite/i.test(src));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log("  " + f); process.exit(1); }
console.log("RESULT: PASS — link-guides refuses to overwrite published articles, byte-for-byte unchanged");