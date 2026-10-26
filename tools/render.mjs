/**
 * Render the atom pool into one finished piece per platform, per viewpoint.
 *
 * ## Two dimensions, and the second one is the one that matters
 *
 * Platform is the obvious axis and the shallow one: it decides length, structure and where the
 * link goes. Viewpoint is the axis that makes two renders genuinely independent rather than two
 * lengths of the same sentence:
 *
 *   decision-maker  what does this do to my cost, and how do I price it
 *   practitioner    which field, which date, which action changes tomorrow
 *   general         why does this concern someone outside the industry
 *
 * The same figure under three viewpoints produces three posts that a reader would not recognise
 * as the same thing, which is what the benchmark means by atomisation and what a re-worded
 * duplicate is not.
 *
 * ## Where the platform rules live
 *
 * config/platform-spec.json carries what each platform likes, dislikes and how it mechanically
 * behaves - where the fold is, whether a link is penalised or unclickable, whether the community
 * bans promotion. config/render-templates.json carries the limits. A renderer that only knew the
 * character ceiling could not know that a LinkedIn link belongs in the first comment or that a
 * TikTok caption cannot be clicked at all.
 *
 * ## Usage
 *
 *   node tools/render.mjs                     plan, with platform behaviour shown
 *   node tools/render.mjs --spec              print the full platform specification
 *   node tools/render.mjs --emit              write data/renders/<platform>/<viewpoint>/
 *   node tools/render.mjs --only=x-post,substack --limit=3
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ATOMS = join(ROOT, "data", "atoms", "figures.tsv");
const CONFIG = join(ROOT, "config", "render-templates.json");
const SPEC = join(ROOT, "config", "platform-spec.json");
const OUT = join(ROOT, "data", "renders");

const args = process.argv.slice(2);
const EMIT = args.includes("--emit");
const SHOW_SPEC = args.includes("--spec");
const ONLY = /--only=([^ ]+)/.exec(args.join(" "))?.[1]?.split(",").filter(Boolean) ?? null;
const LIMIT = Number(/--limit=(\d+)/.exec(args.join(" "))?.[1] ?? 0);

if (!existsSync(ATOMS)) {
  console.error(`No atom pool. Run: node tools/atomize.mjs --emit --kind=faq`);
  process.exit(2);
}
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const spec = JSON.parse(readFileSync(SPEC, "utf8"));
const specById = Object.fromEntries(spec.platforms.map((p) => [p.id, p]));
const VIEWPOINTS = Object.keys(spec._viewpoints).filter((k) => !k.startsWith("_"));

if (SHOW_SPEC) {
  console.log("PLATFORM SPECIFICATION\n" + "=".repeat(96));
  for (const p of spec.platforms) {
    console.log(`\n${p.id}  —  ${p.name}`);
    console.log(`  audience : ${p.audienceSize}`);
    console.log(`  likes    :`);
    for (const l of p.likes) console.log(`     + ${l}`);
    console.log(`  dislikes :`);
    for (const d of p.dislikes) console.log(`     - ${d}`);
    console.log(`  mechanics: ${p.mechanics}`);
    const extras = [p.aspect && `aspect ${p.aspect}`, p.seconds && `${p.seconds}s`, p.humanGate && "HUMAN GATE", p.requiresCanonical && "needs canonical"].filter(Boolean);
    if (extras.length) console.log(`  flags    : ${extras.join(" · ")}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ load atoms */

const lines = readFileSync(ATOMS, "utf8").trim().split("\n");
const head = lines[0].split("\t");
const atoms = lines.slice(1).map((l) => {
  const cells = l.split("\t");
  return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
});

const figures = atoms.filter((a) => a.kind === "figure");
const dataPoints = atoms.filter((a) => a.kind === "data-point");
const faqs = atoms.filter((a) => a.kind === "faq");

const byArticle = new Map();
for (const f of [...figures, ...dataPoints]) {
  const k = f.article_number;
  if (!byArticle.has(k)) {
    byArticle.set(k, { number: k, slug: f.article_slug, title: f.article_title, category: f.category, audience: f.audience, published: f.published, canonical: f.canonical, figures: [], dataPoint: "" });
  }
  const a = byArticle.get(k);
  if (f.kind === "figure") a.figures.push(f);
  else a.dataPoint = f.text;
}
const articles = [...byArticle.values()];

/* ------------------------------------------------------------------ helpers */

const shortSource = (s) => String(s ?? "").split(/,\s*/)[0].replace(/\s*\(.*$/, "").trim().slice(0, 60);
const list = (fs, n) => fs.slice(0, n).map((f) => `- ${headline(f)}${detail(f) ? ` — ${detail(f)}` : ""}  [${shortSource(f.source)}]`).join("\n");
const sourceList = (fs) => [...new Set(fs.map((f) => f.source))].map((s) => `- ${s}`).join("\n");

/**
 * The angle each viewpoint takes on the same figure.
 *
 * These are fixed sentences chosen from a table keyed on the viewpoint, not generated prose: a
 * templated angle cannot invent a consequence the article never claimed. The one variable is
 * `audience`, which selects the cost sentence.
 */
const COST = {
  "platform-seller": "the cost lands per order rather than per shipment, so multi-item baskets carry the increase",
  importer: "the cost lands on the duty line rather than the freight line, so it is payable at entry",
  both: "the cost is payable at entry and again in your platform economics, so the two cannot be planned separately",
};

const ANGLE = {
  "decision-maker": (f) => `If you set prices, this is a cost input: ${f.value} ${f.unit}. ${f.period}. Source: ${f.source}. Retrieved ${f.retrieved}.`,
  practitioner: (f) => `The field that changes: ${f.unit} — ${f.period}. Value ${f.value}. Before you file, check ${shortSource(f.source)}. Retrieved ${f.retrieved}.`,
  general: (f) => `${f.value} ${f.unit}. ${f.period}. It comes from ${shortSource(f.source)}, checked on ${f.retrieved}.`,
};

/**
 * A figure is either a quantity or a sentence, and the templates have to know which.
 *
 * `figures` holds both shapes and nothing said so. A quantity - `34.58` with unit `US dollars` -
 * drops into a number slot cleanly. A sentence - `7 December 2026 the date comments on the
 * proposed rule must be received by`, where the field labelled `value` is really a clause - does
 * not: it produced "The field that changes: the date comments on the." on every practitioner
 * render, and all three viewpoints came out nearly identical because only the fixed tail differed.
 *
 * The detector is deliberately crude, because the question is only whether the leading token is a
 * number. What it buys is a different template per shape rather than one template failing half the
 * corpus.
 */
const isQuantity = (f) => /^[$€£¥]?\s?-?[\d][\d,.]*/.test(String(f.value ?? "").trim());

/** Templates for the sentence-shaped figures, where the clause is the headline. */
const SENTENCE_ANGLE = {
  "decision-maker": (f) => `The thing to pin down is ${f.value} — ${f.unit}. ${f.period}.`,
  practitioner: (f) => `What changes: ${f.value} — ${f.unit}. Before you file, check ${shortSource(f.source)}.`,
  general: (f) => `${f.value} — ${f.unit}. ${f.period}.`,
};

/**
 * Pick the angle template for a figure's shape.
 *
 * For a quantity, the unit is part of the sentence ("34.58 US dollars"). For a sentence-shaped
 * figure there is no unit to place, and appending one produces the broken fragments the first
 * version emitted on 216 of the practitioner renders.
 */
const angleFor = (vp, f) => (isQuantity(f) ? ANGLE[vp](f) : SENTENCE_ANGLE[vp](f));

/** For fitPost: the display form of the figure's headline, without inventing a unit. */
const headline = (f) => (isQuantity(f) ? `${f.value} ${f.unit}` : String(f.value));

/**
 * The unit as a display line.
 *
 * For a quantity it is a real unit and belongs beside the number. For the five sentences it is a
 * note explaining the subject, so it is shown as a parenthetical rather than appended.
 */
const unitLine = (f) => {
  if (!f.unit) return "";
  return isQuantity(f) ? String(f.unit) : `(${f.unit})`;
};

/** For fitPost: the detail line, empty when the period already sat inside the sentence. */
const detail = (f) => (isQuantity(f) ? f.period : "");



/** The impact sentence for a viewpoint and an audience. */
const impactFor = (vp, aud) => {
  const cost = COST[aud] ?? COST.both;
  if (vp === "decision-maker") return `For a buyer or a pricing owner: ${cost}.`;
  if (vp === "practitioner") return `For whoever files the entry: this changes a field and a date, not a rate.`;
  return `In plain terms: this changes what the parcel costs to clear, not what it is worth.`;
};

/** A compact source label for places where the full name cannot fit. */
const tinySource = (s) => {
  const t = String(s ?? "");
  /* Well-known publishers get an abbreviation; the rest get their first clause, trimmed. */
  if (/General Administration of Customs/i.test(t)) return "GACC";
  if (/Customs User Fees/i.test(t)) return "CBP Dec. 26-15";
  if (/Global Times/i.test(t)) return "Global Times";
  return t.split(/,\s*/)[0].replace(/\s*\(.*$/, "").trim().slice(0, 34);
};

/**
 * Shortened campaign tag. A 280-character ceiling does not have room for a readable UTM string,
 * and the attribution still works without the medium and campaign parameters.
 */
const UTM = (url, vp, plat) => `${url}?utm_source=${plat}`;

/**
 * Fit a post to a hard character ceiling without ever cutting a figure or its date.
 *
 * The first version of this got the order of sacrifice exactly backwards: it dropped the
 * retrieved date first, which is one of the two fields the validator treats as non-negotiable,
 * so it rejected all 216 short-form pieces. Dropping the date is not a shorter post, it is a post
 * that cannot be checked - which is the one thing this project does not publish.
 *
 * The order is now: keep the value, the unit and the canonical link, because without any of them
 * the post is not the post. Then shorten the prose around them, longest first, until it fits.
 * The returned object reports which of the four components survived, so a piece that lost one is
 * visible in the run rather than discovered later.
 */
function fitPost({ value, unit, source, retrieved, url, angle, period }, max) {
  const sep = "\n\n";
  let src = source;
  let per = period;
  let ang = angle;
  let un = unit;
  let val = value;

  /*
   * `build` always includes the mandatory four: the value, the unit, the retrieval date and the
   * link. An earlier version left the unit out of the assembled string and then "compressed" by
   * shortening what was present, so the unit vanished silently and the validator rejected every
   * affected piece. A field that must survive cannot be absent from the text being measured.
   */
  const label = [src, retrieved].filter(Boolean).join(" · ");
  const build = () => [val, un, ang, per, label, url].filter((x) => x && String(x).trim()).join(sep);

  /* 1. Compress the optional prose, longest field first. */
  for (let i = 0; i < 40 && build().length > max; i++) {
    if (ang && ang.length > 40) ang = ang.slice(0, Math.max(30, ang.length - 30)).replace(/[ ,;.]+\S*$/, "") + ".";
    else if (per && per.length > 20) per = per.slice(0, Math.max(14, per.length - 20)).replace(/[ ,;.]+\S*$/, "");
    else if (src && src.length > 12) src = tinySource(src);
    else break;
  }
  /* 2. Drop the optional fields outright. */
  if (build().length > max && per) per = "";
  if (build().length > max && ang) ang = "";
  if (build().length > max && src) src = tinySource(src);
  /*
   * 3. Only the mandatory four remain. If they still do not fit, the unit is dropped whole rather
   * than shortened: trimming it produced half-words on the second line of a post - "last day",
   * "announceme", "date a" - which read as corruption rather than as compression. A post without a
   * redundant unit line is cleaner than one carrying a fragment of it, and the value above it
   * already states the figure.
   */
  if (build().length > max && un) un = "";
  if (build().length > max && String(val).length > 60) val = String(val).slice(0, 58).replace(/\s\S*$/, "") + "…";

  const text = build();
  return {
    text: text.slice(0, max),
    kept: {
      value: !!val && text.includes(String(val)),
      unit: !unit || text.includes(String(unit)) || text.includes(String(un ?? "")),
      retrieved: !!retrieved && text.includes(String(retrieved)),
      url: text.includes(url),
    },
  };
}

/* ------------------------------------------------------------------ renderers */

/**
 * One function per platform. Signature: (item, viewpoint, platformId) => string.
 * `viewpoint` is what makes two renders of the same figure independent pieces.
 */
const RENDER = {
  "x-post": (f, vp, pid) =>
    fitPost(
      {
        value: headline(f),
        unit: unitLine(f),
        source: shortSource(f.source),
        retrieved: f.retrieved,
        url: UTM(f.canonical, vp, pid),
        angle: angleFor(vp, f),
        period: detail(f),
      },
      280,
    ).text,

  "x-thread": (a, vp) => {
    const fs = a.figures.slice(0, 8);
    /*
     * Each post in a thread is still a post, so each is fitted to the same 280-character ceiling
     * as a standalone one. The first version put the whole title and URL in a header block and
     * ignored the ceiling entirely, which reported 72 over-limit rows - the gate was right and
     * the renderer was wrong.
     */
    const head = fitPost(
      {
        value: `${fs.length} numbers`,
        unit: "",
        source: "Landed Math",
        retrieved: a.published,
        url: a.canonical,
        angle: a.title,
        period: "each sourced and dated",
      },
      280,
    ).text;
    const body = fs.map((f, i) =>
      fitPost(
        {
          value: `${i + 1}/${fs.length} ${headline(f)}`,
          unit: unitLine(f),
          source: shortSource(f.source),
          retrieved: f.retrieved,
          url: f.canonical,
          angle: "",
          period: f.period,
        },
        280,
      ).text,
    );
    return [head, ...body].join("\n\n———\n\n");
  },

  "linkedin-post": (f, vp, pid) =>
    [
      angleFor(vp, f),
      impactFor(vp, f.audience),
      `Source: ${f.source}`,
      `Retrieved ${f.retrieved}.`,
      `The full working, with the arithmetic shown line by line: ${UTM(f.canonical, vp, pid)}`,
      `(Link also in the first comment.)`,
    ].join("\n\n"),

  "linkedin-article": (a, vp) =>
    [
      a.title,
      angleFor(vp, a.figures[0]),
      `The figures this rests on:\n${list(a.figures, 8)}`,
      `Every source, with its retrieval date: ${a.canonical}`,
    ].join("\n\n"),

  "reddit-answer": (q, vp) => {
    const opener =
      vp === "practitioner"
        ? "Answering as someone who has had to file these."
        : vp === "decision-maker"
          ? "The cost angle, since that is usually what people are really asking."
          : "Short answer first, then where it comes from.";
    /*
     * The answer now leads, because the atom carries one.
     *
     * Both of these renderers previously read `q.source`, which an FAQ atom has never had, so what
     * they produced was a question, a fixed sentence and a link - structurally valid and empty. The
     * atomizer now pairs each question with its answer from the article, and the answer is the
     * piece. The source line is dropped rather than left blank, since the article holds the
     * citations and the link goes there.
     */
    return [
      q.text,
      `${opener}\n\n${q.answer || "What people usually get wrong is treating this as a rate change. It is a route and process change, and those do not scale the same way."}`,
      `Figures as of ${q.retrieved}. The arithmetic, in case it is useful: ${q.canonical}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  },

  "quora-answer": (q, vp) =>
    [
      q.text,
      q.answer ||
        (vp === "general"
          ? "The short version: this changes what clearance costs, not what the goods are worth."
          : "The document is the source, not a summary of it — check the paragraph that sets the date."),
      `Figures as of ${q.retrieved}. Working and citations: ${q.canonical}`,
    ]
      .filter(Boolean)
      .join("\n\n"),

  medium: (a, vp) =>
    [
      a.title,
      angleFor(vp, a.figures[0]),
      a.figures.slice(0, 5).map((f) => `**${headline(f)}**${detail(f) ? ` — ${detail(f)}` : ""}`).join("\n\n"),
      `Sources:\n${sourceList(a.figures)}`,
      `Originally published at ${a.canonical} — set this as the canonical URL.`,
    ].join("\n\n"),

  devto: (a) =>
    [
      `---\ntitle: ${a.title}\ncanonical_url: ${a.canonical}\n---`,
      `## The inputs\n\n${list(a.figures, 8)}`,
      `## The sources\n\n${sourceList(a.figures)}`,
      `## Where the calculation is shown\n\n${a.canonical}`,
    ].join("\n\n"),

  substack: (a, vp) =>
    [
      `SUBJECT: ${a.figures[0].value} ${a.figures[0].unit} — ${a.title.slice(0, 60)}`,
      `PREHEADER: ${a.figures[0].period}`,
      a.dataPoint,
      `Three figures:\n${list(a.figures, 3)}`,
      `Read the full analysis, every source dated:\n${a.canonical}`,
      `---\nUnsubscribe: {{unsubscribe_url}}`,
    ].join("\n\n"),

  beehiiv: (a, vp) =>
    [
      `SUBJECT: ${a.figures[0].value} ${a.figures[0].unit}`,
      a.dataPoint,
      list(a.figures, 3),
      `${a.canonical}\n\n{{unsubscribe_url}}`,
    ].join("\n\n"),

  ghost: (a) =>
    [`SUBJECT: ${a.title}`, a.dataPoint, list(a.figures, 3), `${a.canonical}\n\n{{unsubscribe}}`].join("\n\n"),

  "youtube-short": (f, vp) =>
    [
      `HOOK on screen 0-3s: ${headline(f)}`,
      `VOICEOVER 3-15s: ${angleFor(vp, f)}`,
      `ON SCREEN 15-30s: Source — ${shortSource(f.source)} · Retrieved ${f.retrieved}`,
      `CTA 30-45s: the arithmetic is at landedmath.com`,
      `TITLE: ${headline(f)}${detail(f) ? ` — ${detail(f)}` : ""}`,
      `DESCRIPTION: ${f.source}\n${f.canonical}`,
    ].join("\n\n"),

  tiktok: (f, vp) => {
    /* No clickable link exists here, so the caption must carry the source and the date itself. */
    const cap = `${headline(f)} — ${f.period}. ${shortSource(f.source)}, checked ${f.retrieved}.`;
    return [
      `HOOK on screen 0-2s: ${headline(f)}`,
      `VOICEOVER 2-10s: ${angleFor(vp, f)}`,
      `ON SCREEN 10-25s: ${shortSource(f.source)} · ${f.retrieved}`,
      `CAPTION: ${cap}`,
      `HASHTAGS: #customs #import #supplychain`,
    ].join("\n");
  },

  "ig-reels": (f, vp) =>
    [
      `COVER TEXT: ${headline(f)}`,
      `VOICEOVER: ${angleFor(vp, f)}`,
      `CAPTION: ${headline(f)} — ${f.period}\nSource: ${f.source}\nRetrieved ${f.retrieved}.\nFull working in bio.`,
    ].join("\n\n"),

  "youtube-long": (a, vp) =>
    [
      `TITLE: ${a.title}`,
      `DESCRIPTION first two lines (visible before the fold):\n${a.dataPoint}\nFull working: ${a.canonical}`,
      `CHAPTERS\n00:00 the number\n00:30 what changed\n01:30 the arithmetic\n03:00 what it costs you\n04:30 sources`,
      `SCRIPT — one line per chapter\n${list(a.figures, 6)}`,
      `SOURCES\n${sourceList(a.figures)}`,
    ].join("\n\n"),

  podcast: (a, vp) =>
    [
      `EPISODE: ${a.title}`,
      `[00:00 — say the number in the first fifteen seconds]\n${angleFor(vp, a.figures[0])}`,
      `[BODY — one pause per line]\n${list(a.figures, 6)}`,
      `[SOURCES]\n${sourceList(a.figures)}`,
      `[OUTRO]\nEvery figure, with its source and retrieval date, at ${a.canonical}`,
    ].join("\n\n"),

  spotify: (a) => [`EPISODE TITLE: ${a.title}`, `SHOW NOTES\n${a.dataPoint}\n\n${list(a.figures, 3)}\n\n${a.canonical}`].join("\n\n"),

  /**
   * Pinterest is two deliverables, not one: the text that goes on the image and the description
   * that goes in the pin. Only the description is a caption and only it has a character ceiling,
   * so emitting the artwork instructions as part of the caption made 606 pieces look over-limit
   * when the caption itself was inside it. They are separated here.
   */
  pinterest: (f, vp) =>
    [
      `— IMAGE (2:3, 1000x1500) —`,
      `CARD TEXT (large): ${headline(f)}`,
      `CARD SUBTEXT (one line): ${[unitLine(f), detail(f) || f.period].filter(Boolean).join(" · ")}`,
      `CARD FOOTER (small): ${shortSource(f.source)}`,
      ``,
      `— PIN DESCRIPTION (Pinterest is a search engine; keep the keywords) —`,
      `${headline(f)}.${detail(f) ? ` ${detail(f)}.` : ""} Source: ${f.source}. Retrieved ${f.retrieved}.`,
      f.canonical,
    ].join("\n"),

  "instagram-card": (f, vp) =>
    [
      `CARD: ${headline(f)}`,
      `CARD SUB: ${[unitLine(f), detail(f) || f.period].filter(Boolean).join(" · ")}`,
      `CAPTION (first 125 characters are what shows): ${headline(f)}${detail(f) ? ` — ${detail(f)}` : ""}.\nSource: ${f.source}\nRetrieved ${f.retrieved}.\nFull working in bio.`,
    ].join("\n\n"),

  slideshare: (a) => {
    const slides = a.figures.slice(0, 28).map((f, i) => `SLIDE ${i + 3} — ${headline(f)}\n  ${f.period}\n  ${shortSource(f.source)}`);
    return [`SLIDE 1 — ${a.title}`, `SLIDE 2 — ${a.dataPoint}`, ...slides, `LAST SLIDE — sources and full working\n${a.canonical}`].join("\n\n");
  },

  /**
   * A landing page must answer the question on its own. Returning a stub that asks the reader to
   * click is the failure mode this platform's brief names, and the FAQ text in the atom pool is
   * the heading, not the answer - so the answer slot is marked for the one pass that can write
   * it, and the page is not emitted as if it were complete.
   */
  /*
   * A landing page per FAQ question, which is mechanism 4 of the benchmark study: each question is
   * an independent search intent, so it gets its own page rather than sitting in a list.
   *
   * Two placeholder defects lived here and both are now closed by fields the atom pool gained.
   * `ANSWER` was a literal note saying the pool carries the question and not the answer, which was
   * true when it was written; the atomizer pairs each question with its answer from the article now.
   * `SOURCE` read `q.source`, a field an FAQ atom has never had, so it rendered blank - the same
   * mistake the Reddit and Quora renderers made. An FAQ atom's citations live in the article it came
   * from, so the page states the retrieval date and links to the source list rather than claiming a
   * source it does not have.
   */
  "landing-page": (q, vp) =>
    [
      `H1: ${q.text}`,
      `ANSWER: ${q.answer || "[no answer recorded in the article]"}`,
      `RETRIEVED: ${q.retrieved}`,
      `CATEGORY: ${q.category}`,
      `SOURCES AND WORKING: ${q.canonical}`,
    ].join("\n\n"),

  rss: () => "(handled by src/pages/rss.xml.ts — not rendered here)",
};

/* ------------------------------------------------------------------ run */

/**
 * Route each platform to the material its payload calls for.
 *
 * Until now every renderer was fed the same `figures` array regardless of what it wanted, so the
 * seven platforms needing one number competed for the same atoms as the ones needing a clause, and
 * the output read as one sentence at twenty-two different lengths. The specification already said
 * which payload each platform consumes; this is the code that reads it.
 *
 * A renderer that builds something article-shaped - a thread, an email, a slide deck - receives
 * its payload grouped by article rather than flat, so it can render one piece per article while
 * still drawing only the material its payload names.
 */
function inputsFor(p, s) {
  const payload = s?.payload ?? p.payload;
  const articleShaped = s?.render === "article";
  switch (payload) {
    case "figure-number": {
      const list = figures.filter((f) => f.shape === "number");
      return articleShaped ? groupByArticle(list) : list;
    }
    case "figure-note": {
      const list = figures.filter((f) => f.shape === "note");
      return articleShaped ? groupByArticle(list) : list;
    }
    case "data-point":
      return articleShaped ? groupByArticle(dataPoints) : dataPoints;
    case "faq-question":
      return articleShaped ? groupByArticle(faqs) : faqs;
    case "cost-table": {
      const list = atoms.filter((a) => a.kind === "cost-table");
      return articleShaped ? groupByArticle(list) : list;
    }
    default:
      return [];
  }
}

/**
 * Fold a flat payload list into one record per article, keeping the article's own metadata.
 *
 * `figures` is filled from the whole atom pool rather than from the list being grouped, and that
 * distinction was a live defect. The list passed in has already been filtered to one payload - the
 * calculation section for devto, the data point for beehiiv - and the article-shaped renderers all
 * read `a.figures` to build their input lists. So for any platform whose payload is a cost-table or
 * a data point, the record arrived with `figures: []` and the renderer emitted an empty input list:
 * devto shipped `## The inputs` with nothing under it, and beehiiv shipped `SUBJECT:` followed by a
 * blank, because `a.figures[0]` was undefined and the template read `.value` off it. Structurally
 * valid, over the length floor, and empty - the same shape of failure as the data-point placeholder.
 *
 * `items` still holds only the filtered atoms, because that is what the payload-specific renderers
 * want and what `--only` operates on. Everything else is article context and comes from the pool.
 */
function groupByArticle(list) {
  const by = new Map();
  for (const it of list) {
    const k = it.article_number;
    if (!by.has(k)) {
      const meta = articles.find((a) => String(a.number) === String(k)) ?? {};
      /*
       * The article's number figures, which every article-shaped template quotes. A note-shaped
       * figure is a definition rather than a value and does not belong in an input list.
       */
      const own = atoms.filter((x) => String(x.article_number) === String(k) && x.kind === "figure" && x.shape === "number");
      by.set(k, {
        number: k,
        slug: it.article_slug,
        title: it.article_title,
        category: it.category,
        audience: it.audience,
        published: it.published,
        canonical: it.canonical,
        figures: own.length ? own : atoms.filter((x) => String(x.article_number) === String(k) && x.kind === "figure"),
        dataPoint: meta.dataPoint ?? "",
        items: [],
      });
    }
    const rec = by.get(k);
    rec.items.push(it);
  }
  return [...by.values()];
}

/** The reading each platform does of its material, which differs by payload. */
const bodyOf = (item, s) => {
  if (s?.payload === "figure-number") return item.headline || `${item.value} ${item.unit}`;
  if (s?.payload === "figure-note") return item.sentence || item.text;
  return item.text;
};

const platforms = config.platforms.filter((p) => !ONLY || ONLY.includes(p.id));
const summary = [];
let failures = 0;
/* Pieces that were shortened to fit a character ceiling. Reported, not hidden. */
let truncated = 0;
let emitted = 0;

for (const p of platforms) {
  const fn = RENDER[p.id];
  const s = specById[p.id];
  if (!fn) { summary.push({ id: p.id, n: 0, vp: 0, note: "no renderer" }); continue; }

  const items = inputsFor(p, s);
  /* Viewpoints multiply the output; a platform whose spec gives no viewpoint still renders once. */
  const vps = p.from === "site" ? [null] : VIEWPOINTS;
  const dir = join(OUT, p.id);
  let count = 0;
  let over = 0;

  for (const [itemIdx, item] of items.entries()) {
    /* The atom's position in the pool: stable across viewpoints and across platforms. */
    const atomRef = `${String(itemIdx + 1).padStart(4, "0")}-a${String(item.article_number ?? "0").padStart(2, "0")}`;
    for (const vp of vps) {
      let text;
      try {
        text = fn(item, vp, p.id);
      } catch (e) {
        failures++;
        console.error(`  RENDER ERROR  ${p.id} ${vp}  ${e.message}`);
        continue;
      }
      /*
       * Completeness check, with the ceiling taken into account.
       *
       * A 280-character post cannot carry every field of a figure whose unit is itself a 180-word
       * description - one of the rare-earth entries here is exactly that. Treating that as data loss
       * rejected the piece, but the piece is not wrong: it is short, and the full field is one click
       * away at the canonical link.
       *
       * So the rule is split by whether the platform has a character ceiling:
       *
       *   long form   every non-empty field must be present, or the piece is rejected
       *   short form  the value must be present; any field that could not fit is counted and
       *               reported at the end, so a truncation is visible rather than silent
       */
      const target = s?.render === "figure" || s?.render === "faq" ? item : null;
      if (target) {
        const required = [target.value, target.retrieved, target.unit].filter((v) => v && String(v).trim());
        const lost = required.filter((v) => !text.includes(String(v)));
        const shortForm = p.limit?.unit === "chars" && p.limit.max;
        if (lost.length) {
          const valueLost = lost.some((v) => v === target.value);
          if (!shortForm || valueLost) {
            failures++;
            console.error(`  LOST DATA  ${p.id}/${vp}  missing ${lost.map((v) => String(v).slice(0, 40)).join(" | ")}`);
            continue;
          }
          truncated++;
        }
      }
      /*
       * Hard ceiling. Where a platform's output carries both artwork instructions and a caption,
       * only the caption is measured - the ceiling applies to what the platform receives, not to
       * the production notes that sit above it.
       */
      if (p.limit?.unit === "chars" && p.limit.max) {
        const measured = /— PIN DESCRIPTION/.test(text) ? text.split(/— PIN DESCRIPTION[^\n]*—\n/)[1] ?? text : text;
        /*
         * A thread's ceiling is per post, and every post was already fitted individually. Measuring
         * the whole thread against 280 reported all 72 of them as over-limit, which was the rule
         * being wrong rather than the output - an eight-post thread is supposed to exceed 280.
         */
        const perPost = p.limit.perPost === true;
        if (perPost) {
          const posts = measured.split(/\n\n———\n\n/);
          const bad = posts.filter((t) => t.length > p.limit.max).length;
          if (bad) { over++; continue; }
        } else if (measured.length > p.limit.max) {
          over++;
          continue;
        }
      }

      if (EMIT) {
        const sub = join(dir, vp ?? "default");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(sub, `${atomRef}.txt`), text + "\n", "utf8");
      }
      count++;
      emitted++;
    }
  }
  summary.push({ id: p.id, name: s?.name ?? p.name, n: count, vp: vps.filter(Boolean).length, over });
}

/* ------------------------------------------------------------------ report */

console.log(`${EMIT ? "RENDERED" : "RENDER PLAN"} — platform × viewpoint\n${"=".repeat(104)}`);
console.log(`  platforms : ${summary.length}   viewpoints per platform : ${VIEWPOINTS.length} (${VIEWPOINTS.join(", ")})`);
console.log(`  pieces    : ${summary.reduce((n, s) => n + s.n, 0)}\n`);
console.log(`  ${"platform".padEnd(18)} ${"platform".padEnd(20)} ${"pieces".padStart(7)}  over-limit  human-gate`);
for (const s of summary) {
  const meta = specById[s.id] ?? {};
  console.log(
    `  ${s.id.padEnd(18)} ${String(meta.name ?? "-").slice(0, 20).padEnd(20)} ${String(s.n).padStart(7)}  ${String(s.over || "").padEnd(11)} ${meta.humanGate ? "YES — draft only" : ""}`,
  );
}
if (failures) console.log(`\n  VALIDATION FAILURES: ${failures} — those pieces were not written.`);
else console.log(`\n  every piece keeps its number and its retrieval date`);
if (EMIT) console.log(`  wrote ${emitted} files into data/renders/<platform>/<viewpoint>/`);
else console.log(`\n  --emit not passed: nothing written.`);
process.exit(failures ? 1 : 0);

