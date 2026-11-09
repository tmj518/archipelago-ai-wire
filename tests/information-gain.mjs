#!/usr/bin/env node
/**
 * The information_gain derivation, tested against the shapes real drafts take.
 *
 * The rule is that a value comes from evidence in the draft - a stated calculation, two or more
 * distinct source hosts, or one primary source - and never from a blanket default. When none of
 * those holds the field stays absent and the gate blocks the article, which is the honest outcome.
 *
 *   node tests/information-gain.mjs
 */
const parse = (front, article = "body") => {
  const hit = /^information_gain:[ \t]*["']?([^"'\n]*)["']?/m.exec(front);
  const current = (hit?.[1] ?? "").trim();
  if (current) return current;

  const idxS = front.search(/^sources:/m);
  let srcBlock = "";
  if (idxS >= 0) {
    const after = front.slice(idxS).replace(/^sources:[^\n]*\n?/, "");
    const stop = after.search(/\n[a-zA-Z_]+:|\n---/);
    srcBlock = stop >= 0 ? after.slice(0, stop) : after;
    /* A block that starts with another key holds no sources at all. */
    if (/^\s*[a-zA-Z_]+:/.test(srcBlock.trimStart())) srcBlock = "";
  }
  const hostCount = (srcBlock.match(/^\s*-\s+\S/gm) ?? []).length;

  if (/How we calculated this|custom-calculation/i.test(article)) return "custom-calculation";
  if (hostCount >= 2) return "cross-source";
  if (hostCount === 1) return "primary-source";
  return "";
};

const cases = [
  ["two sources, sources last", 'sources:\n  - bnm.gov.my\n  - dosm.gov.my', "body", "cross-source"],
  ["two sources, keys after", 'sources:\n  - a.com\n  - b.org\ntags:\n  - x', "body", "cross-source"],
  ["one primary source", 'sources:\n  - bnm.gov.my\ntags:\n  - x', "body", "primary-source"],
  ["stated calculation", 'sources:\n  - bnm.gov.my', "## How we calculated this\nRM 1", "custom-calculation"],
  ["own data kept as written", 'information_gain: own-data\nsources:\n  - a.com', "body", "own-data"],
  ["blank field, evidence present", 'information_gain: ""\nsources:\n  - a.com\n  - b.com', "body", "cross-source"],
  ["no evidence", 'sources:\ntags:\n  - x', "body", ""],
  ["illegal value", 'information_gain: guess\nsources:\n  - a.com', "body", "guess"],
  ["legal value respected", 'information_gain: primary-source\nsources:\n  - a.com\n  - b.com', "body", "primary-source"],
];

let pass = 0;
let fail = 0;
for (const [name, front, article, expected] of cases) {
  const got = parse(front, article);
  const ok = got === expected;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(32)} got "${got}" expected "${expected}"`);
}

/* The illegal value must be caught downstream by the enum coercion, not silently accepted here. */
const LEGAL = ["custom-calculation", "cross-source", "own-data", "primary-source"];
const illegalCaught = !LEGAL.includes(parse("information_gain: guess", "body"));
console.log(`  ${illegalCaught ? "ok  " : "FAIL"}  illegal value is not one of the four legal ones`);
if (illegalCaught) pass++;
else fail++;

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
