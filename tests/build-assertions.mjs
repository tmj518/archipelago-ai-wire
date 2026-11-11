#!/usr/bin/env node
/**
 * Assertions about the built output, not about the source.
 *
 *   pnpm exec astro build && node tests/build-assertions.mjs
 *
 * ## Why this is separate from tests/run-fixtures.mjs
 *
 * Everything in that suite runs from source in a fresh clone, with no build and no dist/. These checks
 * only mean anything against real output: whether a page actually emitted a robots meta, whether the
 * sitemap actually lost that URL. Keeping them apart means the fast suite stays fast and a clean clone
 * does not fail for the want of a build.
 *
 * ## What it pins
 *
 * The 2026-10-26 SEO audit found six archive pages in the sitemap while they had nothing to list. The
 * fix has two halves that must stay in agreement: the page marks itself noindex when empty, and the
 * sitemap drops every URL whose page is marked. This file is the agreement.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const BLOG = join(ROOT, "src", "content", "blog");
const GUIDES = join(ROOT, "src", "content", "guide");
const categories = JSON.parse(readFileSync(join(ROOT, "src", "lib", "taxonomy.json"), "utf8")).categories;

if (!existsSync(DIST)) {
  console.log("BUILD ASSERTIONS\n" + "=".repeat(78));
  console.log("  dist/ does not exist. Run `pnpm exec astro build` first.");
  process.exit(2);
}

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok, detail });

/** Every page URL a noindex meta appears on, read from the built HTML. */
const sitemapXml = readdirSync(DIST)
  .filter((f) => /^sitemap-\d+\.xml$/.test(f))
  .map((f) => readFileSync(join(DIST, f), "utf8"))
  .join("\n");
const sitemapPaths = [...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)]
  .map((m) => {
    try {
      return new URL(m[1]).pathname;
    } catch {
      return m[1];
    }
  });

/** dist path for a site path, for reading the page's own HTML. */
const pageFile = (p) => (p === "/" ? join(DIST, "index.html") : join(DIST, p.replace(/^\//, ""), "index.html"));
const pageHtml = (p) => (existsSync(pageFile(p)) ? readFileSync(pageFile(p), "utf8") : "");
const hasNoindex = (p) => /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(pageHtml(p));

/* ── archive indexing follows the current published corpus, not a stale six-category snapshot ── */

function frontmatter(text) {
  return /^---\r?\n([\s\S]*?)\r?\n---/m.exec(text)?.[1] ?? "";
}
const posts = readdirSync(BLOG).filter((f) => f.endsWith(".md")).map((f) => frontmatter(readFileSync(join(BLOG, f), "utf8")));
const publishedPosts = posts.filter((fm) => !/^draft:\s*true\s*$/m.test(fm));
const categoryCounts = new Map(categories.map((c) => [c.slug, 0]));
const tagCounts = new Map();
for (const fm of publishedPosts) {
  const category = /^category:\s*([a-z0-9-]+)/m.exec(fm)?.[1];
  if (categoryCounts.has(category)) categoryCounts.set(category, categoryCounts.get(category) + 1);
  const tags = /^tags:\s*\r?\n((?:[ \t]+-\s*.*(?:\r?\n|$))*)/m.exec(fm)?.[1] ?? "";
  for (const [, raw] of tags.matchAll(/^[ \t]+-\s*["']?(.*?)["']?\s*$/gm)) {
    const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (slug) tagCounts.set(slug, (tagCounts.get(slug) ?? 0) + 1);
  }
}
const topicCount = [...tagCounts.values()].filter((n) => n >= 2).length;
const guideCount = existsSync(GUIDES)
  ? readdirSync(GUIDES).filter((f) => f.endsWith(".md") && !/^draft:\s*true\s*$/m.test(frontmatter(readFileSync(join(GUIDES, f), "utf8")))).length
  : 0;
const archives = [
  ...categories.map((c) => [`/category/${c.slug}/`, categoryCounts.get(c.slug)]),
  ["/guide/", guideCount],
  ["/topic/", topicCount],
];

for (const [path, count] of archives) {
  record(`archive page exists: ${path}`, existsSync(pageFile(path)));
  if (count > 0) {
    record(`active archive is indexable: ${path}`, !hasNoindex(path), `${count} item(s)`);
    record(`active archive is in the sitemap: ${path}`, sitemapPaths.includes(path));
  } else {
    record(`empty archive is noindex: ${path}`, hasNoindex(path));
    record(`empty archive is absent from the sitemap: ${path}`, !sitemapPaths.includes(path), sitemapPaths.includes(path) ? "still listed" : "");
  }
}

/* ── pages that must stay indexable, and stay in the sitemap ───────────────────────────────── */

const MUST_INDEX = ["/", "/about/", "/sources/", "/contact/", "/terms/"];
for (const path of MUST_INDEX) {
  record(`content page is indexable: ${path}`, !hasNoindex(path));
  record(`content page is in the sitemap: ${path}`, sitemapPaths.includes(path));
}

/* ── the sitemap was not emptied to make the checks pass ──────────────────────────────────── */

record("sitemap still lists pages", sitemapPaths.length >= MUST_INDEX.length, `${sitemapPaths.length} URLs`);
record("sitemap still has an index file", existsSync(join(DIST, "sitemap-index.xml")));
record("robots.txt still points at the sitemap", /Sitemap: https?:\/\/\S+\/sitemap-index\.xml/.test(readFileSync(join(DIST, "robots.txt"), "utf8")));

/* ── the topic index no longer reports internal state, or links to dead silos ────────────── */

const topic = pageHtml("/topic/");
record("topic page does not print an internal zero-state", !/0 subjects, gathered from 0 analyses/.test(topic));
record(
  "topic page does not link to the retired category slugs",
  !/\/(category\/(trade-policy|platforms|supply-chain|sourcing|logistics))\//.test(topic),
);

/* ── the canonical domain (command 10, A) ─────────────────────────────────────────────────── */

const CANON = "https://www.ghiblistyled.com";
const home = pageHtml("/");

const canonical = /<link\s+rel="canonical"\s+href="([^"]+)"/.exec(home)?.[1] ?? "";
record("domain: canonical uses the confirmed origin", canonical === `${CANON}/`, canonical || "missing");

const ogUrl = /<meta\s+property="og:url"\s+content="([^"]+)"/.exec(home)?.[1] ?? "";
record("domain: og:url uses the confirmed origin", ogUrl.startsWith(`${CANON}/`), ogUrl || "missing");

const jsonLdUrls = [...home.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
record("domain: JSON-LD URLs use the confirmed origin", jsonLdUrls.length > 0 && jsonLdUrls.every((u) => u.startsWith(CANON)), jsonLdUrls[0] ?? "none");

record(
  "domain: every sitemap URL uses the confirmed origin",
  sitemapPaths.length > 0 && readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f)).every((f) => {
    const xml = readFileSync(join(DIST, f), "utf8");
    return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].every((m) => m[1].startsWith(`${CANON}/`));
  }),
);

const everyHtml = [];
for (const f of ["index.html", "about/index.html", "sources/index.html", "contact/index.html", "terms/index.html"]) {
  const p = join(DIST, f);
  if (existsSync(p)) everyHtml.push(readFileSync(p, "utf8"));
}
record(
  "domain: the placeholder domain appears in no page",
  everyHtml.every((h) => !/archipelagoaiwire/.test(h)),
);

/* ── redirects ship with the build (command 10, B) ─────────────────────────────────────────── */

const shippedRedirects = join(DIST, "_redirects");
if (existsSync(shippedRedirects)) {
  const r = readFileSync(shippedRedirects, "utf8");
  record("redirects: shipped to dist", true);
  record("redirects: bare domain 301s to www", /^https:\/\/ghiblistyled\.com\/\*\s+https:\/\/www\.ghiblistyled\.com\/:splat\s+301$/m.test(r));
  record("redirects: the old domain is not shipped", !/landedmath/.test(r));
} else {
  record("redirects: shipped to dist", false, "_redirects missing from dist");
}

/* ── GA4 is absent unless explicitly enabled (command 10, C) ───────────────────────────────── */

const allHtml = [];
for (const f of readdirSync(DIST).filter((x) => x.endsWith(".html"))) allHtml.push(readFileSync(join(DIST, f), "utf8"));
for (const d of ["about", "contact", "sources", "terms", "privacy", "search", "guide", "topic"]) {
  const p = join(DIST, d, "index.html");
  if (existsSync(p)) allHtml.push(readFileSync(p, "utf8"));
}
const joined = allHtml.join("\n");
record("ga: no gtag loader in the build", !/googletagmanager\.com\/gtag\/js/.test(joined));
record("ga: no measurement-id meta in the build", !/name="ga-measurement-id"/.test(joined));
record("ga: the previous project's id is not in the build", !/N99G9FY6NZ/.test(joined));
record("gsc: no empty verification meta", !/<meta\s+name="google-site-verification"\s+content=""/.test(joined));

/* ── report ────────────────────────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.ok);
console.log("BUILD ASSERTIONS\n" + "=".repeat(78));
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
console.log("");
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("\nFAILURES:");
  for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("RESULT: PASS");
