#!/usr/bin/env node
/**
 * Give a new article inbound links by adding one line to a related published article.
 *
 *   node tools/backfill-links.mjs --new=<slug>            print what it would do
 *   node tools/backfill-links.mjs --new=<slug> --write    do it
 *
 * ## Why this exists
 *
 * Every article is written with outbound links and none with inbound ones. The link list injected into the
 * writer's prompt grows as articles are published, so a new article can link to older ones - but nothing
 * ever links to the new one, because the older articles' markdown was finalised before it existed.
 *
 * Measured on 2026-10-17: 10 of 32 published articles had zero inbound prose links, including the article
 * published that morning. link-check reported "articles with zero: 0" because it counts outbound links,
 * which is a different question. An orphan page is one nothing points at.
 *
 * ## How it chooses
 *
 * Same category first, then the same stake level, then recency. `priced` articles link to `priced`
 * articles because a reader checking a money figure wants another money figure. Ties break toward the
 * oldest, because the oldest are the ones most likely to be orphaned already - the point is to spread
 * incoming links rather than to concentrate them on whatever is newest.
 *
 * The line is inserted before `## For you` rather than appended: a link after `## The point` is below the
 * conclusion, which is the least-read part of an article. If that heading is missing, it goes before
 * `## FAQ`, and if that is missing too the file is left alone with a message rather than guessed at.
 *
 * ## What it refuses to do
 *
 * It will not create a reciprocal pair. If the target already links to the new article, adding the reverse
 * would make a two-way link, and link-check counts those separately - a reciprocal pair between two
 * articles is a closed loop that passes no weight anywhere else.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const NEW_SLUG = flag("new", "");
const WRITE = args.includes("--write");
const HOW_MANY = Number(flag("count", "2"));

if (!NEW_SLUG) {
  console.log("usage: node tools/backfill-links.mjs --new=<slug> [--write] [--count=2]");
  process.exit(2);
}

const newPath = join(BLOG, `${NEW_SLUG}.md`);
if (!existsSync(newPath)) {
  console.log(`  no such article: ${NEW_SLUG}`);
  process.exit(2);
}

/* ── read the collection ──────────────────────────────────────────────────────────────────────── */

function parse(file) {
  const src = readFileSync(file, "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)?.[1] ?? "";
  const g = (k) => new RegExp(`^${k}:\\s*"?([^"]*?)"?\\s*$`, "m").exec(fm)?.[1] ?? "";
  return {
    file,
    slug: file.replace(/\\/g, "/").split("/").pop().replace(/\.md$/, ""),
    title: g("title"),
    category: g("category"),
    stakes: g("stakes"),
    date: g("publishDate"),
    draft: /^draft:\s*true/m.test(src),
    body: src,
    outbound: [...src.matchAll(/\]\(\/blog\/([a-z0-9-]+)\/\)/g)].map((m) => m[1]),
  };
}

const all = readdirSync(BLOG).filter((f) => f.endsWith(".md")).map((f) => parse(join(BLOG, f)));
const published = all.filter((a) => !a.draft);
const fresh = published.find((a) => a.slug === NEW_SLUG);

if (!fresh) {
  console.log(`  ${NEW_SLUG} is a draft or missing; nothing to backfill from`);
  process.exit(0);
}

/* ── inbound counts, so the choice can favour whoever has fewest ──────────────────────────────── */

const inbound = new Map();
for (const a of published) for (const t of a.outbound) inbound.set(t, (inbound.get(t) ?? 0) + 1);

/* ── rank candidates ────────────────────────────────────────────────────────────────────────── */

const candidates = published
  .filter((a) => a.slug !== NEW_SLUG)
  /* A target that already links to the new article would make a reciprocal pair. */
  .filter((a) => !a.outbound.includes(NEW_SLUG))
  /* And one that the new article already links to would close a loop the other way. */
  .filter((a) => !fresh.outbound.includes(a.slug))
  .filter((a) => a.body.includes("## For you") || a.body.includes("## FAQ"))
  .map((a) => {
    let score = 0;
    if (a.category === fresh.category) score += 100;
    if (a.stakes && a.stakes === fresh.stakes) score += 20;
    /* Fewer inbound first: spreading links matters more than pointing them at the popular pieces. */
    score += Math.max(0, 20 - (inbound.get(a.slug) ?? 0) * 4);
    /* Older first among equals. */
    if (a.date && fresh.date) score += a.date < fresh.date ? 5 : 0;
    return { ...a, score };
  })
  .sort((a, b) => b.score - a.score);

const picked = candidates.slice(0, HOW_MANY);

if (!picked.length) {
  console.log(`  no candidate can take a link to ${NEW_SLUG} without creating a loop or a reciprocal pair`);
  process.exit(0);
}

/* ── report, and optionally write ───────────────────────────────────────────────────────────── */

const line = `> Also read: [${fresh.title}](/blog/${NEW_SLUG}/)`;

console.log(`BACKFILL ${NEW_SLUG}`);
console.log("=".repeat(78));
console.log(`  title      : ${fresh.title}`);
console.log(`  category   : ${fresh.category}`);
console.log(`  inbound now: ${inbound.get(NEW_SLUG) ?? 0}`);
console.log("");

for (const c of picked) {
  const anchor = c.body.includes("## For you") ? "## For you" : "## FAQ";
  const at = c.body.indexOf(anchor);
  /* One blank line before the blockquote, so it reads as its own paragraph. */
  const updated = c.body.slice(0, at) + `${line}\n\n` + c.body.slice(at);

  console.log(`  → ${c.slug}`);
  console.log(`      ${c.category} · stakes ${c.stakes || "?"} · inbound was ${inbound.get(c.slug) ?? 0} · score ${c.score}`);
  console.log(`      insert before "${anchor}"`);

  if (WRITE) {
    writeFileSync(c.file, updated, "utf8");
    console.log(`      written`);
  }
}

if (!WRITE) {
  console.log("");
  console.log("  dry run: pass --write to change the files");
} else {
  console.log("");
  console.log(`  ${NEW_SLUG} now has ${picked.length} more inbound link(s)`);
}
