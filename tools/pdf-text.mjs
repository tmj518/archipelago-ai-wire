/**
 * PDF text extractor — the missing tool for reading primary sources.
 *
 * Why this exists: most documents this site works from are PDFs. Federal
 * Register notices, EU anti-dumping regulations, customs announcements and
 * statistical releases are published as PDF. The agent fetch tool returns
 * `unsupported content type "application/pdf"`, and the Python bundled with
 * this machine cannot run at all (missing python3xx.dll), so the usual
 * pdfplumber / PyPDF2 route is unavailable.
 *
 * Run:  node tools/pdf-text.mjs <file.pdf> [--max=40000]
 *
 * Prints extracted text to stdout. Exits non-zero when nothing was
 * extracted, so a caller can tell "scanned image, needs OCR" from "worked".
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const maxArg = args.find((a) => a.startsWith("--max="));
const max = maxArg ? Number(maxArg.split("=")[1]) : 40000;

if (!file) {
  console.error("usage: node tools/pdf-text.mjs <file.pdf> [--max=40000]");
  process.exit(2);
}

let parser;
try {
  // pdf-parse v2 is class-based: new PDFParse({ data }).getText()
  const { PDFParse } = require("pdf-parse");
  parser = new PDFParse({ data: readFileSync(file) });
  const result = await parser.getText();

  const text = (result.text || "").replace(/\n{3,}/g, "\n\n").trim();

  console.log(`### ${file}`);
  console.log(`### pages=${result.total ?? result.pages?.length ?? "?"}  chars=${text.length}`);
  console.log("");

  if (!text) {
    console.error("NO TEXT EXTRACTED — the PDF is likely a scan (image-only) and needs OCR.");
    process.exit(1);
  }

  console.log(text.slice(0, max));
  if (text.length > max) {
    console.log(`\n[...truncated, ${text.length - max} more characters. Raise --max to see more.]`);
  }
} catch (e) {
  console.error("EXTRACT FAILED:", e.message);
  process.exit(1);
} finally {
  try {
    await parser?.destroy?.();
  } catch {
    /* nothing useful to do */
  }
}

// pdf-parse v2 tears down a worker on destroy, which can leave the event loop
// with a non-zero exit code even after a successful extraction. Callers check
// the exit code, so make success explicit.
process.exit(0);
