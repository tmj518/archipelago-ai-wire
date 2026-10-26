import { readFileSync, existsSync } from "node:fs";

/**
 * Re-verify, and make this a permanent check rather than a one-off.
 *
 * The five pages without structured data got that way because it was opt-in per page.
 * The same reasoning applies to the check: if it is not run every build, the next page
 * added will drift the same way.
 */
/*
 * One entry per page type, not per page.
 *
 * Updated 2026-10-26: the list still named /calculator/, /tracker/, /markets/, two China categories
 * and two China articles, all of which left with the repositioning. A gate that asserts pages exist
 * has to be updated when pages are deliberately removed, or it reports the removal as a defect
 * every run until someone switches it off - which is how a gate stops being trusted.
 */
const PAGES = [
  ["/", "dist/index.html", false],
  ["/about/", "dist/about/index.html", false],
  ["/sources/", "dist/sources/index.html", false],
  ["/category/world/", "dist/category/world/index.html", false],
  ["/category/malaysia-impact/", "dist/category/malaysia-impact/index.html", false],
  ["/category/tech-ai/", "dist/category/tech-ai/index.html", false],
  ["/category/economy/", "dist/category/economy/index.html", false],
  ["/guide/", "dist/guide/index.html", false],
  ["/privacy/", "dist/privacy/index.html", true],
  ["/404.html", "dist/404.html", true],
];

const problems = [];
console.log("STRUCTURED DATA CHECK\n" + "=".repeat(80));

for (const [label, file, expectNoIndex] of PAGES) {
  if (!existsSync(file)) { problems.push(`${label}: file missing`); console.log(`  MISSING ${label}`); continue; }
  const h = readFileSync(file, "utf8");
  const blocks = [];
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { blocks.push(JSON.parse(m[1])); } catch { blocks.push({ "@type": "UNPARSEABLE" }); }
  }
  const types = blocks.map((b) => b["@type"]);
  const dupes = types.filter((t, i) => types.indexOf(t) !== i);

  console.log(`\n  ${label}`);
  console.log(`     ${types.join(", ")}`);

  if (expectNoIndex) {
    if (types.length) problems.push(`${label}: noindex page carries structured data`);
    continue;
  }

  /*
   * An article carries its FAQ as FAQPage, or the questions are prose.
   *
   * Every article has a FAQ section with three answered questions - the most quotable part of the page - and
   * none carried the type that makes it quotable. This check verified four other blocks and never asked, which
   * is why thirty-two articles shipped without it.
   *
   * Scoped to article pages: a FAQPage on a listing page would be a page claiming to answer questions it does
   * not.
   */
  if (label.startsWith("/blog/")) {
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    if (!faq) {
      problems.push(`${label}: no FAQPage, so the FAQ section is not machine-readable`);
    } else {
      const qs = faq.mainEntity ?? [];
      if (qs.length < 2) problems.push(`${label}: FAQPage has ${qs.length} question(s), needs >= 2`);
      for (const q of qs) {
        if (!q.name || !q.acceptedAnswer?.text) problems.push(`${label}: a Question is missing name or acceptedAnswer.text`);
      }
    }
  }

  if (!types.includes("Organization")) problems.push(`${label}: no Organization`);
  if (!types.includes("WebSite")) problems.push(`${label}: no WebSite`);
  if (dupes.length) problems.push(`${label}: duplicate block type(s): ${dupes.join(", ")}`);
  /*
   * NewsArticle is accepted alongside Article. Both take the same properties, so the article
   * pages claim the news type deliberately - it is the correct classification for dated
   * reporting on a change, which is all this site publishes - and a gate that only knew about
   * Article would reject every article page as having no page-level block.
   */
  if (!types.some((t) => ["WebPage", "CollectionPage", "AboutPage", "ContactPage", "Article", "NewsArticle"].includes(t))) {
    problems.push(`${label}: no page-level block`);
  }

  const crumb = blocks.find((b) => b["@type"] === "BreadcrumbList");
  if (crumb) {
    const items = crumb.itemListElement ?? [];
    if (items.length < 2) problems.push(`${label}: BreadcrumbList has ${items.length} item(s), needs >= 2`);
    for (const it of items) {
      if (!it.position || !it.name || !it.item) problems.push(`${label}: a ListItem is missing position/name/item`);
    }
    console.log(`     crumb: ${items.map((i) => i.name).join(" > ")}`);
  } else if (label !== "/") {
    problems.push(`${label}: no BreadcrumbList`);
  }

  const org = blocks.find((b) => b["@type"] === "Organization");
  if (org && (!org.url || !org.logo)) problems.push(`${label}: Organization missing url or logo`);
}

console.log("\n" + "=".repeat(80));
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
