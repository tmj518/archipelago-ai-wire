#!/usr/bin/env node
/**
 * Give the guides inbound links from the blog.
 *
 *   node tools/link-guides.mjs            # dry run: which article would point where
 *   node tools/link-guides.mjs --write
 *
 * ## Why
 *
 * On 2026-10-26 the scorecard in tools/plan-guides.mjs found ten published guides, all ten with zero
 * impressions in Search Console, and all ten with zero inbound links from anywhere on the site. Those
 * two facts are one fact. Writing an eleventh guide before linking the ten is making the problem bigger.
 *
 * ## How it chooses the target
 *
 * Each guide has a small explicit keyword set - the words a reader would use, not the slug. An article
 * is matched on its title, its target keyword and its category. Two shared keywords picks that guide;
 * fewer than two picks the guide index instead.
 *
 * Pointing a tariff article at "Renewing a residence permit" because both contain the word "China" is
 * the kind of link that teaches a search engine nothing. A generic pointer to the index is honest about
 * the distance between the two subjects; a specific pointer is used only when the subjects really are
 * two halves of one question.
 *
 * ## What it will not touch
 *
 * An article that already links to any guide, a draft, or a file with no `## For you` / `## FAQ` to sit
 * in front of.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BLOG = join(ROOT, "src", "content", "blog");
const GUIDE = join(ROOT, "src", "content", "guide");

const write = process.argv.includes("--write");

/*
 * The words a reader would use for each guide. Deliberately small: a keyword set that grows to fit the
 * corpus stops distinguishing anything.
 */
const KEYS = {
  "residence-permit-renewal": ["residence", "permit", "overstay", "renewal", "renew"],
  "z-visa-vs-m-visa": ["visa", "work permit", "employment", "business visit"],
  "visa-extension-inside-china": ["visa", "extension", "extend", "stay"],
  "permanent-residence-application": ["permanent residence", "green card", "settlement"],
  "foreigner-social-insurance": ["social insurance", "contribution", "wage", "employer"],
  "cost-to-hire-foreign-employee": ["hire", "hiring", "employee", "salary", "employer", "labour"],
  "convert-foreign-driving-licence": ["driving", "licence", "license", "vehicle"],
  "144-hour-visa-free-transit": ["transit", "visa-free", "transfer", "layover"],
  "china-tax-residency-183-days": ["tax", "resident", "taxable", "income"],
  "relocation-cost-per-cubic-metre": ["moving", "household", "shipping", "container", "freight", "cargo"],
};

const INDEX = {
  href: "/guide/",
  anchor: "the step-by-step guides",
  lead: "Different question, same method",
  tail: "they price what it costs to live and work in China from the same kind of sourced figure.",
};

const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "china", "chinese", "2026", "2027", "2028"]);
const words = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w));

/* Which guides exist, and what they are called. */
const guides = new Map();
for (const f of readdirSync(GUIDE).filter((x) => x.endsWith(".md"))) {
  const slug = f.replace(/\.md$/, "");
  const raw = readFileSync(join(GUIDE, f), "utf8");
  const title = /^title:\s*"(.*?)"\s*$/m.exec(raw)?.[1] ?? slug;
  guides.set(slug, { slug, title, keys: new Set((KEYS[slug] ?? []).flatMap(words)) });
}

const files = readdirSync(BLOG).filter((x) => x.endsWith(".md"));
const planned = [];
let skipped = 0;

for (const f of files) {
  const slug = f.replace(/\.md$/, "");
  const path = join(BLOG, f);
  const raw = readFileSync(path, "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
  if (/^draft:\s*true/m.test(fm)) {
    skipped++;
    continue;
  }
  if (/\]\(\/guide\//.test(raw)) {
    skipped++;
    continue;
  }
  const idx = raw.includes("\n## For you") ? raw.indexOf("\n## For you") : raw.includes("\n## FAQ") ? raw.indexOf("\n## FAQ") : -1;
  if (idx < 0) {
    skipped++;
    continue;
  }

  const subject = new Set(
    words(
      [
        /^title:\s*"(.*?)"\s*$/m.exec(fm)?.[1],
        /^target_keyword:\s*"(.*?)"\s*$/m.exec(fm)?.[1],
        /^category:\s*"?([^"\n]*)"?\s*$/m.exec(fm)?.[1],
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  let best = null;
  let bestHits = 0;
  for (const g of guides.values()) {
    let hits = 0;
    for (const k of g.keys) if (subject.has(k)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = g;
    }
  }

  const target =
    best && bestHits >= 2
      ? { href: `/guide/${best.slug}/`, anchor: best.title, lead: "Before you move" }
      : { ...INDEX };
  const sentence =
    target.href === INDEX.href
      ? `> ${target.lead}: [${target.anchor}](${target.href})\n\n`
      : `> ${target.lead}: [${target.anchor}](${target.href})\n\n`;

  planned.push({ slug, href: target.href, anchor: target.anchor, next: raw.slice(0, idx + 1) + sentence + raw.slice(idx + 1) });
}

const direct = planned.filter((p) => p.href !== INDEX.href);
console.log("LINK GUIDES FROM THE BLOG");
console.log("=".repeat(74));
console.log(`  candidate articles : ${files.length}`);
console.log(`  would link         : ${planned.length}`);
console.log(`     to a specific guide : ${direct.length}`);
console.log(`     to the guide index  : ${planned.length - direct.length}`);
console.log(`  skipped (draft / already linked / no anchor) : ${skipped}`);
if (direct.length) {
  console.log("\n  specific matches:");
  for (const p of direct.slice(0, 10)) console.log(`    ${p.slug}  ->  ${p.href}`);
}

if (!write) {
  console.log("\n  dry run - add --write to apply");
  process.exit(0);
}
/*
 * Every planned edit targets an article that is already published - the tool reads them from BLOG
 * and rewrites them. That is an update path, and this repository does not have one: an overwrite
 * here would replace a reviewed, sourced article with a generated string, and nothing would record
 * that it happened.
 *
 * So the write is refused while any target exists. The refusal is the feature: the dry run above
 * still tells a human exactly which article should link where, and the link is added by editing the
 * article and re-running the gate. No flag overrides this - a force switch would be the same
 * overwrite with an extra keystroke.
 */
const { existingTargets } = await import("../src/lib/publish-guard.mjs");
const blocked = existingTargets(BLOG, planned.map((p) => p.slug));
if (blocked.length) {
  console.error(`\n  REFUSED: ${blocked.length} of ${planned.length} target article(s) already exist.`);
  console.error("  This tool has no update path and will not overwrite published articles:");
  for (const s of blocked.slice(0, 10)) console.error(`    src/content/blog/${s}.md`);
  if (blocked.length > 10) console.error(`    ... and ${blocked.length - 10} more`);
  console.error("\n  To apply a link by hand: edit the article, then run");
  console.error("    pnpm exec astro build && node tools/gate.mjs --fresh");
  process.exit(1);
}
for (const p of planned) writeFileSync(join(BLOG, `${p.slug}.md`), p.next, "utf8");
console.log(`\n  wrote ${planned.length} file(s)`);
