import { readFileSync, writeFileSync, existsSync } from "node:fs";

/*
 * Stop a draft at the boundary instead of failing it.
 *
 * The agent route wrote a draft whose subtitle and description were over the schema limits, and the
 * checks refused it. That is the right refusal for a wrong reason in the wrong place: twelve characters
 * over a limit is a mechanical fact, and it does not need a model to fix, a round trip to fix, or a
 * published-then-failed day to discover. It needs a substring.
 *
 * The executor already asks the writer to repair an over-long field, which costs a model call and mostly
 * works. This does the same job for the case that has no judgement in it at all, in the same process, in
 * microseconds: trim to the limit on a word boundary and say so in the log.
 *
 * Deliberately narrow: it shortens a value that is already there and never invents one. A missing
 * required field is not touched, a wrong enum is not touched, and no number is altered.
 *
 *   node tools/trim-draft.mjs <draft.md>          print what it would change
 *   node tools/trim-draft.mjs <draft.md> --write  change it
 *
 * Exits 0 whether or not anything needed trimming; a draft it cannot parse is left alone and reported.
 */
import { TEXT_LIMITS } from "../src/lib/schema-rules.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const WRITE = args.includes("--write");

if (!file || !existsSync(file)) {
  console.log("usage: node tools/trim-draft.mjs <draft.md> [--write]");
  process.exit(2);
}

const article = readFileSync(file, "utf8");
const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(article);
if (!fm) {
  console.log(`  ${file}: no frontmatter block, left alone`);
  process.exit(0);
}

/**
 * Shorten to a character budget, on a word boundary, keeping the start of the sentence.
 *
 * The end of a subtitle is where the filler lives - "and what it means for importers" - so trimming from
 * the end loses the least. A single unbroken token longer than the budget is cut mid-word, because
 * leaving it over the limit helps nobody.
 */
function fit(value, limit) {
  const chars = [...value];
  if (chars.length <= limit) return value;
  let out = chars.slice(0, limit).join("");
  const cut = out.lastIndexOf(" ");
  if (cut > limit * 0.5) out = out.slice(0, cut);
  return out.replace(/[,;:.\-–—\s]+$/, "");
}

const lines = fm[1].split(/\r?\n/);
const changes = [];

for (let i = 0; i < lines.length; i++) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*"?(.*?)"?\s*$/.exec(lines[i]);
  if (!m) continue;
  const field = m[1];
  const limit = TEXT_LIMITS[field]?.max;
  if (!limit) continue;
  const value = m[2];
  const n = [...value].length;
  if (n <= limit) continue;
  const trimmed = fit(value, limit);
  const quoted = /^[A-Za-z_][A-Za-z0-9_]*:\s*"/.test(lines[i]);
  lines[i] = `${field}: ${quoted ? JSON.stringify(trimmed) : trimmed}`;
  changes.push({ field, from: n, to: [...trimmed].length, limit });
}

if (!changes.length) {
  console.log(`  ${file}: nothing to trim`);
  process.exit(0);
}

for (const c of changes) console.log(`  ${c.field}: ${c.from} -> ${c.to} characters (limit ${c.limit})`);

if (!WRITE) {
  console.log("  dry run: pass --write to change the file");
  process.exit(0);
}

const head = lines.join("\n");
const body = article.slice(fm.index + fm[0].length);
writeFileSync(file, `---\n${head}\n---${body}`, "utf8");
console.log(`  written: ${file}`);
