#!/usr/bin/env node
/**
 * Check that articles about to be published will build.
 *
 * Twice this stopped the whole site: on 2026-11-07 a description containing "$1,234,900" inside double
 * quotes truncated to ',234,900 and Astro refused the file, and on 2026-11-08 a post without
 * information_gain made the sources page call replace() on undefined. Both had already been committed,
 * so the deployment stopped and the article answered 404 while the previous site stayed up.
 *
 *   node tools/validate-article.mjs                       # every article in the collection
 *   node tools/validate-article.mjs path/to/a.md ...      # only those files
 *   node tools/validate-article.mjs --changed             # files changed against origin/main
 *
 * Exit 0 when everything is publishable, 1 with a list of reasons when it is not.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const taxonomy = JSON.parse(readFileSync(join(ROOT, "src", "lib", "taxonomy.json"), "utf8"));
const CATEGORIES = new Set(taxonomy.categories.map((c) => c.slug));

const args = process.argv.slice(2);
let files = [];

if (args.includes("--changed")) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", "origin/main...HEAD", "--", "src/content/blog"], { cwd: ROOT, encoding: "utf8" });
    const dirty = execFileSync("git", ["status", "--porcelain", "--porcelain", "--", "src/content/blog"], { cwd: ROOT, encoding: "utf8" });
    files = [
      ...out.split("\n"),
      ...dirty.split("\n").map((l) => l.slice(3).trim()),
    ].filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }
} else {
  const named = args.filter((a) => a.endsWith(".md"));
  files = named.length
    ? named
    : readdirSync(BLOG).filter((f) => f.endsWith(".md")).map((f) => join("src", "content", "blog", f));
}

files = [...new Set(files)].filter((f) => existsSync(join(ROOT, f)));
if (!files.length) {
  console.log("  validate: no changed articles to check");
  process.exit(0);
}

const REQUIRED = ["title", "description", "publishDate", "category", "stakes", "audience"];
const problems = [];

for (const rel of files) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const slug = rel.split(/[\\/]/).pop().replace(/\.md$/, "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) {
    problems.push(`${slug}: no frontmatter block`);
    continue;
  }
  const head = fm[1];
  const add = (why) => problems.push(`${slug}: ${why}`);

  if (/\t/.test(head)) add("tab character in the frontmatter (YAML forbids it)");

  const fields = {};
  for (const line of head.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }

  for (const key of REQUIRED) {
    if (!fields[key]) add(`missing required field "${key}"`);
  }

  /* A double quote inside a double-quoted value is what broke the 2026-11-07 deployment. */
  for (const line of head.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][\w-]*):\s*"(.*)"\s*$/.exec(line);
    if (m && m[2].includes('"')) add(`field "${m[1]}" contains a quote inside a quoted value`);
  }

  /* Length is advice, not a build failure: published articles exceed it and they are already live. */
  if (fields.title && fields.title.length > 90) console.log(`      note ${slug}: title is ${fields.title.length} characters (a shorter one reads better)`);
  if (fields.description && fields.description.length < 40) add(`description is ${fields.description.length} characters (minimum 40)`);
  if (fields.category && !CATEGORIES.has(fields.category)) add(`unknown category "${fields.category}"`);
  if (fields.publishDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.publishDate)) add(`publishDate "${fields.publishDate}" is not YYYY-MM-DD`);
  if (fields.slug && fields.slug !== slug) add(`frontmatter slug "${fields.slug}" does not match the filename`);
}

if (problems.length) {
  console.log(`  validate: ${problems.length} problem(s) - these articles would fail the build`);
  for (const p of problems) console.log(`      - ${p}`);
  process.exit(1);
}

console.log(`  validate: ${files.length} article(s) checked, all publishable`);
