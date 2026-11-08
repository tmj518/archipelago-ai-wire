#!/usr/bin/env node
/**
 * B线 — one article, one model call, published to the Success Cases section.
 *
 * This line is deliberately not built like A线. A线 has a pipeline because a publication needs gates:
 * a figure is checked against the document it cites, a build is failed rather than shipped. B线 was
 * asked for something simpler - research the web, decide the subject, write it, publish it - so it is
 * one step end to end. Nothing here reviews, gates, claims a slug or consults the orchestrator.
 *
 *   node tools/b-line/generate.mjs [--dry-run]
 *
 * Exit codes: 0 written, 2 nothing written (the model declined), 1 failure.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ask } from "../lib-llm.mjs";

const ROOT = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const briefPath = join(ROOT, "data", "b-line", "brief.md");
const brief = existsSync(briefPath) ? readFileSync(briefPath, "utf8") : "";
if (!brief.trim()) {
  console.error("  b-line: no brief at data/b-line/brief.md");
  process.exit(1);
}

/* ---------------------------------------------------------------- the case pool */
/*
 * The pool is the memory of this line.
 *
 * Ten years is 3,650 articles, and the expensive mistake is writing the same founder twice. Each entry
 * is one real person with a product and public numbers; an entry is marked used the moment its article
 * is written, so the pool can only run down, never repeat. When it is empty the writer chooses from the
 * fetched material and the new case is appended, which is how the pool grows without anyone editing it.
 */
const poolPath = join(ROOT, "data", "b-line", "cases.json");
let pool = { cases: [] };
if (existsSync(poolPath)) {
  try {
    pool = JSON.parse(readFileSync(poolPath, "utf8"));
  } catch {
    console.error("  b-line: data/b-line/cases.json is not readable; continuing without a pool");
  }
}
if (!Array.isArray(pool.cases)) pool.cases = [];
const pending = pool.cases.find((c) => c && c.used !== true);
const caseNote = pending
  ? `## The case to write about today\n\n${JSON.stringify(pending, null, 2)}\n\nWrite about THIS person and product. The documents below are for verification and for anything else the article needs; they do not replace the case.`
  : `## No case left in the pool\n\nChoose the person yourself from the documents below. Report the case in the META block as case_person, case_product and case_data so it can be added to the pool.`;

/* ---------------------------------------------------------------- research material */
/*
 * The sources are fetched, not remembered.
 *
 * B线's brief tells the writer to ground every claim in a document. Without a search API the honest
 * way to give it documents is to fetch today's feeds and let it read them: real pages, real titles,
 * real dates. The reader sees links; the writer cannot cite something that was not fetched.
 */
const FEEDS = [
  /* Only endpoints that actually answer.
   *
   * Reddit returns 403 to a server, Product Hunt's feed returns an empty document and Indie Hackers
   * blocks the request - measured on 2026-11-08, all three at zero items. Hacker News through Algolia
   * returns sixty stories and Lobsters twenty-five, so those are what this line reads. A feed that
   * silently returns nothing is worse than one that fails: it looks like a quiet day. */
  ["hn-frontpage", "https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points%3E120&hitsPerPage=40"],
  ["hn-recent", "https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E60&hitsPerPage=40"],
  ["lobsters", "https://lobste.rs/rss"],
];

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFeed([label, url]) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BLineBot/1.0)", accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    /* Hacker News answers in JSON, the rest in RSS. Both become the same list. */
    if (body.trimStart().startsWith("{")) {
      const json = JSON.parse(body);
      const hits = (json.hits ?? []).slice(0, 12).map((h) => ({
        title: String(h.title ?? "").slice(0, 200),
        link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        date: h.created_at ?? "",
        body: `points ${h.points ?? "?"}, ${h.num_comments ?? "?"} comments`,
      })).filter((e) => e.title && e.link);
      return { label, url, entries: hits };
    }
    const items = [...body.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 8).map((m) => m[0]);
    const entries = items.map((item) => {
      const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1] ?? "").slice(0, 200);
      const link = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(item)?.[1]?.trim() ?? "";
      const date = strip(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1] ?? "");
      const body = strip(/<description[^>]*>([\s\S]*?)<\/description>/i.exec(item)?.[1] ?? /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i.exec(item)?.[1] ?? "").slice(0, 600);
      return { title, link: link.replace(/<!\[CDATA\[|\]\]>/g, "").trim(), date, body };
    }).filter((e) => e.title && e.link);
    return { label, url, entries };
  } catch {
    return null;
  }
}

const feeds = (await Promise.all(FEEDS.map(fetchFeed))).filter(Boolean);
const totalEntries = feeds.reduce((a, f) => a + f.entries.length, 0);
console.log(`  b-line: ${feeds.length} feed(s), ${totalEntries} item(s) fetched`);
/*
 * The pool does not need the feeds.
 *
 * On 2026-11-08 three feeds answered and none of them parsed, so the run refused to write with a case
 * sitting in the pool that already carries its own numbers and sources. Feeds are how the pool grows
 * when it is empty; they are not a precondition for writing a case that is already documented.
 */
if (totalEntries < 5 && !pending) {
  console.error("  b-line: no case in the pool and too little material to write from; refusing to invent");
  process.exit(2);
}
if (totalEntries < 5) {
  console.log("  b-line: few or no documents today; writing the pooled case from its own documented figures");
}

const material = feeds
  .map((f) => `### ${f.label} (${f.url})\n` + f.entries.map((e) => `- ${e.title}\n  ${e.link}\n  ${e.date}\n  ${e.body}`).join("\n"))
  .join("\n\n")
  .slice(0, 45000);

/* ---------------------------------------------------------------- the previous titles */
const blogDir = join(ROOT, "src", "content", "blog");
const written = existsSync(blogDir)
  ? readdirSync(blogDir).filter((f) => f.endsWith(".md")).map((f) => {
      try {
        return /^title:\s*"?(.*?)"?\s*$/m.exec(readFileSync(join(blogDir, f), "utf8"))?.[1] ?? f;
      } catch {
        return f;
      }
    })
  : [];

/* ---------------------------------------------------------------- one call */
const prompt = `${brief}

${caseNote}

## Documents fetched for this run (today)

${material}

## Titles already published on this site (do not repeat any of them)

${written.slice(0, 120).map((t) => `- ${t}`).join("\n")}

---

Answer in exactly this shape and nothing else:

=== META ===
title: (60 characters or fewer)
slug: (kebab-case, English, distinctive)
meta_description: (155 characters or fewer)
focus_keyword:
tags: (three to five, comma separated)
why_this_topic: (two sentences)

=== ARTICLE ===
(the full article as plain HTML: h1, p, h2, table, h3/p for FAQ, h2 Sources with a ul of links)

If the documents do not support an article that meets the brief, answer with exactly: NO-SUBJECT`;

console.log("  b-line: asking the writer...");
const started = Date.now();
const r = await ask({
  role: "writer",
  system: "You are a senior content strategist and SEO editor. You write from the documents you are given and you never invent a person, a product, a number or a link.",
  messages: [{ role: "user", content: prompt }],
  maxTokens: 8192,
  temperature: 0.4,
});

const text = String(r?.text ?? r?.content ?? "");
console.log(`  b-line: writer returned ${text.length} chars in ${Math.round((Date.now() - started) / 1000)}s`);

if (/NO-SUBJECT/i.test(text)) {
  console.log("  b-line: the writer found nothing worth publishing today");
  process.exit(2);
}

function block(name) {
  const m = new RegExp(`===\\s*${name}\\s*===([\\s\\S]*?)(?:===|$)`, "i").exec(text);
  return m ? m[1].trim() : "";
}

const metaRaw = block("META");
const article = block("ARTICLE").replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim();
if (!metaRaw || !article) {
  console.error("  b-line: the answer was not in the agreed shape; nothing written");
  process.exit(1);
}

/*
 * The six questions, checked before the file is written.
 *
 * The brief asks for them; on 2026-11-08 the first two articles answered some of them and skipped the
 * rest. A structural check is cheaper than reading the article later and finding out.
 */
const required = [
  ["a table", /<table[\s\S]*?<\/table>/i],
  ["a What doesn't work section", /What\s*doesn'?t\s*work/i],
  ["at least one FAQ", /<h3[\s\S]*?<\/h3>/i],
  ["a Sources section", /Sources/i],
  ["at least five links", /(<a\s[^>]*href)/gi],
];
const missing = [];
for (const [label, re] of required) {
  if (label === "at least five links") {
    const links = (article.match(/<a\s[^>]*href/gi) ?? []).length;
    if (links < 5) missing.push(`${label} (found ${links})`);
  } else if (!re.test(article)) {
    missing.push(label);
  }
}
if (missing.length) {
  console.error(`  b-line: the article is missing ${missing.join(", ")}; nothing written`);
  process.exit(1);
}

const meta = {};
for (const line of metaRaw.split("\n")) {
  const m = /^([a-z_]+):\s*(.*)$/i.exec(line.trim());
  if (m) meta[m[1].toLowerCase()] = m[2].trim();
}

const slug = (meta.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
if (!slug || !meta.title) {
  console.error("  b-line: no slug or title in META; nothing written");
  process.exit(1);
}
if (existsSync(join(blogDir, `${slug}.md`))) {
  console.log(`  b-line: ${slug} already exists - nothing written`);
  process.exit(2);
}

/* Frontmatter this collection accepts. No currency symbols inside quoted strings: a "$" in a quoted
   value is what stopped the site building on 2026-11-07. */
const today = new Date().toISOString().slice(0, 10);
const clean = (s) => String(s ?? "").replace(/"/g, "'").replace(/\$/g, "USD ").replace(/\s+/g, " ").trim();
const tags = (meta.tags || "solo-founder, case-study").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5);
const number = written.length + 1;

const file = `---
articleNumber: ${number}
title: "${clean(meta.title)}"
description: "${clean(meta.meta_description)}"
publishDate: ${today}
reviewBy: ${new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)}
stakes: directional
category: success-cases
audience: general
tags:
${tags.map((t) => `  - ${t.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`).join("\n")}
---

${article}
`;

if (dryRun) {
  console.log(`  b-line: dry run - would write src/content/blog/${slug}.md (${article.length} chars)`);
  console.log(`  title: ${clean(meta.title)}`);
  process.exit(0);
}

mkdirSync(blogDir, { recursive: true });
writeFileSync(join(blogDir, `${slug}.md`), file, "utf8");
mkdirSync(join(ROOT, "data", "tmp"), { recursive: true });
writeFileSync(join(ROOT, "data", "tmp", "last-slug.txt"), slug, "utf8");
/*
 * Record it. A case taken from the pool is marked used; a case the writer found itself is appended,
 * with whatever it reported, so tomorrow cannot choose it again.
 */
try {
  if (pending) {
    pending.used = true;
    pending.usedAt = today;
    pending.articleSlug = slug;
  } else {
    pool.cases.push({
      id: slug,
      person: meta.case_person ?? "",
      product: meta.case_product ?? "",
      data: meta.case_data ?? "",
      sources: [meta.focus_keyword ?? ""].filter(Boolean),
      used: true,
      usedAt: today,
      articleSlug: slug,
    });
  }
  writeFileSync(poolPath, JSON.stringify(pool, null, 2) + "\n", "utf8");
  console.log(`  b-line: pool now ${pool.cases.filter((c) => c.used === true).length} used, ${pool.cases.filter((c) => c.used !== true).length} pending`);
} catch {
  console.log("  b-line: the pool could not be updated; the article is written regardless");
}

console.log(`  b-line: wrote src/content/blog/${slug}.md`);
console.log(`  title: ${clean(meta.title)}`);
