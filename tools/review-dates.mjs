#!/usr/bin/env node
/**
 * Article review clock: which published pieces go stale, and when.
 *
 * The problem this solves
 * -----------------------
 * Every article on this site is dated and sourced, which is a strength until one
 * of its dates passes. Ten of the fourteen published pieces carry a future
 * deadline in the body, and seven of those fall inside three months: the postal
 * route closing on 22 October 2026, the Section 301 exclusions ending on
 * 9 November, the EU handling fee starting on 1 November, the export rebate for
 * batteries reaching zero on 1 January 2027. An article whose central fact has
 * expired is worse than an article that was never written, because it still
 * ranks and still reads as current.
 *
 * The roadmap's rule was "dated articles get revisited once the date passes, and
 * everything else quarterly". That is a policy without a mechanism: nothing
 * reports which article is due, so nothing gets revisited.
 *
 * Design
 * ------
 * `reviewBy` is a frontmatter date: the date a human should look at the piece
 * again. It is deliberately NOT derived automatically at build time, because a
 * date in prose is not necessarily a deadline — article 14 discusses a review
 * that the Commission must complete by 30 June 2028, and that is context, not an
 * expiry. Deriving it would report false positives on prose that happens to
 * contain a year.
 *
 * So the division of labour is:
 *   this tool      extracts candidate dates and reports what is due, so a human
 *                  decides rather than remembers
 *   qa-check.mjs   requires the field to exist, so the decision cannot be
 *                  skipped
 *
 * Usage
 *   node tools/review-dates.mjs              # what is due, and when, by urgency
 *   node tools/review-dates.mjs --candidates # future dates found in each body
 *   node tools/review-dates.mjs --overdue    # only overdue, exit 1 if any
 *   node tools/review-dates.mjs --write      # write data/review/upcoming.md
 *   node tools/review-dates.mjs --today=2026-10-06
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = join(ROOT, "src", "content", "blog");
const OUT = join(ROOT, "data", "review");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");

/** Local date as YYYY-MM-DD. Not toISOString(), which would render UTC. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const TODAY = arg("today") ?? localToday();

const MONTH = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
};

/**
 * Date shapes that actually appear in this library: ISO, "22 October 2026", and
 * "October 22, 2026". Deliberately not a general date parser — a wider net finds
 * more false positives, which is the failure mode being avoided.
 */
const PATTERNS = [
  { re: /\b(20\d\d)-(\d\d)-(\d\d)\b/g, fmt: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  {
    re: /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)\b/g,
    fmt: (m) => `${m[3]}-${MONTH[m[2]]}-${String(m[1]).padStart(2, "0")}`,
  },
  {
    re: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d\d)\b/g,
    fmt: (m) => `${m[3]}-${MONTH[m[1]]}-${String(m[2]).padStart(2, "0")}`,
  },
];

const field = (fm, k) => new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm)?.[1]?.trim() ?? "";

function collect() {
  const out = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
    const raw = readFileSync(join(DIR, f), "utf8");
    const draft = /^draft:\s*true/m.test(raw);
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    const fm = m[1];
    const body = raw.slice(m[0].length);

    const future = new Set();
    for (const { re, fmt } of PATTERNS) {
      re.lastIndex = 0;
      let x;
      while ((x = re.exec(body))) {
        const iso = fmt(x);
        if (iso > TODAY) future.add(iso);
      }
    }

    out.push({
      slug: f.replace(/\.md$/, ""),
      draft,
      title: field(fm, "title"),
      category: field(fm, "category"),
      publishDate: field(fm, "publishDate"),
      updatedDate: field(fm, "updatedDate"),
      reviewBy: field(fm, "reviewBy"),
      // What an out-of-date fact costs: `priced` pieces state a per-unit money
      // figure a reader could act on, so they are listed first.
      stakes: field(fm, "stakes") || "directional",
      future: [...future].sort(),
    });
  }
  return out;
}

const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

const all = collect();
const published = all.filter((a) => !a.draft);

if (flag("candidates")) {
  console.log(`FUTURE DATES FOUND IN BODIES (today = ${TODAY})\n` + "=".repeat(84));
  for (const a of published) {
    console.log(`\n${a.slug}`);
    console.log(`  reviewBy: ${a.reviewBy || "(not set)"}`);
    console.log(`  candidate dates: ${a.future.length ? a.future.join(", ") : "(none)"}`);
  }
  console.log(
    "\nA candidate is not automatically a deadline. Article 14 discusses a\n" +
      "Commission review due 30 June 2028, which is context rather than expiry.\n" +
      "The field is a human decision; this list is the input to it.\n",
  );
  process.exit(0);
}

// A piece is due when its reviewBy date has arrived. A piece with no reviewBy but
// future dates in the body is reported as at risk, not as due.
//
// Ordering is by consequence first, then by date. A flat date sort treats a
// piece whose price has moved the same as one whose process description is old,
// which buries the ones a reader can lose money on.
const byStakesThenDate = (a, b) =>
  (a.stakes === b.stakes ? 0 : a.stakes === "priced" ? -1 : 1) ||
  (a.reviewBy || "9999").localeCompare(b.reviewBy || "9999");

const due = published.filter((a) => a.reviewBy && a.reviewBy <= TODAY).sort(byStakesThenDate);

const upcoming = published.filter((a) => a.reviewBy && a.reviewBy > TODAY).sort(byStakesThenDate);

const unset = published.filter((a) => !a.reviewBy);

/**
 * Publishing cadence against spec v1.3 §8: at most one piece per day, and three
 * to four per week.
 *
 * This exists because the cap had no enforcement at all. The daily profile in
 * The pre-run check described itself as publishing "at most one piece", and nothing
 * tested it — while the actual record shows eight pieces on 2026-10-02 and three
 * on 2026-10-03. A written rule with no mechanism is the same failure shape as
 * the reciprocal-link rule, which decayed for two days unnoticed.
 *
 * Reported on the whole library rather than only recent days, because the
 * question "has this ever been breached" is the one that decides whether the cap
 * is real or should be revised.
 */
const cadence = (() => {
  const byDay = new Map();
  for (const a of published) {
    if (!a.publishDate) continue;
    const d = a.publishDate.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const days = [...byDay].sort();
  const overCap = days.filter(([, n]) => n > 1);

  // ISO week key, so the per-week figure is comparable across month boundaries.
  const weekOf = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  };
  const byWeek = new Map();
  for (const [d, n] of days) {
    const w = weekOf(d);
    byWeek.set(w, (byWeek.get(w) ?? 0) + n);
  }
  const overWeek = [...byWeek].filter(([, n]) => n > 4).sort();

  return { byDay: days, overCap, byWeek: [...byWeek].sort(), overWeek };
})();

const line = (a) => {
  const d = a.reviewBy ? days(a.reviewBy, TODAY) : null;
  const when = d === null ? "  --  " : d === 0 ? "today " : `${String(d).padStart(4)}d`;
  return `  ${when}  ${(a.reviewBy || "(unset)").padEnd(11)}  ${a.stakes.padEnd(11)}  ${a.category.padEnd(13)} ${a.slug}`;
};

if (flag("overdue")) {
  if (!due.length) {
    console.log(`no article is past its review date (today ${TODAY})`);
    process.exit(0);
  }
  console.log(`OVERDUE FOR REVIEW (today ${TODAY})\n`);
  for (const a of due) console.log(line(a));
  console.log(`\n${due.length} article(s) overdue.`);
  process.exit(1);
}

if (flag("cadence")) {
  console.log(`PUBLISHING CADENCE vs spec v1.3 §8 (at most 1/day, 3-4/week)\n`);
  console.log("  by day:");
  for (const [d, n] of cadence.byDay) console.log(`    ${d}  ${n} ${n > 1 ? "  <-- OVER CAP" : ""}`);
  console.log("\n  by week:");
  for (const [w, n] of cadence.byWeek) console.log(`    week of ${w}  ${n} ${n > 4 ? "  <-- OVER" : ""}`);

  console.log(`\n  days with more than one piece : ${cadence.overCap.length}`);
  console.log(`  weeks with more than four     : ${cadence.overWeek.length}`);
  console.log(
    `  pieces total                  : ${published.length} over ${cadence.byDay.length} publish day(s)`,
  );

  // Reported, not failed. A checker that fails forever gets ignored, and the cap
  // has already been exceeded historically — the five-day launch alone put eight
  // pieces on one day. The live question is whether the cap is real, in which
  // case the tool needs to block on the CURRENT day, or whether it should be
  // revised, which is the more likely reading given the operator's own stated
  // limit of one per category per day, up to five categories.
  console.log(
    "\n  This is a report, not a gate. The cap has already been exceeded and a\n" +
      "  permanent failure would be ignored. Decide which is true:\n" +
      "    - the cap is real  -> block publication when today already has a piece\n" +
      "    - the cap is wrong -> revise §8 to match how the site is actually run",
  );
  process.exit(0);
}

const md = [];
md.push(`# Articles due for review`);
md.push("");
md.push(`Generated ${TODAY} by \`tools/review-dates.mjs\`. Do not edit by hand —`);
md.push(`change \`reviewBy\` in the article frontmatter and regenerate.`);
md.push("");
md.push(`\`reviewBy\` is the date a human should look at the piece again: the date its`);
md.push(`central fact is expected to change, not its publish date.`);
md.push("");

md.push(`## Overdue (${due.length})`);
md.push("");
if (!due.length) md.push(`_None._`);
else {
  md.push(`| reviewBy | days late | category | article |`);
  md.push(`| --- | --- | --- | --- |`);
  for (const a of due) md.push(`| ${a.reviewBy} | ${-days(a.reviewBy, TODAY)} | ${a.category} | \`${a.slug}\` |`);
}
md.push("");

md.push(`## Coming up (${upcoming.length})`);
md.push("");
if (!upcoming.length) md.push(`_None._`);
else {
  md.push(`  Sorted by consequence first: a priced piece states a per-unit money`);
  md.push(`  figure a reader can act on.`);
  md.push(`| reviewBy | days away | stakes | category | article | future dates in body |`);
  md.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const a of upcoming)
    md.push(
      `| ${a.reviewBy} | ${days(a.reviewBy, TODAY)} | ${a.stakes} | ${a.category} | \`${a.slug}\` | ${a.future.slice(0, 4).join(", ") || "—"} |`,
    );
}
md.push("");

md.push(`## No review date set (${unset.length})`);
md.push("");
if (!unset.length) md.push(`_None._`);
else {
  md.push(`These have no \`reviewBy\`. A piece with future dates in the body is a`);
  md.push(`candidate; one without is probably evergreen.`);
  md.push("");
  md.push(`| category | article | future dates in body |`);
  md.push(`| --- | --- | --- |`);
  for (const a of unset)
    md.push(`| ${a.category} | \`${a.slug}\` | ${a.future.slice(0, 4).join(", ") || "—"} |`);
}
md.push("");

const report = md.join("\n");

if (flag("write")) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "upcoming.md"), report, "utf8");
  console.log(`wrote ${join(OUT, "upcoming.md")}`);
} else {
  console.log(report);
}

console.log(
  `summary: ${due.length} overdue, ${upcoming.length} scheduled, ${unset.length} with no review date ` +
    `(of ${published.length} published).`,
);
process.exit(due.length ? 1 : 0);
