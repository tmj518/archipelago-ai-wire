#!/usr/bin/env node
/**
 * Delete the date-suffixed near-duplicates the publishing pipelines leave behind.
 *
 * The trade line re-proposes a subject it has already published when the research ledger and the
 * published files disagree, and publishes it again under `<slug>-YYYY-MM-DD`. Two live pages then
 * compete for one query and the metadata gate fails on the duplicate title.
 *
 * ## The rule is deliberately narrow
 *
 * A file is deleted only when ALL of these hold:
 *
 *   1. its name ends in `-YYYY-MM-DD`, and stripping that suffix names a file that exists;
 *   2. its `title` is byte-identical to the surviving file's title;
 *   3. it is not the only file carrying that title.
 *
 * Title equality is the signal that matters. A different title means a different article that happens
 * to have a date in its slug, and deleting those would be content loss disguised as cleanup. On
 * 2026-10-22 the directory held two date-suffixed files: one had an identical title and was the
 * duplicate, the other had a different title and was not touched.
 *
 * ## It reports by default
 *
 *   node tools/cleanup-duplicates.mjs             # list what would go, delete nothing
 *   node tools/cleanup-duplicates.mjs --apply     # delete, and print each removal
 *
 * The scheduled workflow runs it with --apply. A cleanup that has never been read is not a cleanup.
 */
import { existsSync, readdirSync, readFileSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = join(ROOT, "src", "content", "blog");
const APPLY = process.argv.includes("--apply");
const LOG = join(ROOT, "data", "cleanup.log");

const titleOf = (file) => (/^title:\s*"(.*?)"\s*$/m.exec(readFileSync(join(DIR, file), "utf8"))?.[1] ?? "");
const isDraft = (file) => /^draft:\s*true/m.test(readFileSync(join(DIR, file), "utf8"));

const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const doomed = [];

for (const f of files) {
  const m = /^(.*)-(\d{4}-\d{2}-\d{2})\.md$/.exec(f);
  if (!m) continue;
  const base = `${m[1]}.md`;
  if (!existsSync(join(DIR, base))) continue;

  const a = titleOf(f);
  const b = titleOf(base);
  if (!a || a !== b) continue;
  if (isDraft(f)) continue;

  doomed.push({ file: f, base, title: a });
}

console.log(`DUPLICATE CLEANUP  ${APPLY ? "apply" : "report only"}`);
console.log("=".repeat(84));
console.log(`  articles        : ${files.length}`);
console.log(`  duplicates found: ${doomed.length}`);

for (const d of doomed) {
  console.log(`\n  delete ${d.file}`);
  console.log(`    keep ${d.base}`);
  console.log(`    title "${d.title.slice(0, 70)}"`);
}

if (!doomed.length) {
  console.log("\n  nothing to remove");
  process.exit(0);
}

if (!APPLY) {
  console.log("\n--report only: nothing deleted. Re-run with --apply to remove them.");
  process.exit(0);
}

mkdirSync(join(ROOT, "data"), { recursive: true });
for (const d of doomed) {
  rmSync(join(DIR, d.file), { force: true });
  appendFileSync(LOG, `${new Date().toISOString()} deleted ${d.file} (kept ${d.base})\n`, "utf8");
  console.log(`\n  removed ${d.file}`);
}
console.log(`\n  ${doomed.length} file(s) removed; the surviving page keeps its URL`);
process.exit(0);
