import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/content/blog";

/**
 * Build the comparison-topic candidate pool from what we have actually verified.
 *
 * The rule this follows, from the C11 mistake earlier in the project: topic
 * selection starts by reading our own coverage, not by finding competitors. A
 * comparison line is only worth starting if the numbers on both sides are
 * already sourced — otherwise every candidate costs a full research pass, and
 * the research pass is the expensive resource.
 *
 * So this extracts, per article: the verified figures, and the CN codes, HS
 * codes, dates and money figures that a comparison could pair. What it cannot
 * extract is the editorial judgement about which pairing a reader would search
 * for. That stays a human decision.
 */
const articles = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
  const raw = readFileSync(join(DIR, f), "utf8");
  if (/^draft:\s*true/m.test(raw)) continue;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)[1];
  const body = raw.slice(/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw)[0].length);
  const g = (k) => new RegExp(`^${k}:\\s*"?([^"\\n]+)"?`, "m").exec(fm)?.[1]?.trim() ?? "";

  // Verified figures, with their units, so a comparison can reuse them as-is.
  const figures = [];
  for (const m of fm.matchAll(/^\s*-\s*value:\s*"?([^"\n]+)"?\s*\n\s*unit:\s*"?([^"\n]+)"?/gm)) {
    figures.push({ value: m[1].trim(), unit: m[2].trim() });
  }

  const cnCodes = [...new Set((body.match(/\b\d{4}(?:\s?\d{2})?(?:\s?\d{2})?\b/g) || []))]
    .filter((c) => /^(72|73|76|85|84|38|28|70|24)/.test(c.replace(/\s/g, "")));

  const money = [...new Set(
    (body.match(/(?:EUR|USD|\$|€|£)\s?\d[\d,.]*(?:\s*(?:a|per|\/)\s*(?:tonne|ton|unit|item|kg|parcel|container|1,000))?/gi) || []),
  )].slice(0, 8);

  articles.push({
    slug: f.replace(/\.md$/, ""),
    category: g("category"),
    keyword: g("target_keyword"),
    stakes: g("stakes"),
    reviewBy: g("reviewBy"),
    figureCount: figures.length,
    figures,
    cnCodes: cnCodes.slice(0, 10),
    money,
  });
}

console.log("COMPARISON CANDIDATE INPUTS — verified material already on hand\n" + "=".repeat(96));
for (const a of articles) {
  console.log(`\n${a.slug}`);
  console.log(`  ${a.category} · ${a.stakes} · reviewBy ${a.reviewBy} · ${a.figureCount} verified figures`);
  if (a.cnCodes.length) console.log(`  codes : ${a.cnCodes.join(", ")}`);
  if (a.money.length) console.log(`  money : ${a.money.slice(0, 5).join(" | ")}`);
}

// Which pairs share a code or a unit, i.e. could be compared without new research?
console.log("\n" + "=".repeat(96));
console.log("PAIRS SHARING A PRODUCT CODE (candidates that need no new sourcing)");
const byCode = {};
for (const a of articles) for (const c of a.cnCodes) (byCode[c.replace(/\s/g, "")] ??= []).push(a.slug);
let pairs = 0;
for (const [code, slugs] of Object.entries(byCode)) {
  const uniq = [...new Set(slugs)];
  if (uniq.length > 1) {
    pairs++;
    console.log(`  ${code}: ${uniq.join("  +  ")}`);
  }
}
if (!pairs) console.log("  (none — cross-article comparisons would need new research)");

console.log("\n" + "=".repeat(96));
console.log("CATEGORY GAPS — thinnest silos first");
const byCat = {};
for (const a of articles) (byCat[a.category] ??= []).push(a.slug);
for (const [c, s] of Object.entries(byCat).sort((x, y) => x[1].length - y[1].length)) {
  console.log(`  ${c.padEnd(14)} ${s.length}  ${s.join(", ")}`);
}
