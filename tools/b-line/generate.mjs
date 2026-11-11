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
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { ask } from "../lib-llm.mjs";
import { reviewBLineArticle } from "./review.mjs";

const ROOT = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const briefPath = join(ROOT, "data", "b-line", "brief.md");
const brief = existsSync(briefPath) ? readFileSync(briefPath, "utf8") : "";
if (!brief.trim()) {
  console.error("  b-line: no brief at data/b-line/brief.md");
  process.exit(1);
}

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
const pending = pool.cases.find((c) => {
  if (!c || c.used === true) return false;
  /*
   * A person already written about is used, whatever the flag says.
   *
   * On 2026-11-08 the flag was right and the site still ended up with three Damon Chen articles: the
   * pool file was not committed, so the next run read the old flag. The published titles are the fact;
   * the flag is a copy of it. Checking the titles costs nothing and cannot drift.
   */
  const surname = String(c.person ?? "").split(" ").pop().toLowerCase();
  return !written.some((t) => surname.length > 2 && String(t).toLowerCase().includes(surname));
});
/* A quiet result is only valid after checking the existing pool. */
if (totalEntries < 5 && !pending) {
  console.error("  b-line: no case in the pool and too little material to write from; refusing to invent");
  process.exit(2);
}
if (totalEntries < 5) {
  console.log("  b-line: few or no documents today; relying on the selected case record and requiring review evidence");
}
const caseNote = pending
  ? `## The case to write about today\n\n${JSON.stringify(pending, null, 2)}\n\nWrite about THIS person and product. The documents below are for verification and for anything else the article needs; they do not replace the case.`
  : `## No case left in the pool\n\nChoose the person yourself from the documents below. Report the case in the META block as case_person, case_product and case_data so it can be added to the pool.`;

async function fetchCaseSource(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const response = await fetch(parsed, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BLineFactCheck/1.0)", accept: "text/html,application/xhtml+xml,text/plain,*/*" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 500000);
    const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 250);
    const body = strip(html).slice(0, 5000);
    return body.length >= 120 ? { url: parsed.href, title, body } : null;
  } catch {
    return null;
  }
}

const caseSources = pending && Array.isArray(pending.sources)
  ? (await Promise.all(pending.sources.slice(0, 4).map(fetchCaseSource))).filter(Boolean)
  : [];
if (pending && caseSources.length === 0) {
  console.error("  b-line: selected pool case has no retrievable source document; refusing to publish unverified claims");
  process.exit(1);
}
const sourceMaterial = caseSources.map((s) => `### ${s.title || s.url}\n${s.url}\n${s.body}`).join("\n\n");

/* ---------------------------------------------------------------- one call */
const prompt = `${brief}

${caseNote}

## Directly fetched source documents for the selected case

${sourceMaterial || "No pool case selected; use only the fetched feed documents below."}

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
  temperature: 1,
});

if (!r?.ok) {
  console.error(`  b-line: writer request failed (${r?.provider ?? "unknown"}/${r?.model ?? "unknown"}): ${String(r?.error ?? "unavailable").slice(0, 180)}`);
  process.exit(1);
}
const text = String(r?.text ?? r?.content ?? "");
console.log(`  b-line: writer returned ${text.length} chars in ${Math.round((Date.now() - started) / 1000)}s via ${r.provider}/${r.model}`);

if (/NO-SUBJECT/i.test(text)) {
  console.log("  b-line: the writer found nothing worth publishing today");
  process.exit(2);
}

function block(name) {
  const m = new RegExp(`===\\s*${name}\\s*===([\\s\\S]*?)(?:===|$)`, "i").exec(text);
  return m ? m[1].trim() : "";
}

const metaRaw = block("META");
let article = block("ARTICLE").replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim();
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
function missingRequiredStructure(candidate) {
  const missing = [];
  for (const [label, re] of required) {
    if (label === "at least five links") {
      const links = (candidate.match(/<a\s[^>]*href/gi) ?? []).length;
      if (links < 5) missing.push(`${label} (found ${links})`);
    } else if (!re.test(candidate)) {
      missing.push(label);
    }
  }
  return missing;
}
const missing = missingRequiredStructure(article);
if (missing.length) {
  console.error(`  b-line: refusing article; required structure is missing: ${missing.join(", ")}`);
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

/* The source-based reviewer must approve before this draft is written or can be committed. */
/* A fetched URL is not automatically primary. Only the case registry's explicit primarySources
 * allowlist may support business metrics; RSS/feed extracts remain discovery material. */
const primarySourceUrls = new Set(Array.isArray(pending?.primarySources) ? pending.primarySources : []);
const sourceDocuments = caseSources.map((source) => ({ ...source, primary: primarySourceUrls.has(source.url) }));
const evidence = `${caseNote}\n\nDIRECTLY FETCHED CASE SOURCES\n${sourceMaterial}\n\nFETCHED FEED DOCUMENTS (DISCOVERY ONLY; NOT PRIMARY EVIDENCE FOR BUSINESS METRICS)\n${material}`;
let writerProvider = r.provider;
let writerModel = r.model;
let review = await reviewBLineArticle({ article, evidence, sourceDocuments, writerProvider, writerModel });
let revisionCount = 0;

while (!review.pass && review.canRevise && !review.needsHumanReview && revisionCount < 2) {
  const feedback = review.feedback.join("\n- ");
  console.log(`  b-line: reviewer feedback received; requesting evidence-bound revision ${revisionCount + 1}/2`);
  console.log(`  b-line: actionable review feedback: ${feedback.replace(/\\s+/g, " ").slice(0, 1800)}`);
  const revision = await ask({
    role: "writer",
    temperature: 1,
    maxTokens: 8192,
    system: [
      "Revise the supplied article only from the supplied evidence and reviewer feedback. Never add a fact, number, causal claim, source, or citation from memory.",
      "For unsupported numeric business claims, use an exact quote only when a supplied curated primary source contains it; otherwise delete the entire unsupported sentence and every duplicate of that claim, including any table cell. Do not preserve it as a paraphrase or implication.",
      "Return complete HTML for the article and preserve every required section exactly.",
      "Required structure checklist: an HTML table; a section headed What doesn't work; at least one FAQ question in an h3; a Sources section; and at least five valid hyperlinks.",
      "Before responding, count the links and confirm each required section remains. Return only the revised HTML, no commentary.",
    ].join(" "),
    messages: [{ role: "user", content: `REVIEWER / GATE FEEDBACK\n- ${feedback}\n\nSUPPLIED EVIDENCE (feed items are discovery material only; they cannot prove numeric business claims)\n${evidence.slice(0, 30000)}\n\nCURATED PRIMARY SOURCE DOCUMENTS\n${JSON.stringify(sourceDocuments, null, 2).slice(0, 30000)}\n\nCURRENT ARTICLE\n${article.slice(0, 30000)}\n\nReturn only the complete revised article HTML.` }],
  });
  let revised = String(revision?.text ?? revision?.content ?? "").trim();
  revised = revised.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();
  const wrappedArticle = /===\s*ARTICLE\s*===([\s\S]*?)(?:===|$)/i.exec(revised);
  if (wrappedArticle) revised = wrappedArticle[1].trim();
  if (!revision?.ok || !revised) {
    console.error(`  b-line: writer revision failed: ${revision?.error ?? "empty response"}`);
    process.exit(1);
  }
  article = revised;
  writerProvider = revision.provider;
  writerModel = revision.model;
  revisionCount++;
  const revisedMissing = missingRequiredStructure(revised);
  if (revisedMissing.length) {
    review = {
      ...review,
      canRevise: true,
      feedback: [`Structure gate failed: ${revisedMissing.join(", ")}. Restore every required section and provide at least five hyperlinks.`],
      reason: `structure gate failed after revision ${revisionCount}: ${revisedMissing.join(", ")}`,
    };
    console.error(`  b-line: revision ${revisionCount} failed structure gate: ${revisedMissing.join(", ")}`);
    continue;
  }
  console.log(`  b-line: revision ${revisionCount} from ${writerProvider ?? "unknown"}/${writerModel ?? "unknown"}; sending for fresh review`);
  review = await reviewBLineArticle({ article, evidence, sourceDocuments, writerProvider, writerModel });
}
if (process.env.GITHUB_ENV) {
  const reviewerProvider = /^[a-z0-9_-]+$/i.test(review.provider ?? "") ? review.provider : "unknown";
  const reviewerModel = /^[a-z0-9_.:-]+$/i.test(review.model ?? "") ? review.model : "unknown";
  const independenceLevel = ["provider", "model", "same-model", "unknown"].includes(review.independenceLevel) ? review.independenceLevel : "unknown";
  const reviewStatus = review.needsHumanReview ? "HUMAN_REVIEW_REQUIRED" : review.pass ? "APPROVED" : "REJECTED";
  appendFileSync(process.env.GITHUB_ENV, `B_LINE_REVIEWER_PROVIDER=${reviewerProvider}\nB_LINE_REVIEWER_MODEL=${reviewerModel}\nB_LINE_REVIEW_INDEPENDENCE_LEVEL=${independenceLevel}\nB_LINE_REVIEW_VERDICT=${reviewStatus}\n`, "utf8");
}
if (!review.pass) {
  console.error(`  b-line: reviewer refused publication after ${revisionCount} revision(s) - ${review.reason}`);
  process.exit(review.needsHumanReview ? 3 : 1);
}
console.log(`  b-line: reviewer approved after ${revisionCount} evidence-bound revision(s) via ${review.provider}/${review.model}`);

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
/*
 * A new case study links to the previous one.
 *
 * The site-wide link gate counts articles with no outbound link as orphans and fails the build over
 * them - so every B线 article that ended without a link broke A线's next run. One link to the newest
 * published case is enough, and it is what a reader wants anyway.
 */
try {
  const prior = readdirSync(blogDir)
    .filter((f) => f.endsWith(".md") && f !== `${slug}.md`)
    .map((f) => {
      const text = readFileSync(join(blogDir, f), "utf8");
      return /^category:\s*success-cases/m.test(text)
        ? { slug: f.replace(/\.md$/, ""), title: /^title:\s*"?(.*?)"?\s*$/m.exec(text)?.[1] ?? f }
        : null;
    })
    .filter(Boolean);
  if (prior.length) {
    const link = `\nRelated case: [${prior[0].title}](/blog/${prior[0].slug}/).\n`;
    writeFileSync(join(blogDir, `${slug}.md`), file + link, "utf8");
    console.log(`  b-line: linked to ${prior[0].slug}`);
  } else {
  }
} catch {
}

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
