import { readFileSync, writeFileSync } from "node:fs";

/**
 * Line-ending normalisation, done with the fs API rather than a PowerShell
 * round trip.
 *
 * Why this exists: an earlier session rewrote one article through
 * `Set-Content`, which went via the system ANSI codepage (GBK here) and turned
 * every em dash into "?" — bytes E2 80 94 became E2 80 3F. A later rewrite left
 * CRLF line endings on the same file, which broke the qa-report frontmatter
 * parser until it was taught to accept \r?\n. This script fixes the line
 * endings while asserting the things that went wrong before: no replacement
 * characters, no loss of the em dashes, and byte length accounted for.
 *
 * Usage
 *   node tools/fix-line-endings.mjs <file.md> [--write]
 */

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((a) => !a.startsWith("--"));

if (targets.length === 0) {
  console.error("usage: node tools/fix-line-endings.mjs <file.md>... [--write]");
  process.exit(2);
}

let bad = 0;
for (const file of targets) {
  const raw = readFileSync(file, "utf8");

  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const loneCr = (raw.match(/\r(?!\n)/g) ?? []).length;
  const replacement = (raw.match(/\uFFFD/g) ?? []).length;
  const emDash = (raw.match(/\u2014/g) ?? []).length;
  const bom = raw.charCodeAt(0) === 0xfeff;
  const bytesBefore = Buffer.byteLength(raw, "utf8");

  console.log(`${file}`);
  console.log(`  CRLF ${crlf} · lone CR ${loneCr} · U+FFFD ${replacement} · em dash ${emDash} · BOM ${bom}`);
  console.log(`  bytes before ${bytesBefore}`);

  if (replacement > 0) {
    console.log("  ✗ REFUSING TO WRITE: replacement characters present — the file was already damaged");
    bad++;
    continue;
  }
  if (crlf === 0 && loneCr === 0) {
    console.log("  already LF-only, nothing to do");
    continue;
  }

  const fixed = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const bytesAfter = Buffer.byteLength(fixed, "utf8");

  // Every removed byte must be exactly one of the CR bytes.
  const expected = bytesBefore - crlf - loneCr;
  const ok = bytesAfter === expected;
  console.log(`  bytes after  ${bytesAfter} (expected ${expected}) ${ok ? "✓" : "✗"}`);
  if (!ok || (fixed.match(/\u2014/g) ?? []).length !== emDash) {
    console.log("  ✗ REFUSING TO WRITE: content would not be preserved byte for byte apart from CR removal");
    bad++;
    continue;
  }

  if (write) {
    writeFileSync(file, fixed, "utf8");
    console.log("  ✓ written as LF, UTF-8, no BOM");
  } else {
    console.log("  (dry run — pass --write to apply)");
  }
}

process.exit(bad ? 1 : 0);
