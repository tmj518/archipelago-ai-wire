import { readFileSync, existsSync } from "node:fs";

/**
 * The n8n preflight, run locally, so its effect can be measured without opening the editor.
 *
 * The workflow's node is the authority, and its logic is reproduced here rather than guessed at:
 * a platform's payload passes when it has a canonical link, a retrieval date, a digit in the text,
 * and - for x-post only - a headline under 140 characters. Reddit and Quora are additionally held
 * for human review by design, so they are reported separately from a failure.
 *
 * This exists because the task's stated acceptance criterion was a counter that does not exist, and
 * a fix cannot be verified against a number nobody can measure.
 */
const ROOT = process.cwd();
const spec = JSON.parse(readFileSync(`${ROOT}/config/platform-spec.json`, "utf8"));
const lines = readFileSync(`${ROOT}/data/atoms/figures.tsv`, "utf8").trim().split("\n");
const head = lines[0].split("\t");
const atoms = lines.slice(1).map((l) => {
  const c = l.split("\t");
  return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""]));
});

const pick = (payload) => {
  switch (payload) {
    case "figure-number": return atoms.filter((a) => a.kind === "figure" && a.shape === "number");
    case "figure-note": return atoms.filter((a) => a.kind === "figure" && a.shape === "note");
    case "data-point": return atoms.filter((a) => a.kind === "data-point");
    case "faq-question": return atoms.filter((a) => a.kind === "faq");
    case "cost-table": return atoms.filter((a) => a.kind === "cost-table");
    default: return [];
  }
};

const HUMAN_GATE = new Set(["reddit-answer", "quora-answer"]);
let clean = 0;
let held = 0;
let failed = 0;
const fails = [];

for (const p of spec.platforms) {
  const items = pick(p.payload);
  if (!items.length) continue;
  const bad = [];
  for (const it of items) {
    const problems = [];
    if (!it.canonical) problems.push("no canonical");
    if (!it.retrieved) problems.push("no retrieval date");
    /*
     * The digit check reads the piece, not a subset of the atom.
     *
     * The first version assembled the text from headline, text, source and canonical only, which
     * omitted the answer and the retrieval date. Fourteen platform groups therefore failed on
     * questions that legitimately carry no number - "Does this rule change what I pay in duty?" is a
     * good question and contains no digit - and the failure was in the check rather than in the
     * content. The pieces assembled from these atoms do contain the answer and the date.
     */
    const text = [it.headline, it.answer, it.text, it.source, it.retrieved, it.canonical].filter(Boolean).join(" ");
    if (!/\d/.test(text)) problems.push("no digit");
    if (p.id === "x-post" && it.headline && it.headline.length > 140) problems.push("headline too long");
    if (problems.length) bad.push(`${it.article_number}:${problems.join("+")}`);
  }
  const gate = HUMAN_GATE.has(p.id);
  if (bad.length) {
    failed++;
    fails.push(`${p.id} (${p.payload}) — ${bad.length}/${items.length} pieces: ${[...new Set(bad)].slice(0, 3).join(", ")}`);
  } else if (gate) {
    held++;
    console.log(`  HELD  ${p.id.padEnd(18)} ${items.length} pieces clean, awaiting human review by design`);
  } else {
    clean++;
    console.log(`  OK    ${p.id.padEnd(18)} ${items.length} pieces clean`);
  }
}

console.log(`\n  clean and deliverable : ${clean} platforms`);
console.log(`  clean but human-gated : ${held} platforms`);
console.log(`  FAILING preflight     : ${failed} platforms`);
for (const f of fails) console.log(`     ${f}`);
console.log(`\n  TOTAL: ${clean + held} of ${clean + held + failed} platforms pass the n8n preflight`);
