#!/usr/bin/env node
/**
 * Atomization: turn each published article into its distribution units.
 *
 * ## The mechanism being copied, and the part that must not be copied
 *
 * The one-person benchmark writes one newsletter a week and derives twenty points, thirty lines
 * and fifty cards from it. His volume is on the distribution side, not the writing side, and the
 * reason that works is that a rewritten opinion cannot be wrong - only duller.
 *
 * This site's atoms are figures, and a figure can be wrong. So the derivation here is
 * deterministic and not a language model: an atom is a value, its unit, its period, its named
 * source, its retrieval date, and a link back to the article that publishes it. Every one of
 * those six fields already exists in the frontmatter and has already passed the gates. Nothing
 * is generated, nothing is paraphrased, and nothing new is asserted - the script re-serialises
 * what was verified.
 *
 * That constraint is the moat rather than a limitation. A competitor's content matrix publishes
 * rewritten versions of other people's claims; these are quotable down to the document and the
 * date, which is what makes them worth citing.
 *
 * ## What it is for
 *
 * 216 figures across 24 articles, plus 24 data points and 98 FAQ questions, are 338 units that
 * already exist and are currently reachable only by someone who visits the article. This emits
 * them in the two shapes the channels actually consume: a CSV for a scheduler or a spreadsheet,
 * and JSONL for a script.
 *
 * No LLM is called and no network request is made. Running it twice produces the same bytes.
 *
 * ## Usage
 *
 *   node tools/atomize.mjs                 report what would be produced
 *   node tools/atomize.mjs --emit          write data/atoms/figures.csv and .jsonl
 *   node tools/atomize.mjs --emit --kind=faq    include the FAQ questions as landing-page stubs
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BLOG = join(ROOT, "src", "content", "blog");
const OUT = join(ROOT, "data", "atoms");
const SITE = "https://landedmath.com";

const args = process.argv.slice(2);
const EMIT = args.includes("--emit");
const KINDS = args.filter((a) => a.startsWith("--kind=")).map((a) => a.slice(7));

/* ------------------------------------------------------------------ parse */

/**
 * Read the frontmatter of every published article.
 *
 * The `figures` block is a YAML sequence of six-field records, and the field order is not
 * guaranteed, so each record is collected by key rather than by position. A figure missing any
 * of the five required fields is reported rather than silently emitted: the five-tuple is the
 * site's core promise and an atom without it must not reach a channel.
 */
function readArticles() {
  const out = [];
  for (const f of readdirSync(BLOG).filter((x) => x.endsWith(".md"))) {
    const raw = readFileSync(join(BLOG, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
    if (/^draft:\s*true/m.test(fm)) continue;

    const slug = f.replace(/\.md$/, "");
    const scalar = (k) => new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm)?.[1]?.trim() ?? "";

    /* Figures: a sequence of records, each starting at "  - value:". */
    const figures = [];
    const block = /^figures:\s*\r?\n([\s\S]*?)(?=^\S|\Z)/m.exec(fm)?.[1] ?? "";
    for (const rec of block.split(/^\s{2}- value:/m).slice(1)) {
      const field = (k) => new RegExp(`^\\s{4}${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(rec)?.[1]?.trim() ?? "";
      figures.push({
        value: rec.split(/\r?\n/)[0].trim().replace(/^"|"$/g, ""),
        unit: field("unit"),
        period: field("period"),
        source: field("source"),
        retrieved: field("retrieved"),
      });
    }

    /* FAQ questions are headings under the FAQ section: each is a search intent. */
    const faqSection = /##\s*FAQ\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/.exec(raw)?.[1] ?? "";
    /*
     * Each question is paired with its answer here, where the article text is in scope.
     *
     * The pool previously held only the question heading, so a landing page could say what it was
     * about but not answer it, and the preflight's digit check failed on questions that legitimately
     * contain no number. Parsing the pair at read time keeps `raw` in the scope where it exists
     * instead of threading it through the emitter.
     */
    const faqs = [...faqSection.matchAll(/^###\s+(.+?)\s*\r?\n([\s\S]*?)(?=\r?\n###\s|\r?\n##\s|$)/gm)].map((m) => ({
      question: m[1].trim(),
      answer: m[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[#*`]/g, " ").replace(/\s+/g, " ").trim(),
    }));

    /*
     * The cost table as its own payload.
     *
     * Dev.to and SlideShare want the arithmetic, and until now nothing extracted it: the section
     * "## How we calculated this" holds the formula and the worked numbers in prose, and both
     * platforms were left with no material at all - the only two payload slots in the whole
     * specification that resolved to nothing.
     */
    const calcSection = /##\s*How we calculated this\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/.exec(raw)?.[1] ?? "";
    const calcFormula = [...calcSection.matchAll(/^```[a-z]*\r?\n([\s\S]*?)```$/gm)].map((m) => m[1].trim()).join("\n");
    const calcText = calcSection.replace(/```[\s\S]*?```/g, " ").replace(/[#*`]/g, " ").replace(/\s+/g, " ").trim();

    /*
     * The data point itself, not a pointer to it.
     *
     * The atom carried `Data point from <title>` as its text - a placeholder written when the
     * payload was first wired up and never replaced with the content. Nine platforms consume this
     * payload, and they were being handed a sentence that says where the data point is rather than
     * the data point. The n8n preflight's digit check caught it on three articles, which is how a
     * placeholder survives: it fails only where the title happens to contain no number.
     */
    const dataPointMatch = /##\s*The data point\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/.exec(raw)?.[1] ?? "";
    const dataPointText = dataPointMatch
      .replace(/<div[^>]*>/g, " ")
      .replace(/<\/div>/g, " ")
      .replace(/<span[^>]*>([\s\S]*?)<\/span>/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*`]/g, " ")
      /* The callout's own label, which sits inside the block once the tags are gone. */
      .replace(/^\s*(Data point|数据点)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    out.push({
      slug,
      number: Number(scalar("articleNumber")) || 0,
      title: scalar("title"),
      category: scalar("category"),
      audience: scalar("audience"),
      publishDate: scalar("publishDate"),
      keyword: scalar("target_keyword"),
      figures,
      faqs,
      calcFormula,
      calcText,
      dataPointText,
      hasDataPoint: /##\s*The data point/.test(raw),
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

const articles = readArticles();

/* ------------------------------------------------------------------ build */

const atoms = [];
const incomplete = [];

for (const a of articles) {
  const url = `${SITE}/blog/${a.slug}/`;
  const common = {
    articleNumber: a.number,
    articleSlug: a.slug,
    articleTitle: a.title,
    category: a.category,
    audience: a.audience,
    published: a.publishDate,
    url,
  };

  a.figures.forEach((f, i) => {
    const missing = ["value", "unit", "period", "source", "retrieved"].filter((k) => !f[k]);
    if (missing.length) {
      incomplete.push({ slug: a.slug, index: i + 1, missing, value: f.value });
      return;
    }
    /*
     * The atom text is assembled from the verified fields and nothing else. It is deliberately
     * the same sentence the article carries, because a re-worded figure is a new claim.
     */
    /*
     * The figure, split into the two shapes the channels actually consume.
     *
     * 83 of 216 figures carry a number in `value` and a whole clause in `unit` - "30 November
     * 2026" with "last day manual origin-data entry is accepted as a remedy". Those cannot fill a
     * one-number slot, and the seven platforms that want one number were competing for the 128
     * that could. A `headline` is what a card or a post shows; a `sentence` is what a platform
     * needing context shows. Emitting both makes each shape usable without touching the fields.
     */
    /*
     * Split `unit` into the measurement and the explanation.
     *
     * The five-tuple is built for verification, not for publication: `unit` holds whatever makes
     * the figure checkable, so it frequently carries a whole clause after the measurement -
     * "document types covered (RCEP certificates, back-to-back certificates, ACFTA certificates,
     * movement certificates)". Concatenating value and unit into a headline produced strings over
     * 90 characters on 70 of the 128 numeric figures, and a 280-character post then chopped them
     * to fragments like "US" and "base".
     *
     * `unitShort` is what a card or a post can show. `scope` is the explanation, which belongs in
     * the body or the sentence form. Nothing is discarded: both are emitted.
     */
    const MEASURE =
      /^((?:US |HK |NT |A?NZ)?\$|USD|US dollars?|dollars?|EUR|euros?|GBP|RMB|yuan|CNY|JPY|per cent|percent|percentage points?|basis points?|pp|times|days?|weeks?|months?|years?|hours?|minutes?|seconds?|tonnes?|tons?|kg|kilograms?|grams?|litres?|liters?|containers?|shipments?|items?|units?|products?|documents?|pages?|lines?|codes?|exclusions?|entries?|filings?|cases?|articles?|announcements?|subheadings?|parties?|countries?|markets?|orders?|parcels?|SKUs?|seats?)/i;
    const unitRaw = String(f.unit ?? "").trim();
    const measureMatch = MEASURE.exec(unitRaw);
    /*
     * The measurement is the matched head plus any immediately following prepositional phrase that
     * names what is measured - "percent Section 301 duty on List 4A" keeps its scope because the
     * words after "percent" are part of the unit's identity, not an aside.
     */
    let unitShort;
    let scope;
    if (measureMatch) {
      const head = measureMatch[1];
      const rest = unitRaw.slice(head.length);
      /* A short rest that reads as part of the label stays; a long one becomes scope. */
      if (rest.length <= 32) {
        unitShort = unitRaw;
        scope = "";
      } else {
        /*
         * Cut at the earliest aside marker, and put the marker itself in the scope.
         *
         * An earlier version searched for a marker, then sliced the front by a fixed length and by
         * the length of the kept text - and the two lengths disagreed by one, so the scope began
         * with the last letter of the text that had been kept ("scope: d (RCEP certificates…)")
         * and the headline ended one character early ("14 solar manufacturing equipmen"). The
         * repair is to find one index and cut on it twice, so the two halves are exact complements.
         */
        const cut = rest.search(/\s-\s|—|\(|, which|, and | that | for the | in the /);
        const keep = cut >= 0 ? rest.slice(0, cut).trim() : rest.trim();
        unitShort = (head + (keep ? " " + keep : "")).replace(/[,\s]+$/, "");
        scope = cut >= 0 ? rest.slice(cut).replace(/^[\s,]+/, "").replace(/^[—–-]\s*/, "").replace(/\)$/, "").trim() : "";
      }
    } else if (unitRaw.length <= 32) {
      unitShort = unitRaw;
      scope = "";
    } else {
      /* No recognised measure: cut at the first aside marker, keeping both halves exact. */
      const cut = unitRaw.search(/\s-\s|—|\(|, which|, and | that /);
      unitShort = (cut > 8 ? unitRaw.slice(0, cut) : unitRaw.slice(0, 28)).replace(/[,\s]+$/, "");
      scope = cut > 8 ? unitRaw.slice(cut).replace(/^[\s,]+/, "").replace(/^[—–-]\s*/, "").replace(/\)$/, "").trim() : "";
    }

    const looksNumeric = /^[$€£¥]?\s?-?[\d][\d,.]*/.test(f.value);
    /*
     * Do not append a unit the value already contains.
     *
     * Some values are long enough to carry their own unit - "45 days the guarantee is tied up in
     * the worked example" opens with "45 days" while the unit field also begins "days", so joining
     * them produced the same words twice and the post showed a stray fragment on its second line.
     */
    const valueHasUnit = unitShort && new RegExp(`\\b${unitShort.split(" ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(String(f.value));
    const headlineText = looksNumeric && unitShort && !valueHasUnit ? `${f.value} ${unitShort}` : String(f.value);

    atoms.push({
      ...common,
      kind: "figure",
      ref: `#f${i + 1}`,
      text: `${f.value} ${f.unit} — ${f.period}. Source: ${f.source}. Retrieved ${f.retrieved}.`,
      headline: headlineText,
      sentence: scope
        ? `${f.value}${valueHasUnit ? "" : " " + unitShort} — ${scope}. ${f.period}.`
        : `${f.value}${valueHasUnit || !unitShort ? "" : " " + unitShort}. ${f.period}.`,
      unitShort,
      scope,
      shape: looksNumeric && unitShort.length <= 45 ? "number" : "note",
      value: f.value,
      unit: f.unit,
      period: f.period,
      source: f.source,
      retrieved: f.retrieved,
      canonical: url,
    });
  });

  if (a.hasDataPoint) {
    /*
     * The retrieval date for a derived atom.
     *
     * A data point, an FAQ question and the calculation section are all derived from the article
     * rather than from a single document, so none of them had a retrieval date of their own - and
     * the n8n preflight rejects any piece without one, which held back fourteen of the twenty-two
     * platforms, not the three the task assumed.
     *
     * The honest date for a derived atom is the newest retrieval date among the article's own
     * figures: that is the moment its inputs were last checked against their sources, and it is the
     * same date the sitemap carries for the article.
     */
    const articleRetrieved = a.figures.map((f) => f.retrieved).filter(Boolean).sort().at(-1) ?? "";

    atoms.push({
      ...common,
      kind: "data-point",
      ref: "#the-data-point",
      text: a.dataPointText || `Data point from ${a.title}`,
      retrieved: articleRetrieved,
      canonical: `${url}#the-data-point`,
    });
  }

  if (KINDS.includes("faq")) {
    /* The same derived retrieval date the data point uses: newest among the article's figures. */
    const faqRetrieved = a.figures.map((f) => f.retrieved).filter(Boolean).sort().at(-1) ?? "";
    for (const q of a.faqs) {
      atoms.push({
        ...common,
        kind: "faq",
        ref: "#faq",
        text: q.question,
        answer: q.answer,
        retrieved: faqRetrieved,
        canonical: url,
        note: "one landing page per question — an independent search intent",
      });
    }
  }

  /* The arithmetic, as its own atom, for the platforms that consume a formula. */
  if (a.calcFormula || a.calcText) {
    const calcRetrieved = a.figures.map((f) => f.retrieved).filter(Boolean).sort().at(-1) ?? "";
    atoms.push({
      ...common,
      kind: "cost-table",
      ref: "#how-we-calculated-this",
      text: a.calcFormula || a.calcText,
      formula: a.calcFormula,
      retrieved: calcRetrieved,
      note: a.calcText.slice(0, 200),
      canonical: `${url}#how-we-calculated-this`,
    });
  }
}

/* ------------------------------------------------------------------ report */

const byKind = {};
for (const a of atoms) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

console.log("ATOMIZATION\n" + "=".repeat(74));
console.log(`  articles parsed   : ${articles.length}`);
console.log(`  figures found     : ${articles.reduce((n, a) => n + a.figures.length, 0)}`);
console.log(`  atoms built       : ${atoms.length}`);
for (const [k, v] of Object.entries(byKind).sort()) console.log(`     ${k.padEnd(12)} ${v}`);
console.log(`  distinct sources  : ${new Set(atoms.filter((a) => a.source).map((a) => a.source)).size}`);

if (incomplete.length) {
  console.log(`\n  INCOMPLETE FIGURES (not emitted — the five-tuple is incomplete): ${incomplete.length}`);
  for (const x of incomplete.slice(0, 8)) console.log(`     ${x.slug} #${x.index} missing ${x.missing.join(", ")}`);
}

console.log("\n  SAMPLE ATOMS\n" + "=".repeat(74));
for (const a of atoms.slice(0, 3)) {
  console.log(`  [${a.kind}] #${a.articleNumber} ${a.ref}`);
  console.log(`     ${a.text.slice(0, 150)}`);
  console.log(`     ${a.canonical}`);
}

/*
 * Every atom must point back at the article that publishes it. An atom without a canonical URL
 * is a quote with no source, which is the one thing this site does not publish.
 */
const noUrl = atoms.filter((a) => !a.canonical).length;
console.log(`\n  atoms without a canonical URL: ${noUrl}${noUrl ? "  <- must be zero" : ""}`);

/* ------------------------------------------------------------------ emit */

if (!EMIT) {
  console.log(`\n  --emit not passed: nothing written.`);
  console.log(`  would write  data/atoms/figures.csv  and  data/atoms/figures.jsonl`);
  process.exit(noUrl === 0 ? 0 : 1);
}

mkdirSync(OUT, { recursive: true });
const tsvSafe = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();

/*
 * The column set is the contract with tools/render.mjs, and it must carry every field a renderer
 * needs to build a platform-native piece. The first version of this header omitted four of them -
 * article_title, value, unit and period - so the renderer read undefined for the number it was
 * rendering and produced 216 pieces whose first line was "undefined undefined". The JSONL had all
 * of them and the TSV did not, which is why the defect survived the atomizer's own checks: the
 * five-tuple was intact, and the missing fields were the ones the report did not print.
 */
const HEAD = [
  "kind",
  "article_number",
  "article_slug",
  "article_title",
  "category",
  "audience",
  "published",
  "shape",
  "headline",
  "sentence",
  "unit_short",
  "scope",
  "value",
  "unit",
  "period",
  "text",
  "answer",
  "source",
  "retrieved",
  "canonical",
];
const csv = [
  HEAD.join("\t"),
  ...atoms.map((a) =>
    [
      a.kind,
      a.articleNumber,
      a.articleSlug,
      a.articleTitle,
      a.category,
      a.audience,
      a.published,
      a.shape ?? "",
      a.headline ?? "",
      a.sentence ?? "",
      a.unitShort ?? "",
      a.scope ?? "",
      a.value ?? "",
      a.unit ?? "",
      a.period ?? "",
      a.text,
      a.answer ?? "",
      a.source ?? "",
      a.retrieved ?? "",
      a.canonical,
    ]
      .map(tsvSafe)
      .join("\t"),
  ),
].join("\n");

writeFileSync(join(OUT, "figures.tsv"), csv + "\n", "utf8");
writeFileSync(join(OUT, "figures.jsonl"), atoms.map((a) => JSON.stringify(a)).join("\n") + "\n", "utf8");

const bytes = (p) => (existsSync(p) ? readFileSync(p).length : 0);
console.log(`\n  wrote  data/atoms/figures.tsv    ${(bytes(join(OUT, "figures.tsv")) / 1024).toFixed(1)} KB`);
console.log(`  wrote  data/atoms/figures.jsonl  ${(bytes(join(OUT, "figures.jsonl")) / 1024).toFixed(1)} KB`);

/*
 * A single JSON array, for the orchestrator.
 *
 * n8n reads files but cannot run the atomizer, so the pool has to be available in a shape its Code
 * node can parse in one call. TSV and JSONL are the right formats for the renderers; this is the
 * right format for a workflow tool.
 */
const flat = atoms.map((a) => ({
  kind: a.kind,
  articleNumber: a.articleNumber,
  articleSlug: a.articleSlug,
  articleTitle: a.articleTitle,
  category: a.category,
  audience: a.audience,
  published: a.published,
  shape: a.shape ?? "",
  headline: a.headline ?? "",
  sentence: a.sentence ?? "",
  unitShort: a.unitShort ?? "",
  scope: a.scope ?? "",
  value: a.value ?? "",
  unit: a.unit ?? "",
  period: a.period ?? "",
  text: a.text,
  answer: a.answer ?? "",
  source: a.source ?? "",
  retrieved: a.retrieved ?? "",
  canonical: a.canonical,
}));
writeFileSync(join(OUT, "atoms.json"), JSON.stringify(flat, null, 1), "utf8");
console.log(`  wrote  data/atoms/atoms.json     ${(bytes(join(OUT, "atoms.json")) / 1024).toFixed(1)} KB  (for n8n)`);
console.log(`  ${atoms.length} atoms, each carrying its source, its retrieval date and a link back.`);
process.exit(noUrl === 0 ? 0 : 1);
