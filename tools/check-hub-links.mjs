import { readFileSync, existsSync, readdirSync } from "node:fs";

/**
 * Topic-hub links per article, counted from the built HTML.
 *
 * Two earlier attempts at this number were wrong in different ways, and both are worth recording:
 *
 *   1. Counting `/category/` links reported five hub links per article. The sidebar renders all five
 *      categories on every page, so a site-wide component was being read as article content.
 *   2. Matching `class="article-hubs"` with a `[^"]` pattern reported zero. Astro adds a scope
 *      attribute to the class list - `class="article-hubs" data-astro-cid-...` - so the pattern still
 *      matched, but the block-boundary regex needed the attribute inside the tag and did not have it.
 *
 * This version anchors on the heading text, which no other component uses, and takes the links
 * between it and the following section end. The split between topic links and the index link is
 * reported separately so neither can be mistaken for the other.
 */
const dirs = readdirSync("dist/blog").filter((d) => existsSync(`dist/blog/${d}/index.html`));
const rows = [];

for (const d of dirs) {
  const h = readFileSync(`dist/blog/${d}/index.html`, "utf8");
  /*
   * Anchor on the section class rather than the heading text. The heading differs by article - it
   * reads "Topics in this analysis" when the article has hubs and "Browse by topic" when it does
   * not - so a text anchor silently missed exactly the articles this check exists to find. That was
   * the third wrong version of this count, which is why it now lives in a committed script.
   */
  const start = h.indexOf('class="article-hubs"');
  let topics = [];
  let hasIndex = false;
  if (start > 0) {
    const after = h.slice(start);
    const end = after.indexOf("Related Reading");
    const block = end > 0 ? after.slice(0, end) : after.slice(0, 4000);
    topics = [...new Set([...block.matchAll(/href="\/topic\/([a-z0-9-]+)\//g)].map((m) => m[1]))];
    hasIndex = /href="\/topic\/"/.test(block);
  }
  rows.push({ slug: d, topics, hasIndex, n: topics.length, effective: topics.length + (hasIndex ? 1 : 0) });
}

rows.sort((a, b) => a.effective - b.effective || a.slug.localeCompare(b.slug));

console.log("TOPIC-HUB LINKS PER ARTICLE\n" + "=".repeat(86));
const dist = new Map();
for (const r of rows) dist.set(r.n, (dist.get(r.n) ?? 0) + 1);
console.log(`  articles                     : ${rows.length}`);
console.log(`  with the index link           : ${rows.filter((r) => r.hasIndex).length}`);
console.log(`  distribution of topic links   :`);
for (const [n, k] of [...dist].sort((a, b) => a[0] - b[0])) console.log(`    ${n} topic link(s): ${k} article(s)`);

const ge3 = rows.filter((r) => r.effective >= 3);
console.log(`\n  at or above 3 counting the index link : ${ge3.length} of ${rows.length}`);
console.log(`  at or above 3 counting topic links only: ${rows.filter((r) => r.n >= 3).length}`);

console.log(`\n  the ones below 3 topic links:`);
for (const r of rows.filter((x) => x.n < 3)) {
  console.log(`    ${r.n}${r.hasIndex ? "+1" : "  "}  ${r.slug}`);
  console.log(`          ${r.topics.join(", ") || "(none)"}`);
}
