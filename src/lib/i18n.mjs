/**
 * The language layer's pure half.
 *
 * Nothing here reads the filesystem. Every function takes the category list as an argument, because
 * the alternative was tried and failed: a `createRequire` loading `taxonomy.json` works in Node and
 * breaks inside Astro's prerender chunk, where the relative path no longer resolves. Passing the
 * data in keeps this module usable from a page, a tool and a test with no bundler-specific magic.
 *
 * What this file does NOT do: route, render, or decide that a translation is published. It maps
 * between the three languages and answers which versions exist and are reviewed.
 */

/** The languages the site publishes in. English owns every URL that already exists. */
export const LANGUAGES = {
  en: { code: "en", htmlLang: "en", prefix: "", label: "English" },
  ms: { code: "ms", htmlLang: "ms", prefix: "ms", label: "Bahasa Melayu" },
  zh: { code: "zh", htmlLang: "zh-Hans", prefix: "zh", label: "简体中文" },
};

/** Languages that require a translation record. English is the original. */
export const TRANSLATED_LOCALES = ["ms", "zh"];

/**
 * The only statuses a translation may carry.
 *
 * `machine` = produced by a model, not read by a human. `draft` = being worked on.
 * `reviewed` = a named reviewer checked the numbers, the legal terms and the local idiom.
 * Only `reviewed` may produce a page, now or later - the gate is in the content schema.
 */
export const LOCALIZATION_STATUSES = ["machine", "draft", "reviewed"];
export const PUBLISHED_STATUSES = ["reviewed"];

export const isPublishable = (status) => PUBLISHED_STATUSES.includes(status);

/** `/ms`, `/zh`, or `""` for English. No trailing slash. */
export const localeRoot = (locale) => (locale === "en" ? "" : `/${locale}`);

const findCategory = (categories, englishSlug) => categories.find((c) => c.slug === englishSlug) ?? null;

/** The locale's own name for a category; falls back to English rather than inventing a translation. */
export function categoryLabel(categories, locale, englishSlug) {
  const cat = findCategory(categories, englishSlug);
  if (!cat) return englishSlug;
  return locale === "en" ? cat.label : cat.i18n?.[locale]?.label ?? cat.label;
}

/** The locale's own slug for a category. Returns null instead of guessing. */
export function categorySlug(categories, locale, englishSlug) {
  const cat = findCategory(categories, englishSlug);
  if (!cat) return null;
  return locale === "en" ? cat.slug : cat.i18n?.[locale]?.slug ?? null;
}

/** Resolve a localized slug back to the English one, or null. */
export function englishSlugFor(categories, locale, localizedSlug) {
  if (locale === "en") return categories.some((c) => c.slug === localizedSlug) ? localizedSlug : null;
  return categories.find((c) => c.i18n?.[locale]?.slug === localizedSlug)?.slug ?? null;
}

/** Every category, in the given language, ready to render or to route. */
export function localizedCategories(categories, locale) {
  return categories.map((c) => ({
    englishSlug: c.slug,
    slug: categorySlug(categories, locale, c.slug),
    label: categoryLabel(categories, locale, c.slug),
    description: c.description,
  }));
}

/**
 * The languages that genuinely have a reviewed version of one piece.
 *
 * @param {string} englishSlug the translationKey
 * @param {Array<{locale: string, translationKey: string, localizationStatus: string}>} records
 * @returns {string[]} locales, never including one whose record is unreviewed
 */
export function reviewedLocales(englishSlug, records) {
  return records
    .filter((r) => r.translationKey === englishSlug && isPublishable(r.localizationStatus))
    .map((r) => r.locale);
}

/** Article path for a locale. English keeps `/blog/`; the others are namespaced under the prefix. */
export function articlePath(locale, slug) {
  return locale === "en" ? `/blog/${slug}/` : `/${locale}/blog/${slug}/`;
}