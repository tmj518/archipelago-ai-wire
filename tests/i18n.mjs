#!/usr/bin/env node
/**
 * P1-A: the language data layer.
 *
 * This stage ships no routes, so most of what matters is what did NOT change: the English
 * vocabulary, the English URLs, and the page count. The tests below assert both halves - the mapping
 * exists, and the existing site is untouched.
 *
 * Runs offline. Reads taxonomy.json directly (fs) rather than importing it through the module under
 * test, so a broken import cannot silently make the assertions pass on the same broken data.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const taxonomy = JSON.parse(readFileSync(join(ROOT, "src/lib/taxonomy.json"), "utf8"));
const i18n = await import(pathToFileURL(join(ROOT, "src/lib/i18n.mjs")).href);
const CATS = taxonomy.categories;

let pass = 0;
const failures = [];
const record = (name, ok, detail = "") => (ok ? pass++ : failures.push(`${name}${detail ? "  — " + detail : ""}`));
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ── the English vocabulary is unchanged ──────────────────────────────────── */

const EN = ["world", "malaysia-impact", "economy", "tech-ai", "work-education-family", "business-opportunities-risks"];
record("en: still exactly six categories", CATS.length === 6, String(CATS.length));
record("en: slugs unchanged and in order", CATS.map((c) => c.slug).join(",") === EN.join(","));
record("en: every category keeps a label and description", CATS.every((c) => c.label?.trim() && c.description?.trim()));
record("en: nav labels unchanged", CATS.every((c) => typeof c.navLabel === "string" && c.navLabel.length > 0));

/* ── the three-language mapping exists and is well formed ─────────────────── */

for (const cat of CATS) {
  record(`map: ${cat.slug} has ms and zh`, Boolean(cat.i18n?.ms && cat.i18n?.zh), JSON.stringify(cat.i18n ?? null));
  for (const loc of ["ms", "zh"]) {
    const v = cat.i18n?.[loc];
    record(`map: ${cat.slug}/${loc} slug shape`, typeof v?.slug === "string" && SLUG.test(v.slug), v?.slug);
    record(`map: ${cat.slug}/${loc} label non-empty`, typeof v?.label === "string" && v.label.trim().length > 0, v?.label);
    record(`map: ${cat.slug}/${loc} slug is not the English one`, v?.slug !== cat.slug, `${v?.slug} vs ${cat.slug}`);
  }
}

for (const loc of ["ms", "zh"]) {
  const slugs = CATS.map((c) => c.i18n?.[loc]?.slug);
  record(`map: ${loc} slugs unique`, new Set(slugs).size === slugs.length, slugs.join(","));
  const labels = CATS.map((c) => c.i18n?.[loc]?.label);
  record(`map: ${loc} labels unique`, new Set(labels).size === labels.length, labels.join(" | "));
}

/* ── the module's behaviour, not just its data ────────────────────────────── */

record("module: three languages declared", Object.keys(i18n.LANGUAGES).join(",") === "en,ms,zh");
record("module: zh uses zh-Hans", i18n.LANGUAGES.zh.htmlLang === "zh-Hans");
record("module: ms uses ms", i18n.LANGUAGES.ms.htmlLang === "ms");
record("module: english has no prefix", i18n.LANGUAGES.en.prefix === "" && i18n.localeRoot("en") === "");
record("module: ms root", i18n.localeRoot("ms") === "/ms");

record("module: statuses are the three agreed", i18n.LOCALIZATION_STATUSES.join(",") === "machine,draft,reviewed");
record("module: only reviewed is publishable", i18n.isPublishable("reviewed") && !i18n.isPublishable("machine") && !i18n.isPublishable("draft"));

record("module: label en", i18n.categoryLabel(CATS, "en", "world") === "World");
record("module: label ms", i18n.categoryLabel(CATS, "ms", "world") === "Dunia");
record("module: label zh", i18n.categoryLabel(CATS, "zh", "world") === "世界");
record("module: label falls back for unknown category", i18n.categoryLabel(CATS, "ms", "nope") === "nope");
record("module: slug ms", i18n.categorySlug(CATS, "ms", "economy") === "ekonomi");
record("module: slug zh", i18n.categorySlug(CATS, "zh", "economy") === "jingji");
record("module: unknown slug is null, not invented", i18n.categorySlug(CATS, "ms", "nope") === null);
record("module: reverse lookup ms", i18n.englishSlugFor(CATS, "ms", "ekonomi") === "economy");
record("module: reverse lookup rejects a cross-language slug", i18n.englishSlugFor(CATS, "ms", "jingji") === null);
record("module: localized list is six", i18n.localizedCategories(CATS, "zh").length === 6);

/* ── English URLs are built exactly as before ─────────────────────────────── */

record("url: english article path unchanged", i18n.articlePath("en", "some-slug") === "/blog/some-slug/");
record("url: ms article path namespaced", i18n.articlePath("ms", "some-slug") === "/ms/blog/some-slug/");
record("url: zh article path namespaced", i18n.articlePath("zh", "some-slug") === "/zh/blog/some-slug/");

/* ── unreviewed translations can never be publishable ─────────────────────── */

const records = [
  { locale: "ms", translationKey: "a", localizationStatus: "machine" },
  { locale: "zh", translationKey: "a", localizationStatus: "reviewed" },
  { locale: "ms", translationKey: "b", localizationStatus: "draft" },
];
record("gate: machine and draft are excluded", i18n.reviewedLocales("a", records).join(",") === "zh");
record("gate: a piece with no reviewed version yields none", i18n.reviewedLocales("b", records).length === 0);

/* ── this stage added no routes ───────────────────────────────────────────── */

record("routes: no /ms directory in dist", !existsSync(join(ROOT, "dist/ms")));
record("routes: no /zh directory in dist", !existsSync(join(ROOT, "dist/zh")));
const htmlCount = (() => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : []));
  return existsSync(join(ROOT, "dist")) ? walk(join(ROOT, "dist")).length : 0;
})();
record("routes: page count unchanged at 17", htmlCount === 17, String(htmlCount));

/* ── the schema accepts the four required translation fields ──────────────── */

const config = readFileSync(join(ROOT, "src/content.config.ts"), "utf8");
for (const field of ["translationKey", "localizationStatus", "locale", "reviewedBy"]) {
  record(`schema: declares ${field}`, config.includes(field), field);
}
record("schema: registers both collections", /blogMs/.test(config) && /blogZh/.test(config));

/* ── eval-loop is wired into CI ───────────────────────────────────────────── */

const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
record("ci: runs tests/eval-loop.mjs", /tests\/eval-loop\.mjs/.test(ci));
record("ci: runs tests/i18n.mjs", /tests\/i18n\.mjs/.test(ci));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("RESULT: PASS — trilingual data layer in place, English untouched, no new routes");
