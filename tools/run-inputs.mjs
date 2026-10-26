#!/usr/bin/env node
/**
 * Today's run inputs, in one command.
 *
 * Built because the same five facts were being extracted at the start of every run - the review
 * clock, the week's category spread, the next article number, the audience split, and the
 * Belt-and-Road coverage gap - and doing it with an inline `node -e` failed on quoting every
 * single time. A shell one-liner that contains a regex, a quote character and a dollar sign cannot
 * survive the trip through PowerShell, and this project has spent more time on that than on some
 * of its articles.
 *
 * Reads the frontmatter only. Writes nothing.
 *
 * Usage: node tools/run-inputs.mjs [--date=YYYY-MM-DD]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BLOG = resolve(ROOT, "src", "content", "blog");

const dateArg = /--date=(\d{4}-\d{2}-\d{2})/.exec(process.argv.slice(2).join(" "))?.[1];
const TODAY = dateArg ?? new Date().toISOString().slice(0, 10);

/** The Monday of the current week, so "this week" is stable whichever day the run happens. */
function weekStart(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const rows = [];
for (const f of readdirSync(BLOG).filter((x) => x.endsWith(".md"))) {
  const raw = readFileSync(resolve(BLOG, f), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
  if (/^draft:\s*true/m.test(fm)) continue;
  const g = (k) => new RegExp(`^${k}:\\s*"?((?:(?!").)*)"?\\s*$`, "m").exec(fm)?.[1]?.trim() ?? "";
  rows.push({
    n: Number(g("articleNumber")) || 0,
    slug: f.replace(/\.md$/, ""),
    title: g("title"),
    cat: g("category"),
    audience: g("audience"),
    publish: g("publishDate"),
    review: g("reviewBy"),
    revisions: (fm.match(/^\s{2}- date:/gm) || []).length,
  });
}
rows.sort((a, b) => a.n - b.n);

console.log(`RUN INPUTS — ${TODAY}\n${"=".repeat(78)}`);
console.log(`  published articles : ${rows.length}`);
console.log(`  next number        : #${Math.max(...rows.map((r) => r.n)) + 1}`);

/* Review clock: what is due, and what is nearest. */
console.log(`\nREVIEW CLOCK\n${"-".repeat(78)}`);
const dated = rows.filter((r) => r.review).sort((a, b) => a.review.localeCompare(b.review));
const overdue = dated.filter((r) => r.review < TODAY);
console.log(`  overdue: ${overdue.length}`);
if (overdue.length) for (const r of overdue) console.log(`     #${r.n}  due ${r.review}  ${r.slug}`);
console.log(`  next three due:`);
for (const r of dated.slice(0, 3)) {
  const d = Math.round((Date.parse(r.review) - Date.parse(TODAY)) / 86400000);
  console.log(`     #${String(r.n).padStart(2)}  ${r.review}  (${d > 0 ? "+" : ""}${d}d)  ${r.cat.padEnd(13)} ${r.slug}`);
}

/* The week's spread, which decides today's category. */
const W = weekStart(TODAY);
const CATS = ["trade-policy", "platforms", "supply-chain", "sourcing", "logistics"];
const counts = Object.fromEntries(CATS.map((c) => [c, 0]));
const week = rows.filter((r) => r.publish >= W);
for (const r of week) counts[r.cat] = (counts[r.cat] ?? 0) + 1;

console.log(`\nTHIS WEEK (from ${W}, Monday)   net-new ${week.length}/15\n${"-".repeat(78)}`);
for (const c of CATS) {
  const n = counts[c];
  console.log(`  ${c.padEnd(14)} ${n}${n === 0 ? "   <- ZERO, fill first" : n < 3 ? "   <- at the floor" : ""}`);
}
const min = Math.min(...CATS.map((c) => counts[c]));
console.log(`\n  write today in : ${CATS.filter((c) => counts[c] === min).join(" / ")}`);
if (week.length >= 15) console.log(`  ★ the week is at its cap of 15: today is review and mechanism work only`);

/* Audience mix, against the operator's stated customer definition. */
console.log(`\nAUDIENCE MIX  (operator's definition: overseas businesses, foreign merchants, Belt-and-Road)\n${"-".repeat(78)}`);
const aud = {};
for (const r of rows) aud[r.audience || "(unset)"] = (aud[r.audience || "(unset)"] ?? 0) + 1;
for (const [k, v] of Object.entries(aud).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);

/*
 * The Belt-and-Road gap, measured rather than remembered.
 *
 * The operator's customer definition names Belt-and-Road countries explicitly, and the coverage
 * audit on 2026-10-09 found the platforms category entirely about EU and US rules. This counts how
 * many articles actually land in one of those markets, so the gap is a number on the screen rather
 * than a note in a file.
 */
const BNR = /belt and road|ASEAN|Vietnam|Malaysia|Indonesia|Thailand|Philippines|Singapore|Middle East|Saudi|UAE|Emirates|Pakistan|Bangladesh|India|Nigeria|Kenya|Brazil|Mexico|Turkey|Russia|Kazakhstan|Central Asia|Eurasian/i;
const bnr = rows.filter((r) => BNR.test(readFileSync(resolve(BLOG, `${r.slug}.md`), "utf8")));
console.log(`\nBELT-AND-ROAD COVERAGE\n${"-".repeat(78)}`);
console.log(`  articles mentioning one of those markets: ${bnr.length} of ${rows.length}`);
const recent = bnr.filter((r) => r.publish >= "2026-10-07");
console.log(`  published in the last three days        : ${recent.length}`);
console.log(`  → ${recent.length === 0 ? "★ below the one-in-three floor: today should land in one of those markets" : "within the floor"}`);

/* Category totals, for the tie-break the instruction names. */
console.log(`\nCATEGORY TOTALS (all time)\n${"-".repeat(78)}`);
for (const c of CATS) console.log(`  ${c.padEnd(14)} ${rows.filter((r) => r.cat === c).length}`);
