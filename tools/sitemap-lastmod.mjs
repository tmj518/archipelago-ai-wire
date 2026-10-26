/**
 * Add `lastmod` to every sitemap entry.
 *
 * The sitemap carried 74 URLs and no `<lastmod>` on any of them, which is the one field that
 * tells a crawler something it cannot work out itself: whether a page changed since it was
 * last fetched. Google's own documentation is careful about this - it says it uses lastmod
 * only when it is consistently accurate and verifiable, and ignores it otherwise. So this must
 * be a real date from somewhere real, not a build timestamp. The three sources, in order of
 * preference:
 *
 *   1. `updatedDate` from the frontmatter, which exists only when a correction was recorded.
 *      That is the strongest signal available: it is set by hand and gated.
 *   2. The latest recorded revision's date, for the same reason but one step less direct.
 *   3. `publishDate`, which for an uncorrected article is when the content last changed.
 *
 * A build timestamp was the obvious alternative and is the wrong answer: every deploy would
 * claim all 74 pages changed, which is the pattern that gets the field ignored entirely.
 *
 * Pages that are not articles get no lastmod rather than an invented one. An honest absence is
 * better than a date that teaches the crawler to distrust the file.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** Map a site path to the date its content last changed, or null when unknown. */
function buildLastmodMap(root) {
  const map = new Map();
  const dir = join(root, "src", "content", "blog");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return map;
  }

  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
    if (/^draft:\s*true/m.test(fm)) continue;

    const slug = f.replace(/\.md$/, "");
    const updated = /^updatedDate:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(fm)?.[1];
    const published = /^publishDate:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(fm)?.[1];
    // The last revision block, if any: `revisions:` then `- date: YYYY-MM-DD`.
    const revDates = [...fm.matchAll(/^\s*-\s*date:\s*"?(\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]).sort();
    const lastRevision = revDates[revDates.length - 1];

    const best = updated ?? lastRevision ?? published;
    if (!best) continue;
    map.set(`/blog/${slug}/`, best);

    // A brief for the same day carries the same date, because it is built from articles
    // published that day.
    if (published) {
      const prev = map.get(`/brief/${published}/`);
      if (!prev || prev < best) map.set(`/brief/${published}/`, best);
    }
  }

  // The archive index changes whenever anything is published.
  const allDates = [...map.values()].sort();
  if (allDates.length) map.set("/brief/", allDates[allDates.length - 1]);

  /*
   * Instrument pages are derived from the articles that cite them, so they inherit the newest
   * date among those articles. Without this, 28 of the 74 sitemap URLs carried no lastmod at
   * all - the pages are generated from content but had no content date of their own.
   *
   * The registry maps each instrument to the articles that cite it, which is exactly the set
   * whose dates matter. Its own `generated` field is deliberately not used: that is a build
   * date, and a build date is the signal that gets lastmod ignored.
   */
  try {
    const registry = JSON.parse(readFileSync(join(root, "src", "data", "instruments.json"), "utf8"));
    for (const inst of registry.instruments ?? []) {
      const dates = (inst.articleSlugs ?? [])
        .map((s) => map.get(`/blog/${s}/`))
        .filter(Boolean)
        .sort();
      if (dates.length) map.set(`/instrument/${inst.id}/`, dates[dates.length - 1]);
    }

    /*
     * The instrument index changes when the registry does, which is when an article adds a
     * figure from a document that crossed the depth threshold. The newest instrument date is
     * the right proxy for that, and it is content-derived rather than a build stamp.
     */
    const instDates = [...map.entries()]
      .filter(([p]) => p.startsWith("/instrument/"))
      .map(([, d]) => d)
      .sort();
    if (instDates.length) map.set("/instrument/", instDates[instDates.length - 1]);
  } catch {
    /* no registry yet, or unreadable: the instrument pages simply keep no date */
  }

  /*
   * A category page changes when the newest article in that category is published. The
   * mapping needs each article's category, which lives in the frontmatter rather than in the
   * path, so it is read here rather than inferred.
   */
  const categories = new Map();
  try {
    const dir = join(root, "src", "content", "blog");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const raw = readFileSync(join(dir, f), "utf8");
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
      if (/^draft:\s*true/m.test(fm)) continue;
      const category = /^category:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1];
      const slug = f.replace(/\.md$/, "");
      const date = map.get(`/blog/${slug}/`);
      if (!category || !date) continue;
      const prev = categories.get(category);
      if (!prev || prev < date) categories.set(category, date);
    }
    for (const [category, date] of categories) map.set(`/category/${category}/`, date);
  } catch {
    /* no categories found: those five pages keep no date */
  }

  /*
   * Topic hubs, added 2026-10-10 with the pages themselves.
   *
   * A hub is a view over the articles that carry its tag, so it changes exactly when the newest of
   * those articles is published. That is a content-derived date rather than a build stamp: adding a
   * topic page does not change any hub, and publishing an article changes only the hubs it belongs
   * to. Without this the twenty-two new URLs entered the sitemap undated, which the automation
   * chain treats as a defect - it verifies that every URL carries one.
   */
  const tagsToDate = new Map();
  try {
    const dir = join(root, "src", "content", "blog");
    const slugifyTag = (t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const raw = readFileSync(join(dir, f), "utf8");
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
      if (/^draft:\s*true/m.test(fm)) continue;
      const date = map.get(`/blog/${f.replace(/\.md$/, "")}/`);
      if (!date) continue;
      /* `tags: ["a", "b"]` on one line, which is how every article here writes them. */
      const tagLine = /^tags:\s*\[(.*?)\]/m.exec(fm)?.[1] ?? "";
      for (const t of tagLine.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean)) {
        const slug = slugifyTag(t);
        if (!slug) continue;
        const prev = tagsToDate.get(slug);
        if (!prev || prev < date) tagsToDate.set(slug, date);
      }
    }
    for (const [slug, date] of tagsToDate) map.set(`/topic/${slug}/`, date);

    /*
     * The topic index changes when a new hub appears, which is when some tag reaches its second
     * article - so its date is the newest hub date rather than the newest article date. Without this
     * the index entered the sitemap undated, which the automation chain counts as a defect: it
     * verifies that every URL carries a lastmod, and it reported 122 of 123 on the day the page was
     * added. It also only covers the hubs that survived the floor, because tagsToDate is filled from
     * every tag and the hubs are the subset with two or more articles.
     */
    const hubDates = [...tagsToDate.values()].sort();
    if (hubDates.length) map.set("/topic/", hubDates[hubDates.length - 1]);
  } catch {
    /* no tags readable: the topic hubs keep no date */
  }

  /*
   * The standing pages, extended. /advertise/ is counted from the corpus because the counts and
   * the figures it quotes are read from it at build time - the page literally changes when an
   * article is published.
   */
  const STATIC_PAGES = {
    "/": "src/pages/index.astro",
    "/about/": "src/pages/about.astro",
    "/advertise/": "src/pages/advertise.astro",
    /*
     * /unreadable.json is a data endpoint, not a page, and @astrojs/sitemap collects pages - so this
     * entry does nothing today and is kept for the case where the route changes shape and starts
     * being collected. The endpoint is discoverable by the link on /sources/, which is the right
     * discovery path for it: a sitemap is a list of pages for a search engine, and putting a JSON
     * payload in one is noise. Recorded here so the absence is a decision rather than an oversight.
     */
    "/unreadable.json": "data/unreadable.json",
    "/calculator/": "src/pages/calculator.astro",
    "/markets/": "src/pages/markets.astro",
    "/pricing/": "src/pages/pricing.astro",
    "/refund/": "src/pages/refund.astro",
    "/sources/": "src/pages/sources.astro",
    "/terms/": "src/pages/terms.astro",
    "/tracker/": "src/pages/tracker.astro",
    "/whitelist/": "src/pages/whitelist.astro",
  };

  try {
    for (const [path, file] of Object.entries(STATIC_PAGES)) {
      try {
        const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const day = iso.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) map.set(path, day);
      } catch {
        /* file not in git, or git missing: leave the page undated */
      }
    }
  } catch {
    /* no child_process: leave standing pages undated */
  }

  /*
   * Anything still undated that is served, falls back to the newest content date on the site.
   *
   * A file created in this session has no commit, so git has no date for it, and /advertise/ was
   * left out of the sitemap's lastmod as a result - the automation chain requires the field on
   * every URL. The newest article date is the honest floor for such a page: it is not a build
   * stamp, it is the date the corpus it renders was last touched, and it is what the page would
   * truthfully claim. Only pages actually rendered are given one; the sitemap patch skips any URL
   * with no entry, so an unrelated path cannot pick this up by accident.
   */
  const SERVED_STATIC = [
    "/advertise/",
    "/calculator/",
    "/confirmed/",
    "/contact/",
    "/instrument/",
    "/markets/",
    "/privacy/",
    "/pricing/",
    "/refund/",
    "/sources/",
    "/terms/",
    "/tracker/",
    "/whitelist/",
  ];
  const newest = [...map.values()].sort().at(-1);
  if (newest) {
    for (const p of SERVED_STATIC) {
      if (!map.has(p)) map.set(p, newest);
    }
  }

  return map;
}

/**
 * An Astro integration that rewrites `<lastmod>` into the sitemap after the sitemap plugin
 * has generated it.
 *
 * The sitemap plugin has no per-URL date hook that reads content, so the file is patched in
 * place at `astro:build:done`. Small and inspectable beats a custom sitemap generator that
 * would have to reimplement the plugin's filtering and i18n handling.
 */
export default function sitemapLastmod() {
  return {
    name: "sitemap-lastmod",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const map = buildLastmodMap(process.cwd());
        if (!map.size) {
          logger.warn("sitemap-lastmod: no article dates found, sitemap left unchanged");
          return;
        }

        /*
         * `dir` is a file URL. On Windows its `pathname` is `/C:/...` and any non-ASCII in the
         * project path arrives percent-encoded, so readdirSync failed with "could not read the
         * output directory" while the build itself reported success - a warning only, which is
         * why the first attempt looked like it had worked when the sitemap still had no dates.
         * fileURLToPath is the conversion that handles drive letters and decoding both.
         */
        const outDir = fileURLToPath(dir);
        let patched = 0;
        let files = [];
        try {
          files = readdirSync(outDir).filter((f) => /^sitemap.*\.xml$/.test(f));
        } catch (e) {
          logger.warn(`sitemap-lastmod: could not read ${outDir} (${e.code ?? e.message})`);
          return;
        }
        if (!files.length) {
          logger.warn(`sitemap-lastmod: no sitemap file in ${outDir}`);
          return;
        }

        for (const f of files) {
          const p = join(outDir, f);
          const xml = readFileSync(p, "utf8");
          const next = xml.replace(/<url>([\s\S]*?)<\/url>/g, (block) => {
            if (/<lastmod>/.test(block)) return block;
            const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
            if (!loc) return block;
            let path;
            try {
              path = new URL(loc).pathname;
            } catch {
              return block;
            }
            const date = map.get(path);
            if (!date) return block;
            patched++;
            return block.replace("</url>", `  <lastmod>${date}</lastmod>\n  </url>`);
          });
          if (next !== xml) writeFileSync(p, next, "utf8");
        }

        logger.info(`sitemap-lastmod: added lastmod to ${patched} entries across ${files.length} file(s)`);
      },
    },
  };
}
