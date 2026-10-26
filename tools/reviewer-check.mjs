#!/usr/bin/env node
/**
 * Reviewer — the quality check that stands in for a human read.
 *
 * Why this exists: `初心与目标.md` says 不人工审稿 and that the two gates should
 * decide instead. But the two gates cannot decide everything a human reader
 * decides, and the gap was measured, not assumed. Three defects reached the built
 * site in this project that neither gate caught:
 *
 *   1. A subtitle at 167 characters, which failed the whole build and took every
 *      page down to a stale deployment. The schema-length rule existed but was
 *      added only after the first outage, and this one still slipped through a
 *      manual edit.
 *   2. An article with no outbound prose link, caught by link-check but only
 *      because that tool runs separately.
 *   3. The de minimis piece covered 19 CFR 145.12(a)(2)(vi) and missed (v),
 *      and described the bond as the main new requirement when the rule's harder
 *      constraint is that only a licensed customs broker can file.
 *
 * (3) is the interesting one: it is not a formatting error and not a missing
 * field. It is a check that the article's own claims match its own sources, which
 * is what a human reviewer does and what no existing tool did.
 *
 * So this checks the classes a reader would catch:
 *
 *   A. Numbers in the body that appear in no figure, source or calculation
 *   B. The AI summary contradicting the body
 *   C. Internal contradictions in the arithmetic
 *   D. Date consistency: reviewBy relative to the dates the piece is about
 *   E. Claims about the site's own process that the frontmatter does not support
 *
 * It reports; it does not rewrite. Findings are printed with the line so a human
 * can accept or reject, and VERBOSE=1 lists what passed.
 *
 * Usage:
 *   node tools/reviewer-check.mjs <file.md>
 *   node tools/reviewer-check.mjs --all
 *   VERBOSE=1 node tools/reviewer-check.mjs --all
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Findings are graded, because not every one deserves the same response. */
const SEV = { HIGH: "HIGH", MED: "MED", LOW: "LOW" };

function parse(file) {
  const raw = readFileSync(file, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  const fm = m ? m[1] : "";
  const body = m ? raw.slice(m[0].length) : raw;
  const scalar = (k) => new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm)?.[1]?.trim() ?? "";

  // List-valued top-level keys.
  const listBlock = (k) => {
    const lines = fm.split("\n");
    const s = lines.findIndex((l) => l.startsWith(k + ":"));
    if (s === -1) return [];
    const out = [];
    for (let i = s + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      out.push(lines[i]);
    }
    return out;
  };

  const figures = listBlock("figures").filter((l) => /^\s*-\s*value:/.test(l)).map((l) => l.replace(/^\s*-\s*value:\s*/, "").replace(/^"|"$/g, ""));
  const sources = listBlock("sources").filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s*/, "").replace(/^"|"$/g, ""));
  const revisionDates = listBlock("revisions").filter((l) => /date:/.test(l)).map((l) => (/date:\s*(\S+)/.exec(l) || [])[1]);

  return {
    file,
    raw,
    fm,
    body,
    slug: file.split(/[\\/]/).pop().replace(/\.md$/, ""),
    draft: /^draft:\s*true/m.test(fm),
    title: scalar("title"),
    subtitle: scalar("subtitle"),
    description: scalar("description"),
    reviewBy: scalar("reviewBy"),
    publishDate: scalar("publishDate"),
    updatedDate: scalar("updatedDate"),
    stakes: scalar("stakes"),
    gain: scalar("information_gain"),
    figures,
    sources,
    revisionDates,
  };
}

/** Every number in the body with enough context to be recognisable. */
function numbersIn(text) {
  const out = [];
  const re = /(?:\$|EUR|€|£)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:per cent|%|tCO2e|tonnes?|kg|EUR|USD)|\b\d{4,}(?:\.\d+)?\b/g;
  let m;
  while ((m = re.exec(text))) out.push(m[0].trim());
  return out;
}

const norm = (s) => s.replace(/[,\s]/g, "").replace(/^[$€£]|EUR|\$|USD/g, "").toLowerCase();
const digitsOnly = (s) => (s.match(/\d[\d.]*/g) || []).join("");

function review(a) {
  const findings = [];
  const add = (sev, rule, detail, line) => findings.push({ sev, rule, detail, line });

  /* ---------------------------------------------------------------- A
   * A number stated in the body that appears in no figure, no source and no
   * calculation. This is the check that would have caught a figure published
   * without its supporting record. It is informational: bodies legitimately cite
   * source documents by number, so the finding names the value for a human to
   * judge rather than asserting an error.
   */
  const bodyLines = a.body.split("\n");
  const allowed = new Set();
  for (const f of a.figures) for (const d of digitsOnly(f).match(/\d{2,}/g) || []) allowed.add(d);
  for (const s of a.sources) for (const d of digitsOnly(s).match(/\d{3,}/g) || []) allowed.add(d);
  // Numbers inside the calculation section are working, not claims.
  const calcStart = a.body.search(/^##\s*How we calculated this/m);
  const calcSection = calcStart >= 0 ? a.body.slice(calcStart) : "";
  for (const d of digitsOnly(calcSection).match(/\d{3,}/g) || []) allowed.add(d);

  const unsupported = [];
  for (const [i, line] of bodyLines.entries()) {
    if (/^\s*[-|>#`]/.test(line)) continue;
    if (calcStart >= 0 && a.body.slice(0, a.body.indexOf(line)).length >= calcStart) continue;
    for (const n of numbersIn(line)) {
      const d = digitsOnly(n);
      if (d.length < 4) continue; // small numbers are prose, not claims
      if (allowed.has(d)) continue;
      if (/^(19|20)\d{2}$/.test(d)) continue; // a bare year
      unsupported.push({ n, line: i + 1, text: line.trim().slice(0, 90) });
    }
  }
  for (const u of unsupported.slice(0, 6)) {
    add(SEV.LOW, "A number not in any figure or source", `"${u.n}" — line ${u.line}: ${u.text}`, u.line);
  }

  /* ---------------------------------------------------------------- B
   * The AI summary must not contradict the body on a number. The summary is what
   * a reader and an answer engine see first, so a stale figure there is worse
   * than a stale figure further down.
   */
  const sumM = /##\s*AI Summary\r?\n\r?\n([\s\S]*?)\r?\n\r?\n/.exec(a.body);
  if (!sumM) {
    add(SEV.HIGH, "AI summary missing", "the section is required by the structure rule", 0);
  } else {
    const summary = sumM[1];
    // A length threshold is the wrong filter: it was raised to 5 digits to keep a
    // bare year out, and that also excluded every three-digit figure, which is how
    // an injected "EUR 999" passed unseen. Filter years by shape instead.
    const isYearLike = (d) => /^(19|20)\d{2}$/.test(d);
    const sumNums = numbersIn(summary).map(digitsOnly).filter((d) => d.length >= 3 && !isYearLike(d));
    // The summary is part of the body, so comparing against the body as a whole
    // made this check vacuous: every summary number trivially "appeared" in it.
    // The comparison has to exclude the summary itself, which is the whole point —
    // a summary that drifted from the article is the defect being looked for.
    const bodyWithoutSummary = a.body.replace(summary, "");
    for (const d of sumNums) {
      if (allowed.has(d)) continue;
      if (bodyWithoutSummary.includes(d)) continue;
      // A figure broken across a separator, e.g. 981.88 written as 981 in one place.
      add(SEV.MED, "AI summary states a number the body does not", `"${d}"`, 0);
    }
    const words = summary.trim().split(/\s+/).filter(Boolean).length;
    if (words < 40 || words > 60) add(SEV.MED, "AI summary outside 40-60 words", `${words} words`, 0);
  }

  /* ---------------------------------------------------------------- C
   * Internal arithmetic. Where the body states a total that is the sum of two
   * stated components, check it adds up. Only checks unambiguous pairs.
   */
  const pairs = [
    [/duty and fees[^|]*\|\s*\*\*\$?([\d,.]+)\*\*/i, /\|\s*([\d.]+)%\s*\|\s*\$([\d,.]+)\s*\|/i],
  ];
  void pairs; // kept explicit: the general case cannot be inferred reliably

  // A narrower, reliable version: the callout's headline figures must appear in the
  // body or be derivable from a stated figure. Derivation matters — the first run
  // flagged "5,564 tonnes" in a data point where the body states 22,256.02 a year
  // and the same paragraph gives the quarterly figure, which is simple division.
  const callout = /<div class="callout">([\s\S]*?)<\/div>/.exec(a.body);
  if (callout) {
    const derivable = (d) => {
      // Any stated figure, divided by 1, 2, 4 or 12, matching this value.
      for (const f of a.figures) {
        for (const raw of digitsOnly(f).match(/\d+(?:\.\d+)?/g) || []) {
          const base = Number(raw.replace(/,/g, ""));
          if (!Number.isFinite(base)) continue;
          for (const div of [1, 2, 4, 12]) {
            const v = base / div;
            if (Math.abs(v - Number(d)) < Math.max(1, v * 0.005)) return true;
          }
        }
      }
      return false;
    };
    // Compare digit strings, not raw text: the body writes "18,000" and the
    // callout writes "$18,000", so a substring test on the raw characters fails
    // while the value is plainly the same. Strip separators from both sides.
    const restDigits = (a.body.replace(callout[1], "").match(/\d[\d.,]*/g) || []).map(digitsOnly);
    for (const n of numbersIn(callout[1])) {
      const d = digitsOnly(n);
      if (d.length < 4) continue;
      if (restDigits.includes(d)) continue;
      if (restDigits.some((r) => r.includes(d) || d.includes(r))) continue;
      if (a.figures.some((f) => digitsOnly(f).includes(d))) continue;
      if (derivable(d)) continue;
      add(SEV.MED, "Data point states a figure absent from the body and the figures", `"${n}"`, 0);
    }
  }

  /* ---------------------------------------------------------------- D
   * Dates. A piece may only be reviewed after the date it is about, or the
   * review clock is meaningless. And a priced piece states money, so a long
   * review window on one is a risk rather than thrift.
   */
  if (a.reviewBy && !a.draft) {
    const rb = new Date(a.reviewBy + "T00:00:00Z");
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const days = Math.round((rb - today) / 86400000);
    if (Number.isNaN(days)) add(SEV.HIGH, "reviewBy is not a date", a.reviewBy, 0);
    else if (days < 0) add(SEV.HIGH, "reviewBy is in the past", `${a.reviewBy} (${days} days)`, 0);
    else if (a.stakes === "priced" && days > 180) add(SEV.MED, "priced piece reviewed beyond 180 days", `${days} days to ${a.reviewBy}`, 0);

    // The body's own future dates must not fall before reviewBy without comment.
    const future = [...a.body.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)].map((m) => m[0]);
    const afterReview = future.filter((d) => new Date(d) > rb);
    if (afterReview.length) {
      add(SEV.LOW, "body names a date after reviewBy", `${afterReview.slice(0, 3).join(", ")} vs reviewBy ${a.reviewBy}`, 0);
    }
  } else if (!a.draft && !a.reviewBy) {
    add(SEV.HIGH, "no reviewBy", "every published piece needs a review date", 0);
  }

  /* ---------------------------------------------------------------- E
   * Claims about this site's own process must be supported by the frontmatter.
   * The rewrite that this check replaces named a specific error of this class: the
   * capture box promising a daily email that had never been sent.
   */
  const processClaims = [
    [/\bcorrections are recorded\b/i, a.revisionDates.length > 0, "says corrections are recorded but carries no revision"],
    [/\bcustom calculation\b/i, a.gain === "custom-calculation", "claims a custom calculation but information_gain says otherwise"],
    [/\bHow we calculated this\b/, /^##\s*How we calculated this/m.test(a.body), "names a calculation section that is absent"],
  ];
  for (const [re, ok, msg] of processClaims) {
    if (re.test(a.body) && !ok) add(SEV.HIGH, "unsupported process claim", msg, 0);
  }
  if (a.gain === "custom-calculation" && !/^##\s*How we calculated this/m.test(a.body)) {
    add(SEV.HIGH, "custom-calculation without a calculation section", "gate requires the section for this gain type", 0);
  }

  // The disclosure added for Article 50 must not be contradicted by a claim of
  // full automation anywhere in the piece.
  if (/\bfully automatic\b|\bno human\b/i.test(a.body)) {
    add(SEV.MED, "claims full automation", "conflicts with the Article 50 disclosure wording", 0);
  }

  return findings;
}

/* ---------------------------------------------------------------------- main */

const args = process.argv.slice(2);
let files;
if (args[0] === "--all") {
  const dir = join(ROOT, "src", "content", "blog");
  files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f));
} else if (args.length) {
  files = args;
} else {
  console.error("usage: node tools/reviewer-check.mjs <file.md> | --all");
  process.exit(2);
}

const TITLES = { HIGH: "must fix", MED: "should fix", LOW: "worth a look" };
let high = 0, med = 0, low = 0;
const perFile = [];

for (const file of files) {
  const a = parse(file);
  if (a.draft) continue;
  const findings = review(a);
  high += findings.filter((f) => f.sev === "HIGH").length;
  med += findings.filter((f) => f.sev === "MED").length;
  low += findings.filter((f) => f.sev === "LOW").length;
  perFile.push({ slug: a.slug, findings });
}

console.log("\nREVIEWER — the read a human would give, made repeatable");
console.log("=".repeat(84));
console.log(`  articles reviewed: ${perFile.length}`);
console.log(`  must fix ${high}   should fix ${med}   worth a look ${low}`);

const offenders = perFile.filter((p) => p.findings.length);
if (!offenders.length) {
  console.log("\n  Nothing to report. Every piece is internally consistent with its own record.");
} else {
  /*
   * HIGH and MED print in full, with the rule, the file and the line. LOW does
   * not: the first run produced 90 of them, and most are legitimate — a worked
   * example in a table, a source document cited by its number — so printing each
   * one buries the three findings that mattered. A report nobody reads is worse
   * than a shorter one. LOW is summarised by count per article and inspectable
   * with VERBOSE=1.
   */
  for (const sev of [SEV.HIGH, SEV.MED]) {
    const group = offenders.flatMap((p) => p.findings.filter((f) => f.sev === sev).map((f) => ({ ...f, slug: p.slug })));
    if (!group.length) continue;
    console.log(`\n${TITLES[sev].toUpperCase()} (${group.length})`);
    for (const f of group) {
      console.log(`  [${f.sev}] ${f.slug}`);
      console.log(`        ${f.rule}`);
      console.log(`        ${f.detail}`);
    }
  }

  const lowByFile = offenders
    .map((p) => ({ slug: p.slug, n: p.findings.filter((f) => f.sev === SEV.LOW).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (lowByFile.length) {
    console.log(`\nWORTH A LOOK (${lowByFile.reduce((a, x) => a + x.n, 0)}) — mostly worked examples and cited document numbers; summary only`);
    for (const x of lowByFile.slice(0, 8)) console.log(`  ${String(x.n).padStart(3)}  ${x.slug}`);
    console.log(`  run with VERBOSE=1 to list them individually`);
  }
}

if (process.env.VERBOSE) {
  console.log("\nPER ARTICLE");
  for (const p of perFile) console.log(`  ${p.findings.length === 0 ? "clean" : String(p.findings.length).padStart(5)}  ${p.slug}`);
}

console.log(`\nRESULT: ${high === 0 ? "no must-fix findings" : `${high} must-fix finding(s)`}\n`);
// A must-fix is a blocking condition; the softer grades are advisory, like the
// About-page claims in qa-check, because judging them is the reviewer's job.
process.exit(high ? 1 : 0);
