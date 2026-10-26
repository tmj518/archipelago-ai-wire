#!/usr/bin/env node
/**
 * Generate the YouTube channel art from the same brand tokens as the site.
 *
 *   build/youtube/avatar-800.png   800x800    channel avatar
 *   build/youtube/banner-2560.png  2560x1440  channel banner
 *
 * Why generate rather than hand-draw: the site already has one visual system
 * (navy #0a2540, red #c8102e, Georgia + Segoe UI) and the avatar is the same
 * "LM" monogram as public/favicon.svg. Drawing both from the same constants
 * means the channel cannot drift from the site the way a one-off export would.
 *
 * Run:  node scripts/make-channel-art.mjs
 * Needs @napi-rs/canvas, already a devDependency for the OG card.
 *
 * THE BANNER SAFE AREA
 * YouTube crops the banner per device. Only the centre 1235x338 px is
 * guaranteed visible everywhere (TV shows the full 2560x1440, mobile shows a
 * narrow strip). So every element that must always be readable is placed
 * inside x 663..1898, y 551..889, and nothing else is drawn at all.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "build", "youtube");

// Same tokens as src/styles/global.css and public/favicon.svg.
const NAVY = "#0a2540";
const RED = "#c8102e";
const WHITE = "#ffffff";
const SOFT = "#b9c8d7";

const FONT_DIR = "C:/Windows/Fonts";
for (const file of ["georgia.ttf", "georgiab.ttf", "segoeui.ttf", "segoeuib.ttf"]) {
  try {
    GlobalFonts.registerFromPath(`${FONT_DIR}/${file}`, file.replace(".ttf", ""));
  } catch {
    // Fall back to whatever the system exposes; not fatal.
  }
}
const serif = "georgiab, Georgia, serif";
const sans = "segoeui, Segoe UI, Arial, sans-serif";

mkdirSync(OUT_DIR, { recursive: true });

// ------------------------------------------------------------------ avatar

/**
 * Mirrors public/favicon.svg: navy plate, red rule, serif monogram. Drawn at
 * 800x800 rather than upscaled from the 64px SVG, so the type stays sharp.
 */
function makeAvatar() {
  const S = 800;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, S, S);

  // Red rule low on the plate, the same 1:8 height ratio as the favicon.
  ctx.fillStyle = RED;
  ctx.fillRect(0, 596, S, 82);

  ctx.fillStyle = WHITE;
  ctx.font = `700 340px ${serif}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("LM", S / 2, 470);

  const out = join(OUT_DIR, "avatar-800.png");
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`wrote ${out}  (800x800)`);
}

// ------------------------------------------------------------------ banner

function makeBanner() {
  const W = 2560;
  const H = 1440;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);

  // Safe area: x 663..1898 (1235 wide), y 551..889 (338 tall). Every baseline
  // below is chosen so the tallest glyph and the deepest descender stay inside
  // that box — the first version put the accent rule on the wordmark baseline,
  // which drew a red bar through the middle of the text.
  const cx = W / 2;
  const safeTop = 551;
  const safeBottom = 889;

  ctx.textAlign = "center";

  // Accent rule, clear of the cap height below it (cap is ~0.7em).
  ctx.fillStyle = RED;
  ctx.fillRect(cx - 50, safeTop + 14, 100, 8);

  // Wordmark: 120px, baseline at 700, so caps reach ~616 and descenders ~722.
  ctx.fillStyle = WHITE;
  ctx.font = `700 120px ${serif}`;
  ctx.fillText("Landed Math", cx, 700);

  // Tagline: 40px, baseline at 780 — comfortably under the descenders.
  ctx.fillStyle = SOFT;
  ctx.font = `40px ${sans}`;
  ctx.fillText("China trade policy, converted into landed cost", cx, 780);

  // Domain: 30px, baseline at 858, leaving 31px of margin to the safe edge.
  ctx.fillStyle = "#7d93a8";
  ctx.font = `30px ${sans}`;
  ctx.fillText("landedmath.com", cx, 858);

  const out = join(OUT_DIR, "banner-2560.png");
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`wrote ${out}  (2560x1440, content inside the 1235x338 safe area)`);
}

makeAvatar();
makeBanner();
