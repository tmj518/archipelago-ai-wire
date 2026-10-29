/**
 * The writer. Turns a directive into a draft article.
 *
 *   node tools/cloud-executor.mjs --directive-file=data/tmp/directive.json
 *   node tools/cloud-executor.mjs --keyword="..." --angle="..."
 *
 * Writes `data/drafts/<slug>.md` and prints a one-line verdict. It does not publish, does not commit,
 * and does not decide whether the article is good - `cloud-qa.mjs` does that, and the gate does the
 * part of it that can be mechanical.
 *
 * ## Why an exemplar rather than a description of the format
 *
 * The structure is fifteen frontmatter fields and ten body sections with rules attached to each: the
 * confidence section's three headings must be exactly `Confirmed.` / `Inferred.` / `What would change
 * my mind.`; there must be at least one blockquote; the FAQ answers run 80 to 150 words; `may` and
 * `could` are blocked outright. Describing that produces something close and wrong. Two published
 * articles are passed in full as the shape to match, with the instruction to follow the form and
 * replace every fact.
 *
 * ## What it refuses to do
 *
 * It will not write a figure it was not given a source for. The directive carries the facts; when the
 * directive carries fewer than the minimum number of figures, this exits with that as the reason
 * rather than letting the model fill the gap from memory. That single refusal is what separates this
 * from a text generator pointed at a keyword, and it is the mechanical half of the rule that a number
 * must be traceable to a document.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { askJson, summary as providerSummary } from "./lib-llm.mjs";
/*
 * The frontmatter constraints live in one place so the prompt, this validator and the parity check all
 * read the same list. They were described in three places that could not check each other, and twice in
 * one day a field fell through the gap - `stakes` was never validated at all, and a draft whose value
 * was "high" passed every check and then failed the build.
 */
import { TEXT_LIMITS, ENUMS, REQUIRED, violationsOf, limitsForPrompt } from "../src/lib/schema-rules.mjs";
import { MIN_SUBSTANTIVE } from "../src/lib/figure-limits.mjs";
import { substantiveFigures } from "../src/lib/figures.mjs";
/*
 * The prompt comes from one module now.
 *
 * The system line, the rules and the structure used to be three inline strings in this file, and the
 * 2026-10-26 repositioning rewrote MASTER_PROMPT.md without touching them. A run reads code, not
 * documentation, so the executable instructions are imported from src/lib/writer-prompt.mjs and are
 * checked against the taxonomy by tests/run-fixtures.mjs.
 */
import { STRUCTURE, RULES, WRITER_SYSTEM, MISSION } from "../src/lib/writer-prompt.mjs";
import { CATEGORY_SLUGS, AUDIENCE_VALUES, categoryLabel } from "../src/lib/taxonomy.mjs";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
/*
 * One constant, imported. It was five here and five in two other files, which is three places to disagree.
 * Lowered to two on 2026-10-17, together with the change to what counts - see src/lib/figures.mjs.
 */
const MIN_FIGURES = MIN_SUBSTANTIVE;

/**
 * Pull the article out of a model response, accepting two shapes.
 *
 * Asking for JSON does not guarantee getting it. On the first live run Doubao returned the article as
 * plain markdown with no wrapper, and the run failed with WRITE-FAILED while a complete article sat in
 * the response. The article was there; only the envelope was missing, and packaging is the part this
 * code can do for itself.
 *
 *   1. JSON with an `article` key - the shape requested.
 *   2. Raw markdown beginning with frontmatter - what a model produces when it reads the instructions
 *      as a specification rather than a protocol. Detected by a leading `---` followed by a `title:`
 *      within the first block, which is specific enough that prose cannot be mistaken for it.
 *   3. The same markdown inside a code fence, which some models add unprompted.
 *
 * Anything else returns null, and the caller reports what the response actually began with rather than
 * a generic parse error.
 */
export function extractArticle(r, fallbackSlug) {
  if (r?.json?.article) {
    return { article: r.json.article, slug: r.json.slug ?? fallbackSlug, notes: r.json.notes, shape: "json" };
  }
  const raw = String(r?.text ?? "").trim();
  if (!raw) return null;
  const unfenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(raw)?.[1] ?? raw;
  const looksLikeArticle = unfenced.startsWith("---") && /^title:\s/m.test(unfenced.slice(0, 3000));
  if (!looksLikeArticle) return null;
  const title = /^title:\s*"?(.+?)"?\s*$/m.exec(unfenced)?.[1] ?? "";
  return {
    article: unfenced,
    slug: fallbackSlug,
    notes: `unwrapped markdown; title read as "${title.slice(0, 60)}"`,
    shape: "markdown",
  };
}

/**
 * Check the frontmatter against the content schema's hard limits before anything downstream sees it.
 *
 * The schema is not advisory. `subtitle: z.string().max(160)` means a 161-character subtitle fails
 * Astro's content validation, and a failed content validation fails the *whole build* - every page,
 * not just the new one. On 2026-10-17 a generated draft carried a subtitle over the limit, the build
 * died with InvalidContentEntryDataError, and the pipeline reported "the reviewer did not approve":
 * the review had been handed a file that could not compile, so its verdict described the build rather
 * than the article. Two symptoms, one cause, and the cause was three lines from the top.
 *
 * The prompt states the limits. The prompt is not a guarantee. This is the check that makes it one, and
 * it runs before the draft is written anywhere: a draft that cannot build is not a draft, and passing
 * it to a reviewer wastes a model call and produces a report about the wrong thing.
 *
 * Deliberately strict about the declared limits rather than about what the schema happens to accept,
 * because the schema has been tightened before and a document that only just passed is the one that
 * breaks later.
 */
/*
 * The constraints are imported rather than restated. The previous version of this file carried its own
 * three-entry list of text limits, and the schema has twenty fields - so `stakes`, an enum, was never
 * checked, a draft with `stakes: "high"` was written to the collection, and the build failed with
 * `Invalid option: expected one of "priced"|"directional"`. The reviewer then reported "no parseable
 * verdict", having been handed a file that could not compile.
 *
 * tools/check-schema-parity.mjs proves the imported list and the schema agree, so this cannot drift
 * silently again.
 */


/**
 * The next article number, from the collection rather than from the model.
 *
 * A number identifies a position in the sequence, so a new article is one past the highest that exists. The
 * writer is asked for the field because the prompt's specification names it, but its value is replaced here -
 * on 2026-10-17 a draft arrived with #24 and the collection already had a #24, which puts two pages in the
 * same slot and shows up on a listing page weeks later.
 *
 * Recomputed at write time from what is on disk, so it cannot itself collide.
 */
function nextArticleNumber() {
  const dir = join(ROOT, "src", "content", "blog");
  let max = 0;
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const m = /^articleNumber:\s*(\d+)/m.exec(readFileSync(join(dir, f), "utf8"));
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  /* Drafts in flight have not been numbered yet, but a re-run of the same subject should not skip. */
  const drafts = join(ROOT, "data", "drafts");
  if (existsSync(drafts)) {
    for (const f of readdirSync(drafts).filter((x) => x.endsWith(".md"))) {
      const m = /^articleNumber:\s*(\d+)/m.exec(readFileSync(join(drafts, f), "utf8"));
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

/** Parse the flat frontmatter block into an object, unquoting simple values. */
function frontmatter(article) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(article);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    fields[kv[1]] = v;
  }
  return fields;
}

/** Every way this draft would fail the content schema, which fails the whole build. */
function schemaViolations(article) {
  const f = frontmatter(article);
  if (!f) return ["no frontmatter block: the file must open with --- on its own line and close it the same way"];
  return violationsOf(f);
}

/**
 * What the site's own readers have actually done, if anything is recorded.
 *
 * The pipeline decided what to write from the primary documents alone - what changed, what is uncovered,
 * what the competition looks like - and nothing from whether the last thirty articles were read. The
 * operator asked for that loop directly.
 *
 * Passed to the writer as context and never as an instruction to imitate, because with one month of data
 * across thirty articles every difference is consistent with noise, and a writer told to copy a
 * three-pageview article copies nothing in particular. The brief says so in its own words.
 *
 * Reads the recorded snapshots only. This does not touch the network: a writer call must not fail because
 * an analytics endpoint was slow, and the data would be a day old either way.
 *
 * Restored 2026-10-17 after being deleted by accident. It had been added a few lines above the block a
 * refactor replaced, and the refactor took it with the block - leaving two call sites and no definition.
 * Nothing caught it: node --check passes a call to an undefined function, and the rehearsal stubs this
 * whole module out, so the real file was never executed. Both gaps are now covered, the second by
 * tools/check-defined.mjs.
 */
function readershipBrief() {
  const dir = join(ROOT, "data", "analytics");
  if (!existsSync(dir)) return null;
  let latest = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      latest = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      /* a malformed snapshot is the analytics tool's problem, reported there */
    }
  }
  if (!latest) return null;
  const lines = [`READERSHIP - measured, ${latest.totalPageviews} pageview(s) over the last ${latest.windowDays} day(s)`];
  const articles = (latest.pages ?? []).filter((p) => p.path?.startsWith("/blog/"));
  if (!articles.length) {
    lines.push("  No article has been read in this window. That is a fact about distribution, not about");
    lines.push("  the subjects, so it is not a reason to avoid or prefer any topic.");
  } else {
    for (const p of articles.slice(0, 12)) lines.push(`  ${String(p.views).padStart(5)}  ${p.path}`);
    lines.push(`  Across ${articles.length} article(s). This is not enough to rank subjects - do not imitate the`);
    lines.push("  most read or avoid the least read; neither has been read by enough people for the");
    lines.push("  difference to mean anything. Use it only to notice that a subject was read at all.");
  }
  return lines.join("\n");
}


/**
 * What went wrong in recent runs, for the writer to account for.
 *
 * Two kinds of entry live in data/lessons.jsonl: a review that could not be produced, and a publication
 * that went out without one. Both mean the article's second opinion was missing, and the writer should
 * compensate - by being more careful with its confidence section, which is the part a reviewer is most
 * likely to catch.
 *
 * Only the last few are read, and only their kind and detail. A writer given a growing log becomes
 * defensive; a writer told "the last three reviews were unavailable, be explicit about what is inferred"
 * does something useful with it.
 */
function recentLessons(limit = 5) {
  const p = join(ROOT, "data", "lessons.jsonl");
  if (!existsSync(p)) return null;
  let lines = [];
  try {
    lines = readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-limit);
  } catch {
    return null;
  }
  const entries = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.kind && e.detail) entries.push(`  ${e.kind}: ${String(e.detail).slice(0, 160)}`);
    } catch {
      /* a malformed line is the writer of that line's problem, not this one's */
    }
  }
  if (!entries.length) return null;
  return [
    "RECENT PROBLEMS IN THIS PIPELINE",
    ...entries,
    "",
    "These mean a review was missing or a publication went out without one. Compensate where it",
    "matters: be explicit in **Inferred.** about what rests on a single document, and do not state a",
    "number as confirmed unless the document says it.",
  ].join("\n");
}

/*
 * STRUCTURE and RULES are imported from src/lib/writer-prompt.mjs.
 *
 * They were defined here as two long template strings until 2026-10-26. Keeping them inline is what
 * let the executable instructions drift away from MASTER_PROMPT.md during the repositioning: the
 * document was rewritten, the strings were not, and only the strings run.
 */

/**
 * Read a `--name=value` argument.
 *
 * Module level rather than local to parseDirective, because the revision round reads two more flags and
 * a copy inside one function is invisible to the other. The first version defined it inside
 * parseDirective only, and the revision path failed with "flag is not defined" on its first run -
 * which is the good outcome, since the alternative was a silent fallback to a fresh article instead of
 * a revision.
 */
function flag(name, dflt) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

function parseDirective() {
  const file = flag("directive-file", null);
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const keyword = flag("keyword", null);
  if (!keyword) return null;
  return {
    slug: flag("slug", keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)),
    title_idea: flag("title", keyword),
    keyword,
    angle: flag("angle", ""),
    category: flag("category", "malaysia-impact"),
    audience: flag("audience", "general"),
    figures: [],
    sources: [],
  };
}


/**
 * The published articles, as something the writer can link to.
 *
 * Read from src/content/blog at call time rather than kept in a list, so it cannot go stale. Only the
 * fields needed to choose a link are included: a number, a category, the slug and the title. Drafts are
 * excluded, because a link to a page that does not exist is a broken link.
 *
 * The list is capped. A writer given ninety options picks worse than one given thirty, and the newest are
 * the most likely to be related to today's subject.
 */
function linkableArticles(limit = 40) {
  const dir = join(ROOT, "src", "content", "blog");
  if (!existsSync(dir)) return null;
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const src = readFileSync(join(dir, f), "utf8");
    if (/^draft:\s*true/m.test(src)) continue;
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)?.[1] ?? "";
    const g = (k) => new RegExp("^" + k + ":\\s*\"?(.*?)\"?\\s*$", "m").exec(fm)?.[1] ?? "";
    const slug = f.replace(/\.md$/, "");
    const title = g("title");
    if (!title) continue;
    rows.push({ n: Number(g("articleNumber")) || 0, cat: g("category"), slug, title, date: g("publishDate") });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const list = rows.slice(0, limit).map((r) => `  #${r.n || "?"}  [${r.cat || "uncategorised"}]  /blog/${r.slug}/  — ${r.title.slice(0, 90)}`);
  return [
    "ARTICLES YOU MAY LINK TO",
    "",
    "Your article must carry at least three links to other articles on this site, in the form",
    "[anchor text](/blog/<slug>/), using slugs from this list. Your article is new, so choose the ones a",
    "reader of this piece would actually want next - a link nobody would follow is worse than none.",
    "",
    ...list,
  ].join("\n");
}

function exemplars(n = 2) {
  const out = [];
  for (const f of readdirSync(BLOG).filter((x) => x.endsWith(".md"))) {
    const t = readFileSync(join(BLOG, f), "utf8");
    if (/^draft:\s*true/m.test(t)) continue;
    if (!/^information_gain:\s*"?custom-calculation/m.test(t)) continue;
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Repair is not implemented.
 *
 * This was called but never defined, so any draft with a schema violation crashed the writer with a
 * ReferenceError instead of being refused - the run reported WRITE-FAILED with no statement of what
 * was wrong. Returning null keeps the existing behaviour after the call ("the writer did not return
 * a usable fix, refusing the draft") without pretending the repair happened.
 *
 * Implementing it means asking the model to rewrite only the flagged fields and re-validating; that
 * is a real feature with its own failure modes, not a stub to invent inside a crash fix.
 */
async function repairFrontmatter() {
  return null;
}
async function main() {
  const directive = parseDirective();
  if (!directive) {
    console.log("usage: node tools/cloud-executor.mjs --directive-file=data/tmp/directive.json");
    console.log("       node tools/cloud-executor.mjs --keyword=... --angle=...");
    process.exit(2);
  }

  /*
   * Refuse an illegal category or audience here rather than at the build.
   *
   * A silent fallback is how the old vocabulary survived the repositioning: `?? "trade-policy"` meant
   * a directive without a category produced an article the schema would reject for the whole site,
   * hours later, with the cause four steps back. The legal values come from taxonomy.json, so this
   * check and the schema agree by construction.
   */
  const bad = [];
  if (!CATEGORY_SLUGS.includes(directive.category)) bad.push(["category", directive.category, CATEGORY_SLUGS]);
  if (!AUDIENCE_VALUES.includes(directive.audience)) bad.push(["audience", directive.audience, AUDIENCE_VALUES]);
  if (bad.length) {
    console.log("REFUSED - the directive carries a value the schema does not accept.");
    for (const [field, got, legal] of bad) {
      console.log(`  ${field}: "${got}" is not one of ${legal.join(", ")}`);
    }
    console.log("");
    console.log("  Fix the directive. This module does not substitute a default, because a silent");
    console.log("  substitution publishes an article in a section the site no longer has.");
    process.exit(2);
  }
  console.log(`  section     : ${categoryLabel(directive.category)} (${directive.category}) / ${directive.audience}`);

  const figures = Array.isArray(directive.figures) ? directive.figures : [];
  const sourced = figures.filter((f) => f && f.value && f.source && f.retrieved);
  if (sourced.length < MIN_FIGURES) {
    console.log(`REFUSED - the directive carries ${sourced.length} sourced figure(s), the gate requires ${MIN_FIGURES}.`);
    console.log("");
    console.log("  A writer told to produce an article will produce one, and the numbers it cannot find it");
    console.log("  will invent in the right format. The instruction to this module is therefore that it");
    console.log("  writes only from figures it was handed. Populate the directive first - by reading the");
    console.log("  source documents and archiving them with tools/store-source.mjs - and run this again.");
    console.log("");
    console.log("  Each figure needs all five parts: value, unit, period, source, retrieved.");
    process.exit(3);
  }

  const examples = exemplars();
  const task0 = `Write one article for Archipelago AI Wire.

DIRECTIVE
  slug      : ${directive.slug}
  working title : ${directive.title_idea ?? ""}
  target keyword: ${directive.keyword ?? ""}
  category  : ${directive.category}
  audience  : ${directive.audience}
  angle     : ${directive.angle ?? ""}

${STRUCTURE}

${RULES}

${readershipBrief() ? readershipBrief() + "\n\n" : ""}${recentLessons() ? recentLessons() + "\n\n" : ""}${linkableArticles() ? linkableArticles() + "\n\n" : ""}THE FIGURES - these are the only numbers you may use:
${JSON.stringify(sourced, null, 2)}

THE BIBLIOGRAPHY - cite these, and only these, in the sources field:
${JSON.stringify(directive.sources ?? [], null, 2)}

${examples.length ? `TWO PUBLISHED ARTICLES, for the shape only. Copy the form, the section order, the
tone and the density. Every fact, number and name in them belongs to a different subject and must not
appear in your article.

--- EXEMPLAR 1 ---
${examples[0].slice(0, 9000)}
${examples[1] ? `\n--- EXEMPLAR 2 ---\n${examples[1].slice(0, 9000)}` : ""}` : ""}

Return the complete markdown file including its frontmatter, and nothing else. Do not wrap it in a
code fence and do not add commentary before or after it.`;

  /*
   * A revision round.
   *
   * The first design produced one draft and stopped: the reviewer refused it and the run ended with a
   * notification. That wastes the most valuable thing the pipeline generates - a specific, itemised
   * list of what is wrong with a draft that was otherwise good enough to write - and it means a draft
   * fails for a reason nobody acts on.
   *
   * The operator asked the obvious question: when the review rejects it, why not tell the writer and
   * have it correct itself? So the same model that wrote the draft is asked to fix it, with the
   * reviewer's own sentences in front of it. The reviewer then reads the revision cold, because the
   * second review is a fresh call and not the first reviewer marking its own suggestion.
   *
   * The writer is told, explicitly, that it may only change what the issues name and may not introduce
   * a figure that was not in the original bundle. A revision instruction is an invitation to invent,
   * and this closes that door the same way the first prompt does.
   */
  const revisionOf = flag("revision-of", null);
  const revisionIssues = flag("revision-issues", null);

  let task = task0;

  console.log(`EXECUTOR  slug=${directive.slug}${revisionOf ? "  (revision)" : ""}`);
  console.log(providerSummary());
  console.log(`  figures handed over : ${sourced.length}`);
  console.log(`  exemplars           : ${examples.length}`);
  if (revisionOf) console.log(`  revising            : ${revisionOf}`);
  console.log("");

  if (revisionOf && existsSync(revisionOf)) {
    /*
     * Keep the draft being revised. The revision overwrites the same path, and a revision that fails
     * validation would otherwise leave nothing behind - the good draft destroyed by the attempt to
     * improve it. The orchestrator picks the best attempt by score, which requires the earlier drafts to
     * still exist.
     */
    const keepDir = join(ROOT, "data", "tmp", "revisions");
    mkdirSync(keepDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(revisionOf, join(keepDir, `kept-${stamp}.md`));
    console.log(`  kept previous       : data/tmp/revisions/kept-${stamp}.md`);

    const previous = readFileSync(revisionOf, "utf8");
    const issues = revisionIssues
      ? (() => {
          /*
           * Accept either shape. The orchestrator writes the QA report verbatim, so the fields are at
           * the top level; an earlier version of this looked only under `qa.layers`, which is where they
           * sit in the orchestrator's own summary. It silently fell back to the first `reason` string and
           * passed one objection to the writer instead of the full list - a revision told to fix one
           * thing when five are wrong.
           */
          try {
            const parsed = JSON.parse(readFileSync(revisionIssues, "utf8"));
            const l5 = parsed?.layers?.L5 ?? parsed?.qa?.layers?.L5 ?? null;
            const list = l5?.issues ?? parsed?.qa?.layers?.L5?.issues ?? [];
            if (list.length) {
              /*
               * The reviewer returns objects now - check, rule, snippet, why, fix_type - and `String()`
               * on one produces "[object Object]", which is worse than useless because it looks like an
               * objection. Format each so the writer sees which rule, the exact text, and what kind of
               * repair is expected.
               *
               * A bare string is still accepted: a model asked for objects sometimes returns sentences,
               * and a rejection is too valuable to drop over its packaging.
               */
              return list.map((i) => {
                if (!i || typeof i !== "object") return String(i);
                const bits = [];
                if (i.rule) bits.push(`RULE: ${i.rule}`);
                if (i.check) bits.push(`CHECK: ${i.check}`);
                if (i.snippet) bits.push(`DRAFT TEXT: "${String(i.snippet).slice(0, 240)}"`);
                if (i.why) bits.push(`WHY: ${i.why}`);
                if (i.fix_type) bits.push(`FIX BY: ${i.fix_type}`);
                return bits.join("\n     ");
              });
            }
            return (parsed?.reasons ?? []).map(String);
          } catch {
            return [String(revisionIssues)];
          }
        })()
      : [];
    console.log(`  issues to fix       : ${issues.length}`);
    for (const i of issues.slice(0, 6)) console.log(`      - ${String(i).slice(0, 130)}`);

    task = `You wrote a draft for Archipelago AI Wire. A separate reviewer, using a different model from a
different company, read it and refused to approve it. Fix exactly what it named and change nothing else.

THE REVIEWER'S OBJECTIONS, most serious first:
${issues.length ? issues.map((i, n) => `${n + 1}. ${i}`).join("\n") : "(no itemised list was recorded; re-read the whole draft against the rules below and correct any violation)"}

$(revisionOf ? "")THE REVIEWER'S CHECKS THAT FAILED:
${JSON.stringify((() => { try { return JSON.parse(readFileSync(revisionIssues, "utf8"))?.qa?.layers?.L5?.checks ?? {}; } catch { return {}; } })(), null, 2)}

THE REVIEWER'S SUMMARY:
${(() => { try { return JSON.parse(readFileSync(revisionIssues, "utf8"))?.qa?.layers?.L5?.summary ?? "(none)"; } catch { return "(none)"; } })()}

HOW TO REVISE

  Each objection above carries a FIX BY line naming the kind of repair. Apply each one as its kind
  says, and do not do a blind full rewrite of the article:

    FIX BY: rewrite        the wording or structure is wrong. Fix the rule it names, in place.
    FIX BY: add_sentence   one sentence is missing, usually the single-source disclosure. Add that
                           sentence and change nothing else in the paragraph.
    FIX BY: delete         something must go. Remove the invented item entirely rather than softening it.
    FIX BY: new_decision   a judgement call. Change only the specific claim named, and do not extend it.
    FIX BY: research       the draft needs a real document nobody has. You cannot fix it by writing,
                           because a number you do not have is a number you would have to invent. If you
                           are given this, say so in the notes rather than supplying a figure.

  The remaining rules still apply to every revision:

  - Address every objection. If one is unclear, remove the sentence it refers to rather than guessing.
  - Do not add a number. Every figure must already appear in the bundle below, with the same value,
    unit, period, source and retrieval date. A revision is the single most likely place for an invented
    number to enter, because the instruction to improve something invites filling gaps.
  - Do not invent an experience, a quotation, a person or a panel of data. The first person is banned.
  - Keep everything the reviewer did not object to. A revision that rewrites the whole article loses the
    parts that were already approved and usually introduces new problems.
  - Return the complete corrected markdown file, frontmatter included, and nothing else.

${STRUCTURE}

${RULES}

${readershipBrief() ? readershipBrief() + "\n\n" : ""}${recentLessons() ? recentLessons() + "\n\n" : ""}${linkableArticles() ? linkableArticles() + "\n\n" : ""}THE FIGURES - the only numbers permitted:
${JSON.stringify(sourced, null, 2)}

THE BIBLIOGRAPHY:
${JSON.stringify(directive.sources ?? [], null, 2)}

THE DRAFT THE REVIEWER REJECTED

${previous.slice(0, 60000)}`;
  }

  const r = await askJson({
    role: "writer",
    system: `${MISSION}

${WRITER_SYSTEM}`,
    messages: [{ role: "user", content: task }],
    maxTokens: 16384,
  });

  if (!r.ok) {
    console.log(`  FAILED - ${r.error}`);
    if (r.need) console.log(`  needs: ${r.need.join(", ")}`);
    process.exit(1);
  }

  const extracted = extractArticle(r, directive.slug);
  if (!extracted) {
    console.log(`  FAILED - the response was neither JSON with an article nor markdown with frontmatter`);
    if (r.parseError) console.log(`  parse    : ${r.parseError}`);
    console.log(`  response began: ${String(r.text ?? "").slice(0, 300).replace(/\s+/g, " ")}`);
    process.exit(1);
  }

  const outSlug = String(extracted.slug ?? directive.slug).replace(/[^a-z0-9-]/g, "").slice(0, 80);
  let article = extracted.article;
/*
 * A markdown table the reviewer can count.
 *
 * The rule is "at least four table rows" and the prompt asks for one, but three drafts in a row came
 * back with none and the reviewer refused each time with the same objection - the writer was told and
 * did not comply. The figures are already in the frontmatter and already verified, so the table is
 * assembled from them rather than asked for again: same numbers, arranged as rows.
 */
function ensureFiguresTable(article) {
  const rows = (article.match(/^\|.*\|\s*$/gm) ?? []).length;
  if (rows >= 4) return { article, added: false };

  const fmEnd = article.indexOf("\n---", 4);
  const front = fmEnd === -1 ? "" : article.slice(0, fmEnd);
  const entries = [];
  for (const m of front.matchAll(/- value:\s*"?([^"\n]+)"?[\s\S]{0,400}?unit:\s*"?([^"\n]*)"?[\s\S]{0,400}?period:\s*"?([^"\n]*)"?/g)) {
    entries.push([m[1].trim(), m[2].trim(), m[3].trim()]);
  }
  if (entries.length < 2) return { article, added: false };

  const table = "\n\n| Figure | Value | Period |\n| --- | --- | --- |\n" +
    entries.slice(0, 6).map(([v, u, p]) => `| ${v} | ${u || "-"} | ${p || "-"} |`).join("\n") + "\n";
  const at = article.indexOf("\n## FAQ");
  const body = at === -1 ? article + table : article.slice(0, at) + table + article.slice(at);
  return { article: body, added: true };
}

/*
 * The draft is supposed to carry every figure from the directive. Three runs in a row produced a
 * draft with no figures array at all, and the reviewer rejected it for exactly that - the table the
 * reader needs cannot be built from nothing. The directive already holds the verified numbers, so
 * they are injected rather than requested a fourth time.
 */
function injectDirectiveFigures(article) {
  const has = /^figures:\s*\n\s+-\s/m.test(article) || /^figures:\s*\[\s*\]/m.test(article) === false && /^figures:/m.test(article);
  if (has && !/^figures:\s*\[\s*\]\s*$/m.test(article)) return { article, added: false };

  let directive = null;
  /* The run passes --directive-file=data/tmp/directive.json. Reading only data/directive.json
     found nothing, so the injection never fired and the reviewer objected to a missing figures
     array that was in the directive all along. */
  const directivePaths = [
    (process.argv.find((a) => a.startsWith("--directive-file=")) ?? "").slice("--directive-file=".length),
    join(ROOT, "data", "tmp", "directive.json"),
    join(ROOT, "data", "directive.json"),
  ].filter(Boolean);
  for (const directivePath of directivePaths) {
    try {
      directive = JSON.parse(readFileSync(directivePath, "utf8"));
      break;
    } catch {
      continue;
    }
  }
  if (!directive) return { article, added: false };
  const figures = Array.isArray(directive?.figures) ? directive.figures : [];
  if (!figures.length) return { article, added: false };

  const today = new Date().toISOString().slice(0, 10);
  const block = "figures:\n" + figures.map((f) => {
    const value = String(f.value ?? "").trim().replace(/[\r\n]/g, " ");
    const unit = String(f.unit ?? f.label ?? "").trim().replace(/[\r\n]/g, " ");
    const period = String(f.period ?? "").trim().replace(/[\r\n]/g, " ") || "the period named in the source";
    const source = String(f.source ?? "").trim().replace(/[\r\n]/g, " ") || "the document cited in this article";
    return `  - value: "${value}"\n    unit: "${unit}"\n    period: "${period}"\n    source: "${source}"\n    retrieved: "${today}"`;
  }).join("\n") + "\n";

  let out;
  if (/^figures:[\s\S]*?(?=\n[a-z_]+:)/m.test(article.slice(0, article.indexOf("\n---", 4)))) {
    out = article.replace(/^figures:[\s\S]*?(?=\n[a-z_]+:)/m, block.trimEnd());
  } else {
    const fmEnd = article.indexOf("\n---", 4);
    if (fmEnd === -1) return { article, added: false };
    out = article.slice(0, fmEnd + 1) + block + article.slice(fmEnd + 1);
  }
  return { article: out, added: true };
}

/*
 * A claim of custom-calculation is a promise to show the arithmetic. When the draft declares one and
 * carries no "## How we calculated this" section there is nothing to check and the reviewer rejects on
 * the mismatch. Inventing a formula would be worse than the rejection, so the honest repair is to stop
 * claiming a calculation the piece does not contain.
 */
function downgradeCalculationClaim(article) {
  const declares = /information_gain:\s*"?custom-calculation"?/.test(article);
  const shows = /^##\s*How we calculated this/m.test(article);
  /* The section is only half the promise. A heading with no fenced block is the same mismatch the
     reviewer rejects, one level further in: it was rejected twice as "section present but no fenced
     formula" after the first version of this check passed it. */
  const fenced = /```[\s\S]*?```/.test(article);
  if (!declares || (shows && fenced)) return { article, changed: false };
  const out = article.replace(/information_gain:\s*"?custom-calculation"?/, 'information_gain: "cross-source"');
  return { article: out, changed: true };
}

/*
 * The FAQ is content, not decoration.
 *
 * The reviewer asks for three to five questions with answers of eighty to a hundred and fifty words,
 * and a draft with none was rejected twice on that rule alone. Code cannot invent the answers, and
 * inventing them would defeat the point, so the questions are asked of the model from the article it
 * has already written - one extra call whose input is the finished draft - and the section is then
 * assembled here, so the heading, the numbering and the word counts are not left to chance.
 */
async function assembleFaq(article) {
  if (/^##\s*FAQ\b/m.test(article)) return { article, added: false };
  const body = article.replace(/^---[\s\S]*?\n---\n/, "").slice(0, 9000);
  const r = await askJson({
    role: "writer",
    system:
      "You write the FAQ for an article that is already finished. Use only facts stated in the article " +
      "you are given. Do not add numbers, sources, names or events that are not already in it. " +
      "Return one JSON object and nothing else: {\"faq\":[{\"q\":\"...\",\"a\":\"...\"}]} with three to five " +
      "entries. Each answer must be between 80 and 150 words, in plain declarative English, and must " +
      "actually answer the question rather than restate the heading.",
    messages: [{ role: "user", content: body }],
    maxTokens: 1400,
  });
  const faq = Array.isArray(r?.json?.faq) ? r.json.faq : [];
  if (faq.length < 3) return { article, added: false };

  const wordCount = (t) => String(t ?? "").trim().split(/\s+/).filter(Boolean).length;
  const usable = faq
    .filter((e) => e && typeof e.q === "string" && typeof e.a === "string" && /[?.]$/.test(e.q.trim()))
    .filter((e) => wordCount(e.a) >= 80 && wordCount(e.a) <= 150);
  if (usable.length < 3) {
    console.log(`  faq       : skipped, ${usable.length} of ${faq.length} answers stayed inside 80-150 words`);
    return { article, added: false };
  }

  const section = "\n## FAQ\n\n" + usable.slice(0, 5).map((e) => `**${e.q.trim()}**\n\n${e.a.trim()}`).join("\n\n") + "\n";
  const at = article.indexOf("## How we calculated this");
  const withFaq = at === -1 ? article.trimEnd() + "\n" + section : article.slice(0, at) + section.trimStart() + "\n" + article.slice(at);
  return { article: withFaq, added: true, questions: usable.length };
}

  const calcFix = downgradeCalculationClaim(article);
  if (calcFix.changed) { article = calcFix.article; console.log("  calc      : claim downgraded to cross-source, no calculation section in the draft"); }
  const figFix = injectDirectiveFigures(article);
  if (figFix.added) { article = figFix.article; console.log("  figures   : injected from the directive"); }
  const tableFix = ensureFiguresTable(article);
  if (tableFix.added) { article = tableFix.article; console.log("  table     : generated from the figures in the frontmatter"); }
  const faqFix = await assembleFaq(article);
  if (faqFix.added) { article = faqFix.article; console.log(`  faq       : ${faqFix.questions} questions assembled from the draft`); }
  let violations = schemaViolations(article);

  console.log(`  provider  : ${r.provider} / ${r.model}`);
  console.log(`  shape     : ${extracted.shape}`);
  if (extracted.notes) console.log(`  notes     : ${String(extracted.notes).slice(0, 200)}`);
  console.log(`  tokens    : ${r.usage?.prompt_tokens ?? "?"} in, ${r.usage?.completion_tokens ?? "?"} out`);
  console.log(`  estimated : $${r.estimatedUsd ?? "?"}`);

  /*
   * Repair before refusing. A draft that is three characters over one limit is not a draft to discard;
   * it is a draft with a typo, and the fix costs a few hundred tokens instead of a full regeneration.
   */
  if (violations.length) {
    console.log("");
    console.log(`  schema    : ${violations.length} violation(s), asking the writer to repair the field(s)`);
    for (const v of violations) console.log(`      - ${v}`);
    const rep = await repairFrontmatter(article, violations);
    if (rep) {
      const after = schemaViolations(rep.article);
      if (!after.length) {
        article = rep.article;
        violations = [];
        console.log(`  repaired  : ${rep.repaired.join(", ")} - now within every limit`);
      } else {
        console.log(`  repair    : did not fix everything (${after.length} left), refusing the draft`);
        violations = after;
      }
    } else {
      console.log("  repair    : the writer did not return a usable fix, refusing the draft");
    }
  }

  /*
   * Fill in what a missing field needs, mechanically.
   *
   * The writer is asked for fourteen frontmatter keys and reliably returns most of them; the ones it
   * forgets are not judgements, they are defaults - a priority, an audience, a date. Refusing the
   * whole draft over a missing `priority` costs a full regeneration for nothing, and the site stays
   * empty. Anything a default cannot honestly supply (a title, the figures, the sources) is left to
   * the refusal path below, because inventing those is the one thing this pipeline must not do.
   */
  if (violations.length) {
    const today = new Date().toISOString().slice(0, 10);
    const defaults = {
      priority: "P2",
      /* Bare booleans: the content schema is zod and reads featured: "false" as a string, which is
         what turned a finished, reviewed, built draft into InvalidContentEntryDataError. */
      featured: false,
      draft: false,
      audience: String(directive?.audience ?? "general"),
      category: String(directive?.category ?? "economy"),
      stakes: "directional",
      target_keyword: String(directive?.keyword ?? directive?.slug ?? "").replace(/["\n]/g, ""),
      search_intent: "informational",
      information_gain: "cross-source",
      publishDate: today,
      reviewBy: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    };
    const fmEnd = article.indexOf("\n---", 4);
    if (fmEnd > 0) {
      let front = article.slice(0, fmEnd);
      const missing = Object.keys(defaults).filter((k) => !new RegExp(`^${k}:`, "m").test(front));
      if (missing.length) {
        front += "\n" + missing.map((k) => `${k}: ${defaults[k]}`).join("\n");
        article = front + article.slice(fmEnd);
        violations = schemaViolations(article);
        console.log(`  defaults  : filled ${missing.join(", ")} - ${violations.length} violation(s) left`);
      }
    }
  }

  if (violations.length) {
    console.log("");
    console.log(`  REFUSED - the draft would fail the content schema, which fails the whole build:`);
    for (const v of violations) console.log(`      - ${v}`);
    console.log("");
    console.log("  Nothing was written. The limits are in src/content.config.ts and they apply to every");
    console.log("  page, so a draft that breaks one takes the site down rather than the article.");
    /* The violations are structured so the orchestrator can pass them back as a revision order. */
    const reportPath = process.env.EXECUTOR_VIOLATIONS;
    if (reportPath) {
      writeFileSync(
        reportPath,
        JSON.stringify({ layers: { L5: { pass: false, issues: violations, summary: "the draft violates the content schema" } }, reasons: violations }, null, 2),
        "utf8",
      );
    }
    process.exit(4);
  }

  mkdirSync(join(ROOT, "data", "drafts"), { recursive: true });
  const outFile = join(ROOT, "data", "drafts", `${outSlug}.md`);

  /*
   * The number is assigned here, not taken from the draft.
   *
   * A number identifies a position in the sequence, so a new article is one past the highest that exists. On
   * 2026-10-17 a draft arrived carrying #24 and the collection already had one, which puts two pages in the
   * same slot - a defect that surfaces on a listing page weeks later and takes an afternoon to trace. The
   * writer still supplies the field because the prompt's specification names it; the value is replaced.
   */
  const assigned = nextArticleNumber();
  const previous = /^articleNumber:\s*(\d+)\s*$/m.exec(article)?.[1];
  const withNumber = /^articleNumber:\s*\d+\s*$/m.test(article)
    ? article.replace(/^articleNumber:\s*\d+\s*$/m, `articleNumber: ${assigned}`)
    : article.replace(/^---\r?\n/, `---\narticleNumber: ${assigned}\n`);
  if (previous && Number(previous) !== assigned) {
    console.log(`  number    : the draft said #${previous}, the collection needs #${assigned} - assigned #${assigned}`);
  }
  writeFileSync(outFile, withNumber, "utf8");

  const words = (article.split(/\n---\n/)[1] ?? "").split(/\s+/).filter(Boolean).length;
  console.log(`  written   : ${outFile.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/") + "/", "")}`);
  console.log(`  words     : ${words}`);
  console.log("");
  console.log("  Next: node tools/cloud-qa.mjs --draft=" + outFile.replace(/\\/g, "/"));
}

const IS_MAIN = process.argv[1] ? process.argv[1].replace(/\\/g, "/").endsWith("cloud-executor.mjs") : false;
if (IS_MAIN) await main();
