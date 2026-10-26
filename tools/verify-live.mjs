#!/usr/bin/env node
/**
 * Verify the live site after a deploy.
 *
 * Run by tools/run-daily.ps1 as the last step, and safe to run by hand:
 *     node tools/verify-live.mjs
 *     node tools/verify-live.mjs --slug eu-cbam-cost-per-tonne-chinese-steel-aluminium-2026
 *
 * Three things are checked, and two of them have already been wrong once:
 *
 *   1. Every article answers 200 and serves its own title. A single read during a
 *      deployment window returned 404 for a page that was already serving, so each
 *      URL is retried before it is called broken. The title is what separates "this
 *      page deployed" from "something answered".
 *   2. The live figure total matches the repository's.
 *   3. The sitemap lists every published article, so a piece that never deployed is
 *      visible rather than counted as fine.
 *
 * What this file no longer does, and why. It used to require each article's
 * `figures[].value` strings to appear in that article's rendered HTML. They never
 * do: the five-part records live in frontmatter and no template renders them, so no
 * deploy could ever satisfy the assertion. On 8 October 2026 it was reporting 12 of
 * 22 articles as broken while nothing was broken, and because the daily log quoted
 * only the `down: 0` line, nobody read the twelve. Asserting rendered text for data
 * that is deliberately not rendered is not a check — it is a permanent false alarm
 * that teaches you to skip the file.
 *
 * The figure data is verified where it is actually published instead: /sources/
 * states the library-wide total, computed at build time from the same frontmatter,
 * so a figure edit that never redeployed shows up as a mismatch. It cannot catch a
 * same-total edit, which is the argument for giving each record its own address.
 *
 * Exit 0 only if all of them pass.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://landedmath.com";
const SLUG_ARG = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const bust = () => "?cb=" + Date.now() + Math.random().toString(36).slice(2, 7);

/** GET with retries: a deploy window makes a single read unreliable. */
async function get(url, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url + bust());
      if (r.status === 200) return { ok: true, text: await r.text(), attempt: i };
    } catch { /* retry */ }
    if (i < attempts) await new Promise((x) => setTimeout(x, 6000));
  }
  return { ok: false };
}

// What the repository says should be live.
const DIR = "src/content/blog";
const published = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
  const raw = readFileSync(join(DIR, f), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
  if (/^draft:\s*true/m.test(fm)) continue;
  const title = /^title:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1] ?? "";
  /*
   * Counted, not collected. The values themselves are never rendered on an article
   * page, so keeping the strings here only invited a check that could not pass. The
   * count is what /sources/ publishes, and that is what step 2 compares.
   */
  const figures = (fm.match(/^\s*-\s*value:/gm) || []).length;
  published.push({ slug: f.replace(/\.md$/, ""), title, figures });
}

console.log(`LIVE VERIFICATION — ${published.length} published articles`);
console.log("=".repeat(74));

const targets = SLUG_ARG ? published.filter((p) => p.slug === SLUG_ARG) : published;
if (SLUG_ARG && targets.length === 0) {
  console.log(`  no published article matches --slug ${SLUG_ARG}`);
  process.exit(1);
}

let down = 0;
let wrongPage = 0;

/*
 * Compare on letters and digits only. The h1 is wrapped in markup and some titles
 * carry punctuation the template entity-encodes, so a literal match fails for
 * reasons that have nothing to do with the deploy.
 */
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// 1. Every live article answers, and it is that article.
for (const p of targets) {
  const r = await get(`${BASE}/blog/${p.slug}/`);
  if (!r.ok) {
    down++;
    console.log(`  DOWN  ${p.slug}`);
    continue;
  }
  const text = r.text.replace(/<[^>]+>/g, " ");
  if (!p.title || !norm(text).includes(norm(p.title))) {
    wrongPage++;
    console.log(`  WRONG PAGE  ${p.slug}  -> its title is not on the page`);
  } else {
    console.log(`  ok[${r.attempt}]  ${p.slug}  (title present, ${p.figures} figures declared)`);
  }
}

// 3. The sitemap agrees with the repository.
const sm = await get(`${BASE}/sitemap-0.xml`);
let inSitemap = 0;
let absentFromSitemap = [];
if (sm.ok) {
  const urls = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const blogUrls = urls.filter((u) => u.includes("/blog/"));
  inSitemap = blogUrls.length;
  for (const p of published) if (!blogUrls.some((u) => u.includes(p.slug))) absentFromSitemap.push(p.slug);
  console.log(`\n  sitemap: ${urls.length} urls, ${blogUrls.length} blog urls`);
} else {
  console.log(`\n  sitemap: NOT REACHABLE`);
}

// 2. The figure total the site publishes is the one the repository holds.
const repoFigures = published.reduce((a, p) => a + p.figures, 0);

const readLiveFigures = async () => {
  const r = await get(`${BASE}/sources/`);
  if (!r.ok) return null;
  const text = r.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /All (\d+) published figures/.exec(text);
  return m ? Number(m[1]) : null;
};

let liveFigures = await readLiveFigures();

/*
 * Retry the read, for the same reason the article reads above retry. This runs about
 * 45 seconds after a push, and a deploy that has not finished looks exactly like a
 * figure edit that never shipped. Calling that lag a mismatch would make this the
 * newest false alarm in a file whose recent history is nothing but false alarms.
 */
for (let i = 0; liveFigures !== repoFigures && i < 4; i++) {
  await new Promise((x) => setTimeout(x, 15000));
  liveFigures = await readLiveFigures();
}

const figuresAgree = liveFigures === repoFigures;
console.log(
  `\n  figures: repository ${repoFigures} · live /sources/ ${liveFigures === null ? "COULD NOT READ" : liveFigures}` +
    (figuresAgree ? "" : "  <- MISMATCH"),
);

console.log("\n" + "=".repeat(74));
console.log(`  checked        : ${targets.length}`);
console.log(`  down           : ${down}`);
console.log(`  wrong page     : ${wrongPage}`);
console.log(`  figures agree  : ${figuresAgree ? "yes" : "no"}`);
console.log(`  not in sitemap : ${absentFromSitemap.length}${absentFromSitemap.length ? " -> " + absentFromSitemap.join(", ") : ""}`);

const bad =
  down + wrongPage + absentFromSitemap.length + (figuresAgree ? 0 : 1) + (sm.ok ? 0 : 1);
console.log(`\nRESULT: ${bad === 0 ? "the live site matches the repository" : `${bad} problem(s)`}`);
process.exit(bad === 0 ? 0 : 1);
