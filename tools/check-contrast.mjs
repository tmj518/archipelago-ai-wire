#!/usr/bin/env node
/**
 * Every text colour against the surface it sits on, in both themes.
 *
 *   node tools/check-contrast.mjs
 *
 * ## Why this is a gate and not a review
 *
 * The palette had two greys at 3.39 and 2.73 against the page background - below the 4.5 WCAG AA asks for body
 * text. They were not decoration: --c-ink-6 carried `.disclaimer`, the note about what the figures cannot tell
 * you, and --c-ink-5 carried `.sources`, the block listing where every figure came from. The two paragraphs a
 * reader consults before deciding whether to trust a number were the two least legible things on the page.
 *
 * That survived eighteen months of manual review because nobody computes contrast by looking. The only reliable
 * way to keep it fixed is to compute it on every build, which is what this does.
 *
 * ## What it checks
 *
 * Every --c-ink-N token against --c-bg, --c-surface and --c-surface-alt, in the light palette and in the dark
 * one. 4.5 is the floor for all of them, including the faintest, because these tokens are used for text and not
 * for borders - a border can be faint, a date cannot.
 *
 * The accent colours are checked too. --c-red is used for links and for the "current section" marker, and a link
 * at 3.9 is a link somebody cannot see.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CSS = join(ROOT, "src", "styles", "global.css");

function parsePalette(text, startIndex = 0) {
  const block = text.slice(startIndex);
  const open = block.indexOf(":root {");
  if (open < 0) return null;
  const close = block.indexOf("\n}", open);
  if (close < 0) return null;
  const body = block.slice(open, close);
  const out = {};
  for (const m of body.matchAll(/--c-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return { palette: out, endIndex: startIndex + close };
}

const lum = (hex) => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};

const ratio = (a, b) => {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const css = readFileSync(CSS, "utf8");

const light = parsePalette(css, 0);
if (!light) {
  console.log("  cannot find the :root palette in src/styles/global.css");
  process.exit(1);
}

const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = darkAt >= 0 ? parsePalette(css, darkAt) : null;

/* The tokens that carry text. A border may be faint; a date may not. */
const TEXT_TOKENS = ["ink", "ink-2", "ink-3", "ink-4", "ink-5", "ink-6", "navy", "red"];
/* The surfaces text is placed on. */
const SURFACES = ["bg", "surface", "surface-alt"];

const FLOOR = 4.5;
const problems = [];

function check(themeName, palette, isDark) {
  if (!palette) return;
  console.log(`  ${themeName}`);
  for (const token of TEXT_TOKENS) {
    const fg = palette[token];
    if (!fg) {
      problems.push(`${themeName}: --c-${token} is not defined`);
      continue;
    }
    const cells = [];
    let worst = Infinity;
    for (const surface of SURFACES) {
      const bg = palette[surface];
      if (!bg) continue;
      const r = ratio(fg, bg);
      worst = Math.min(worst, r);
      cells.push(`${surface.slice(0, 7)} ${r.toFixed(2)}`);
    }
    const ok = worst >= FLOOR;
    if (!ok) problems.push(`${themeName}: --c-${token} (${fg}) reaches only ${worst.toFixed(2)} on the darkest surface, floor is ${FLOOR}`);
    console.log(`    ${ok ? "ok  " : "FAIL"} --c-${token.padEnd(8)} ${fg}  ${cells.join("  ")}`);
  }
}

console.log("CONTRAST CHECK\n" + "=".repeat(78));
console.log(`  floor: ${FLOOR} (WCAG AA for body text)`);
console.log("");
check("light", light.palette, false);
console.log("");
if (dark) {
  check("dark", dark.palette, true);
} else {
  console.log("  dark");
  console.log("    note  no prefers-color-scheme block, so only the light palette is checked");
}
console.log("");

if (!problems.length) {
  console.log(`RESULT: PASS - every text colour reaches ${FLOOR} against every surface, in every theme`);
  process.exit(0);
}

console.log(`${problems.length} PROBLEM(S):`);
for (const p of problems) console.log("  " + p);
console.log("");
console.log("RESULT: FAIL");
process.exit(1);
