/**
 * Generate public/og-default.png — the fallback social card used by every
 * page's og:image / twitter:image.
 *
 * Run:  node scripts/make-og-image.mjs     (dev-only, needs @napi-rs/canvas)
 *
 * Re-run whenever the site name or tagline changes. The 2026-10-03 re-run
 * dropped "No tracking · No ads" from the card: it duplicated /privacy/ on a
 * social image, where the space is worth more spent on the positioning line.
 * TODO(brand): replace with a designed 1200x630 card once art exists.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "og-default.png");

const W = 1200;
const H = 630;
const NAVY = "#0a2540";
const NAVY_RULE = "#1e3c5c";
const RED = "#c8102e";
const WHITE = "#ffffff";
const SOFT = "#b9c8d7";
const GOLD = "#ffd166";

// Register real Windows faces so the card matches the site's serif/sans pairing.
const FONT_DIR = "C:/Windows/Fonts";
for (const file of ["georgia.ttf", "georgiab.ttf", "segoeui.ttf", "segoeuib.ttf"]) {
  try {
    GlobalFonts.registerFromPath(`${FONT_DIR}/${file}`, file.replace(".ttf", ""));
  } catch {
    // Fall back to whatever the system exposes; not fatal.
  }
}

const serifStack = "georgiab, Georgia, serif";
const sansStack = "segoeui, Segoe UI, Arial, sans-serif";
const sansBoldStack = "segoeuib, Segoe UI, Arial, sans-serif";

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

ctx.fillStyle = NAVY;
ctx.fillRect(0, 0, W, H);

// Brand accent rule along the bottom edge.
ctx.fillStyle = RED;
ctx.fillRect(0, H - 14, W, 14);

ctx.fillStyle = GOLD;
ctx.font = `600 24px ${sansBoldStack}`;
ctx.fillText("INDEPENDENT ANALYSIS", 90, 152);

ctx.fillStyle = WHITE;
ctx.font = `700 74px ${serifStack}`;
ctx.fillText("Landed", 86, 268);
ctx.fillText("Math", 86, 352);

ctx.fillStyle = SOFT;
ctx.font = `30px ${sansStack}`;
ctx.fillText("China trade policy, converted", 90, 430);
ctx.fillText("into per-unit landed cost.", 90, 472);

ctx.strokeStyle = NAVY_RULE;
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(90, 522);
ctx.lineTo(W - 90, 522);
ctx.stroke();

ctx.fillStyle = SOFT;
ctx.font = `24px ${sansStack}`;
ctx.fillText("Independent analysis · Every figure sourced and dated", 90, 562);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, canvas.toBuffer("image/png"));
console.log(`wrote ${OUT}`);
