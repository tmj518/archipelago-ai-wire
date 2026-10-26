#!/usr/bin/env node
/**
 * What the guide line should write next, and how the last ones did.
 *
 *   node tools/plan-guides.mjs              # plan + scorecard, writes the priorities into the queue
 *   node tools/plan-guides.mjs --quiet      # only rewrite the queue, no table
 *   node tools/plan-guides.mjs --json       # machine-readable
 *
 * ## The problem this exists for
 *
 * The guide line picked its subject by queue order. That is not a decision, it is an accident of when
 * somebody appended a line to a JSON file. On 2026-10-26 Search Console held the whole demand picture:
 * 27 queries in ninety days, and the queue knew nothing about any of them.
 *
 * ## The model, stated plainly
 *
 * A guide is worth writing when three things are true at once, and the score is their product because a
 * zero in any one of them means zero value:
 *
 *   demand  - somebody is already searching. Measured as log(1 + impressions) over ninety days, capped
 *             at 5 so one runaway query cannot drown the list.
 *
 *   intent  - the searcher wants a procedure, not a story. An interrogative query ("how", "what",
 *             "can I", "requirements", "documents") is 1.0; anything else is 0.6.
 *
 *   gap     - we are not already answering it well. No page: 1.0. A page outside the top 20: 0.5. A
 *             page inside the top 10: 0.1 - writing a second guide for it splits the signal.
 *
 * ## The prior, and why it is allowed
 *
 * With 27 queries in ninety days, most topics have no measured demand at all. A model that multiplies
 * by zero would refuse to write anything, which is the failure mode this whole system keeps finding in
 * other forms. So a topic with no matching query gets an explicit prior instead, from the class of
 * question it answers, and the output marks it `prior` rather than `measured`.
 *
 * That is a stated assumption doing the work of missing data, not data. The replacement rule is the
 * point: as queries appear, `measured` takes over and the prior is never added to it. A prior that
 * silently blends with measurement cannot be audited.
 *
 * ## The feedback half
 *
 * The same run scores every published guide on the same window: impressions, clicks, position, days
 * since publication. A guide that is two weeks old and has no impressions is either not searched or not
 * ranking, and those two call for opposite responses. This tool does not decide which; it puts the
 * number where a person (or the next planner) can see it.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { gscSearchAnalytics, isoDaysAgo, loadEnv, today } from "./lib/gsc.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const QUEUE = join(ROOT, "data", "guide-queue.json");
const PLAN = join(ROOT, "data", "guide-plan.json");
const GUIDE_DIR = join(ROOT, "src", "content", "guide");

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const AS_JSON = args.includes("--json");
const DAYS = Number((args.find((a) => a.startsWith("--days=")) ?? "--days=90").slice(7)) || 90;

/* Class priors. Explicit, ordered, and visible in the output so a wrong one can be argued with. */
const PRIOR = {
  tax: 3.0,
  residence: 3.0,
  "work-visa": 2.8,
  "social-insurance": 2.5,
  driving: 2.2,
  relocation: 2.0,
  transit: 1.8,
  employment: 2.6,
};
const INTENT_WORDS =
  /\b(how|what|can|do i|does|requirements?|documents?|steps?|cost|costs|fee|fees|renew|renewal|apply|application|need|qualify|eligible|deadline|registration|permit|visa|account|card|licen[cs]e|residence|conversion|insurance|deposit|reconciliation|threshold)\b/i;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter((w) => w.length >= 3);

/** How well a Search Console query matches a topic's own query string. 0 when unrelated. */
function matchScore(topicQuery, gscQuery) {
  const a = tokens(topicQuery);
  const b = new Set(tokens(gscQuery));
  if (!a.length || !b.size) return 0;
  const hit = a.filter((w) => b.has(w)).length;
  const overlap = hit / a.length;
  /* A phrase match is worth more than the same words in a different order. */
  const phrase = norm(gscQuery).includes(norm(topicQuery)) ? 0.25 : 0;
  return Math.min(1, overlap + phrase);
}

/* ── signals ─────────────────────────────────────────────────────────────────────────────────── */

const queue = JSON.parse(readFileSync(QUEUE, "utf8"));
const published = new Set(
  (existsSync(GUIDE_DIR) ? readdirSync(GUIDE_DIR) : []).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
);

let gscRows = [];
let gscOn = false;
const env = loadEnv(join(ROOT, ".env.keywords"));
if (env.GSC_CREDENTIALS && env.GSC_SITE_URL) {
  const stats = { gscCalls: 0, retries: 0 };
  const res = gscSearchAnalytics(
    env,
    { startDate: isoDaysAgo(DAYS), endDate: today(), dimensions: ["query", "page"], rowLimit: 25000 },
    stats,
  );
  gscRows = res?.rows ?? [];
  gscOn = gscRows.length > 0;
}

/* Page-level demand, so the gap size is measured rather than guessed. */
const pageStats = new Map();
for (const r of gscRows) {
  const page = r.keys?.[1] ?? "";
  const m = /\/guide\/([^/]+)\//.exec(page);
  if (!m) continue;
  const cur = pageStats.get(m[1]) ?? { impressions: 0, clicks: 0, position: Number.POSITIVE_INFINITY };
  cur.impressions += r.impressions ?? 0;
  cur.clicks += r.clicks ?? 0;
  cur.position = Math.min(cur.position, r.position ?? Number.POSITIVE_INFINITY);
  pageStats.set(m[1], cur);
}

/* ── score the queue ────────────────────────────────────────────────────────────────────────── */

for (const t of queue.topics) {
  if (t.status === "done" || published.has(t.slug)) continue;

  let best = { impressions: 0, query: "" };
  for (const r of gscRows) {
    const s = matchScore(t.query ?? t.title ?? "", r.keys?.[0] ?? "");
    if (s >= 0.5 && (r.impressions ?? 0) > best.impressions) {
      best = { impressions: r.impressions, query: r.keys[0] };
    }
  }

  const demand = best.impressions > 0 ? Math.min(5, Math.log1p(best.impressions)) : 0;
  const prior = PRIOR[t.topic] ?? 2.0;
  const base = demand > 0 ? demand : prior;
  const intent = INTENT_WORDS.test(t.query ?? "") ? 1.0 : 0.6;

  const page = pageStats.get(t.slug);
  const gap = !page ? 1.0 : page.position <= 10 ? 0.1 : 0.5;

  t.priorityScore = Number((base * intent * gap).toFixed(2));
  t.priorityWhy = {
    basis: demand > 0 ? "measured" : "prior",
    base: Number(base.toFixed(2)),
    demandImpressions: best.impressions,
    demandQuery: best.query,
    intent,
    gap,
    pageImpressions: page?.impressions ?? 0,
    pagePosition: Number.isFinite(page?.position) ? page.position : null,
  };
}

const plan = queue.topics
  .filter((t) => t.status !== "done" && !published.has(t.slug))
  .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + "\n", "utf8");
writeFileSync(
  PLAN,
  JSON.stringify({ at: new Date().toISOString(), days: DAYS, gsc: gscOn, plan, pages: [...pageStats.entries()] }, null, 2) + "\n",
  "utf8",
);

/* ── the scorecard: how the published guides are doing ──────────────────────────────────────── */

const scorecard = [...published]
  .map((slug) => ({ slug, ...(pageStats.get(slug) ?? { impressions: 0, clicks: 0, position: null }) }))
  .sort((a, b) => b.impressions - a.impressions);

/*
 * Inbound links, counted from the corpus rather than assumed.
 *
 * On 2026-10-26 all ten published guides had zero impressions in Search Console, and all ten had zero
 * inbound links from anywhere on the site. The two numbers are the same number: a page nothing points at
 * is a page a crawler has no reason to rank.
 *
 * This is the finding that changes what to do next. Writing an eleventh guide does not help if the ten
 * that exist have no links; it makes the problem bigger. So the tool reports the orphan count next to
 * the plan, and the plan is not the only thing to act on.
 */
const corpus = [];
for (const dir of ["blog", "guide"]) {
  const root = join(ROOT, "src", "content", dir);
  if (!existsSync(root)) continue;
  for (const f of readdirSync(root).filter((x) => x.endsWith(".md"))) {
    corpus.push(readFileSync(join(root, f), "utf8"));
  }
}
const inbound = new Map();
for (const body of corpus) {
  for (const m of body.matchAll(/\]\(\/guide\/([^/)#?]+)\/?/g)) {
    inbound.set(m[1], (inbound.get(m[1]) ?? 0) + 1);
  }
}
for (const s of scorecard) s.inbound = inbound.get(s.slug) ?? 0;

/*
 * The index lists every guide, so a guide with zero article-level inlinks is still reachable - one hop
 * from the nav, two from anywhere else. That distinction is the whole point: "reachable" and "linked"
 * are not the same claim, and conflating them is how a page with no links gets reported as fine.
 */
const shallow = scorecard.filter((s) => s.inbound === 0);

if (AS_JSON) {
  console.log(JSON.stringify({ gsc: gscOn, plan, scorecard, indexOnly: shallow.map((o) => o.slug) }));
} else if (!QUIET) {
  console.log(`GUIDE PLAN  ${DAYS}-day window   GSC: ${gscOn ? "measured" : "NOT CONFIGURED - priors only"}`);
  console.log("=".repeat(84));
  console.log("  next to write:");
  for (const t of plan.slice(0, 6)) {
    const w = t.priorityWhy;
    console.log(
      `   ${String(t.priorityScore).padStart(5)}  ${t.slug.padEnd(44)} ${w.basis === "measured" ? `measured ${w.demandImpressions} imp` : `prior ${w.base}`} x intent ${w.intent} x gap ${w.gap}`,
    );
  }
  const cold = scorecard.filter((s) => s.impressions === 0);
  console.log(`\n  published guides: ${scorecard.length}   with any impression: ${scorecard.length - cold.length}`);
  for (const s of scorecard.slice(0, 6)) {
    console.log(
      `   ${String(s.impressions).padStart(4)} imp ${String(s.clicks).padStart(3)} clk  pos ${String(Number.isFinite(s.position) ? s.position : "-").padStart(5)}  in ${String(s.inbound).padStart(2)}  ${s.slug}`,
    );
  }
  if (shallow.length) {
    console.log(`\n  REACHABLE ONLY THROUGH THE INDEX: ${shallow.length} of ${scorecard.length} guides have no article-level inbound link.`);
    console.log(`  That is a link problem, not a topic problem - the fix is a sentence in a related piece, not an eleventh guide.`);
  }
  console.log(`\n  written: data/guide-plan.json, and priorityScore in data/guide-queue.json`);
}
