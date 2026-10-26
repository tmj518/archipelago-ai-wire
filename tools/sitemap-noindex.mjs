/**
 * Remove `noindex` pages from the generated sitemap.
 *
 * ## Why this exists
 *
 * The sitemap filter in `astro.config.mjs` is a list of URL patterns. It works for pages that are
 * permanently private (`/privacy/`, `/search/`), and it cannot work for pages whose indexability depends
 * on the corpus: a category with no articles, a guide index with no guides, a topic index with no
 * topics. On 2026-10-26 those six pages were in the sitemap while saying nothing, which is the one
 * contradiction a sitemap must never contain - it submits a URL for indexing that the page itself asks
 * not to be indexed, or that has nothing to index.
 *
 * Two ways to fix it. The first is to teach the config to count articles at build-config time and
 * derive the same answer independently. That duplicates the counting logic, and the two copies drift
 * the moment either changes - this repository has paid for that three times.
 *
 * The second is to read the answer the build already produced. Every page renders
 * `<meta name="robots" content="...noindex...">` when it should not be indexed. After the build, that
 * is a fact about the output rather than a second opinion about the input, so this hook reads the HTML
 * and removes exactly those URLs from the sitemap. The invariant becomes structural: a page that says
 * noindex cannot appear in the sitemap, whatever made it say so and whoever adds the next such page.
 *
 * Order matters: it runs after @astrojs/sitemap has written the files and after sitemap-lastmod has
 * annotated them, because both operate on the full set.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The robots meta a BaseLayout page emits when it should not be indexed. */
const NOINDEX = /<meta\s+name="robots"\s+content="[^"]*noindex/i;

/** Every .html file under dir, as absolute paths. */
function htmlFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".html")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** dist/…/index.html -> /…/ ; dist/index.html -> / ; anything else -> null (not a page URL). */
function fileToPath(root, file) {
  const rel = relative(root, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return null;
}

export default function sitemapNoindex() {
  return {
    name: "sitemap-noindex",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);

        const excluded = new Set();
        for (const file of htmlFiles(root)) {
          const path = fileToPath(root, file);
          if (!path) continue;
          if (NOINDEX.test(readFileSync(file, "utf8"))) excluded.add(path);
        }

        let removed = 0;
        let scanned = 0;
        for (const name of readdirSync(root).filter((f) => /^sitemap-\d+\.xml$/.test(f))) {
          const file = join(root, name);
          const before = readFileSync(file, "utf8");
          scanned += 1;
          const after = before.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
            const loc = /<loc>(.*?)<\/loc>/.exec(block)?.[1] ?? "";
            let path = "";
            try {
              path = new URL(loc).pathname;
            } catch {
              return block; // an unparseable loc is not ours to delete
            }
            if (excluded.has(path)) {
              removed += 1;
              return "";
            }
            return block;
          });
          if (after !== before) writeFileSync(file, after, "utf8");
        }

        if (removed) {
          logger?.info?.(`sitemap-noindex: removed ${removed} noindex page(s) from ${scanned} sitemap file(s)`);
        } else {
          logger?.info?.(`sitemap-noindex: no noindex pages to remove (${scanned} sitemap file(s) scanned)`);
        }
      },
    },
  };
}
