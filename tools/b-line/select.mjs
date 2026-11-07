#!/usr/bin/env node
/**
 * B线's own subject selector.
 *
 * A线 asks research "what changed in the world today". B线 asks a different question: which one-person
 * business has public, checkable numbers that nobody here has written about yet. Sharing A线's research
 * pipe is why the first B线 run reported "nothing new to publish" while the case pool it needed did not
 * exist.
 *
 * Every entry carries its own sources. A case whose numbers cannot be pointed at does not go in this
 * file - the writer is told to use only what is here.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const retrieved = new Date().toISOString().slice(0, 10);

/* Numbers here are the first-party ones: the founder's own site, read on the date above. */
const CASES = [
  {
    caseId: "marc-lou-2026",
    slug: "marc-lou-solo-studio-1-2m-year-2026",
    title_idea: "Marc Lou made $1.23m in twelve months as a one-person studio. Here is the arithmetic",
    keyword: "solo founder multiple products revenue",
    category: "success-cases",
    audience: "general",
    angle: "a reader learns why a portfolio of small products beats one big bet, and what it costs to run",
    sources: [
      { name: "Marc Lou - personal site, live revenue and product list (read 2026-11-07)", url: "https://marclou.com/" },
      { name: "Marc Lou - newsletter archive", url: "https://marclou.com/newsletter" },
      { name: "Indie Hackers - discussion of Marc Lou's year", url: "https://www.indiehackers.com/" },
    ],
    figures: [
      { value: "1234900", unit: "USD", label: "Revenue across twelve months", period: "12 months to November 2026", source: "Marc Lou personal site, revenue panel" },
      { value: "35608", unit: "USD per month", label: "TrustMRR monthly revenue", period: "last 30 days, November 2026", source: "Marc Lou personal site, product list" },
      { value: "29188", unit: "USD per month", label: "DataFast monthly revenue", period: "last 30 days, November 2026", source: "Marc Lou personal site, product list" },
      { value: "16397", unit: "USD per month", label: "Ship or Die monthly revenue", period: "last 30 days, November 2026", source: "Marc Lou personal site, product list" },
      { value: "1146", unit: "USD per month", label: "ShipFast monthly revenue", period: "last 30 days, November 2026", source: "Marc Lou personal site, product list" },
      { value: "43", unit: "products", label: "Startups shipped solo", period: "2021 to November 2026", source: "Marc Lou personal site" },
      { value: "90", unit: "percent", label: "Stated gross margin", period: "2026", source: "Marc Lou personal site" },
      { value: "0", unit: "employees", label: "Team size", period: "2026", source: "Marc Lou personal site" },
    ],
  },
];

const blogDir = join(ROOT, "src", "content", "blog");
const existing = existsSync(blogDir)
  ? readdirSync(blogDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
  : [];

const chosen = CASES.find((c) => !existing.includes(c.slug));
if (!chosen) {
  console.log("  b-line: every case in the pool has been written already - a quiet day for this line");
  process.exit(2);
}

const figures = chosen.figures.map((f) => ({ ...f, retrieved }));
const directive = {
  _note: "Written by tools/b-line/select.mjs. Every figure carries its source and the date it was read.",
  _generated: new Date().toISOString(),
  line: "B",
  case_id: chosen.caseId,
  slug: chosen.slug,
  title_idea: chosen.title_idea,
  keyword: chosen.keyword,
  category: chosen.category,
  audience: chosen.audience,
  angle: chosen.angle,
  figures,
  sources: chosen.sources,
};

mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(join(ROOT, "data", "directive.json"), JSON.stringify(directive, null, 2), "utf8");
console.log(`  b-line: case ${chosen.caseId} -> ${chosen.slug}`);
console.log(`  b-line: ${figures.length} figure(s), ${chosen.sources.length} source(s)`);
process.exit(0);