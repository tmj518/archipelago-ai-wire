#!/usr/bin/env node
/**
 * Internal link graph checker.
 *
 * Rules this enforces, from 下一步.md:
 *   - every published article links to at least one other (spec §3)
 *   - no reciprocal pairs: if A links to B, B must not link back to A.
 *     "A→B 且 B→A 只留一次", applied literally, and pre-existing body links
 *     count — that is what the rule says.
 *
 * Why this exists as a file rather than as a check run once. The rule was
 * verified by hand on 2026-10-03, when the library held 13 articles, and the
 * log recorded "0 reciprocal pairs". On 2026-10-07 the same check found six
 * pairs. Both directions of the first one were added in the same commit that
 * published article 14, so the claim was already stale when it was written down,
 * and nothing noticed for two days because the check was a one-off.
 *
 * A rule that is only verified once is a rule that decays. Hence a tool.
 *
 * Known exclusion: prose links only. The Related Reading block at the foot of
 * each article is generated from the relatedPosts() helper, which is a
 * recommendation surface rather than an editorial cross-reference, and it
 * legitimately points both ways. Counting it here would report a violation for
 * every article pair that helper happens to select.
 *
 * Usage
 *   node tools/link-check.mjs              # report, exit 1 on violations
 *   node tools/link-check.mjs --pairs      # list every reciprocal pair
 *   node tools/link-check.mjs --graph      # adjacency list
 *   node tools/link-check.mjs --json
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = join(ROOT, "src", "content", "blog");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);

/** Markdown links to /blog/<slug>/, plus root-relative hrefs in raw HTML. */
const LINK_PATTERNS = [
  /\]\(\/blog\/([a-z0-9-]+)\/?\)/g,
  /href="\/blog\/([a-z0-9-]+)\/?"/g,
];

function graph() {
  const g = new Map();
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
    const raw = readFileSync(join(DIR, f), "utf8");
    if (/^draft:\s*true/m.test(raw)) continue;
    const slug = f.replace(/\.md$/, "");
    const body = raw.slice(/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw)[0].length);

    // Everything from "Related Reading" onward is the generated block, not an
    // editorial link, so it is excluded. The marker is the heading the
    // ArticleFooter component renders.
    const cutoff = body.search(/^##\s*Related Reading/im);
    const prose = cutoff >= 0 ? body.slice(0, cutoff) : body;

    const targets = new Set();
    for (const re of LINK_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(prose))) if (m[1] !== slug) targets.add(m[1]);
    }
    g.set(slug, targets);
  }
  return g;
}

const g = graph();
const slugs = [...g.keys()];

const missingTargets = [];
for (const [slug, targets] of g) {
  for (const t of targets) if (!g.has(t)) missingTargets.push(`${slug} -> ${t}`);
}

/*
 * The outbound rule needs a second article to point at.
 *
 * A dead end is a real defect in a corpus, because the reader who finishes one piece has nowhere to
 * go inside the site. It is not a defect in the first piece ever published: there is no other article
 * to link to, so the rule cannot be satisfied by any correct writing. The first article failed this
 * check on 2026-10-26 for exactly that reason, and the honest fix is to state the precondition rather
 * than to add a link to nothing or to drop the rule.
 *
 * The moment a second piece is published, both are held to it - including the first, which then has a
 * neighbour it should have linked to.
 */
const corpusCanLink = slugs.length > 1;
const orphans = corpusCanLink ? slugs.filter((s) => g.get(s).size === 0) : [];

/*
 * Two different questions, and only one of them was being asked.
 *
 * `orphans` counts articles with no OUTBOUND link - one that points at nothing is a dead end, and that
 * stays blocking. The line below it read "articles with zero", which is how the inbound question reads,
 * and while ten of thirty-two published articles had zero INBOUND links this check reported zero.
 *
 * Inbound is a warning. An orphan page is a real defect - it receives no internal weight and is hard to
 * discover - but every new article is an orphan until something links to it, so it cannot be blocking.
 */
const inbound = new Map(slugs.map((s) => [s, 0]));
for (const [, targets] of g) for (const t of targets) if (inbound.has(t)) inbound.set(t, inbound.get(t) + 1);
const noInbound = slugs.filter((s) => (inbound.get(s) ?? 0) === 0);

const reciprocal = [];
for (const [slug, targets] of g) {
  for (const t of targets) {
    if (g.get(t)?.has(slug) && slug < t) reciprocal.push([slug, t]);
  }
}

const totalLinks = [...g.values()].reduce((a, s) => a + s.size, 0);

if (flag("json")) {
  console.log(JSON.stringify({ slugs, graph: Object.fromEntries([...g].map(([k, v]) => [k, [...v]])), reciprocal, orphans, missingTargets }, null, 2));
  process.exit(orphans.length || reciprocal.length || missingTargets.length ? 1 : 0);
}

if (flag("graph")) {
  for (const [slug, targets] of [...g].sort()) {
    console.log(`${slug}  (${targets.size})`);
    for (const t of [...targets].sort()) console.log(`    -> ${t}`);
  }
  process.exit(0);
}

if (flag("pairs")) {
  console.log(`RECIPROCAL PAIRS (${reciprocal.length})\n`);
  for (const [a, b] of reciprocal) {
    console.log(`  ${a}\n    <-> ${b}`);
  }
  console.log(
    "\nThe rule is that A->B and B->A keep only one. Where both directions are\n" +
      "editorially load-bearing — each article genuinely needs the other to make\n" +
      "its point — the choice is which direction to drop, not whether the reader\n" +
      "benefits from the link.",
  );
  process.exit(0);
}

console.log("INTERNAL LINK GRAPH\n" + "=".repeat(80));
console.log(`published articles : ${slugs.length}`);
console.log(`prose links        : ${totalLinks}`);
console.log(`links per article  : ${(totalLinks / slugs.length).toFixed(1)} average`);
console.log(`articles with zero : ${orphans.length}${orphans.length ? " -> " + orphans.join(", ") : ""}  (outbound - a dead end)`);
  console.log(`zero inbound       : ${noInbound.length}  (nothing links here - a warning)`);
  if (noInbound.length) {
    for (const s of noInbound.slice(0, 8)) console.log(`    no inbound: ${s}`);
    if (noInbound.length > 8) console.log(`    ... and ${noInbound.length - 8} more`);
  }
console.log(`broken targets     : ${missingTargets.length}${missingTargets.length ? " -> " + missingTargets.join(", ") : ""}`);
console.log(`reciprocal pairs   : ${reciprocal.length}${reciprocal.length ? " -> see --pairs" : ""}`);

const failed = orphans.length || missingTargets.length || reciprocal.length;
console.log(
  "\n" +
    (failed
      ? `RESULT: ${orphans.length} orphan(s), ${missingTargets.length} broken, ${reciprocal.length} reciprocal pair(s).`
      : "RESULT: every rule satisfied."),
);
process.exit(failed ? 1 : 0);
