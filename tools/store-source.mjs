/**
 * Fetch a source document and archive it locally.
 *
 *   node tools/store-source.mjs --url="https://..." [--label=name] [--dir=data/sources]
 *   node tools/store-source.mjs --list            show what is archived
 *   node tools/store-source.mjs --verify          re-hash every archived file
 *
 * ## What this is for
 *
 * The pipeline's claim is that every figure traces to a document. On this machine that has meant the
 * author read the document, which is not a check anyone else can run. Archiving the document at the
 * moment it is read changes what is possible:
 *
 *   - a figure can cite `data/sources/<date>/<label>.html` and a byte offset, so the claim is
 *     checkable by a script rather than by trusting a sentence;
 *   - a re-check months later re-reads the archive rather than the live site, which has moved;
 *   - a source that disappears from the web leaves evidence that it once said what we said it said.
 *
 * This is the input side only. The `evidence` field on a figure, and the gate that compares it with
 * these archives, is P2 and is specified in `audit_protocol.md`.
 *
 * ## Rules it follows
 *
 * Every fetch is recorded whether it succeeded or not, because a source that answered 412 is a fact
 * about the source and belongs in the record next to the ones that answered 200. The manifest is
 * append-only: a document fetched twice on different days produces two entries, since the point is
 * what it said when it was read.
 *
 * One request at a time with a delay between them. These are government sites; the probe already
 * showed that they raise 412 against request patterns, and a burst is exactly that pattern.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const BASE = flag("dir", "data/sources");
const MANIFEST = join(ROOT, BASE, "manifest.jsonl");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ---------------------------------------------------------------- list and verify */

if (args.includes("--list")) {
  if (!existsSync(MANIFEST)) {
    console.log("  no manifest yet at " + MANIFEST);
    process.exit(0);
  }
  const rows = readFileSync(MANIFEST, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`ARCHIVED SOURCES — ${rows.length} fetch(es)\n${"=".repeat(84)}`);
  for (const r of rows) {
    console.log(`  ${r.fetched}  ${String(r.status).padStart(4)}  ${String(r.bytes).padStart(9)}B  ${r.ok ? "ok " : "FAIL"}  ${r.label ?? basename(r.file ?? "")}`);
    console.log(`      ${r.url}`);
  }
  process.exit(0);
}

if (args.includes("--verify")) {
  if (!existsSync(MANIFEST)) {
    console.log("  no manifest to verify");
    process.exit(0);
  }
  const rows = readFileSync(MANIFEST, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let bad = 0;
  let missing = 0;
  for (const r of rows) {
    if (!r.file) continue;
    const p = join(ROOT, r.file);
    if (!existsSync(p)) {
      missing++;
      console.log(`  MISSING  ${r.file}`);
      continue;
    }
    const h = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
    if (h !== r.sha256) {
      bad++;
      console.log(`  CHANGED  ${r.file}  ${r.sha256} -> ${h}`);
    }
  }
  console.log(`\n  ${rows.length} entries, ${missing} file(s) missing, ${bad} hash mismatch(es)`);
  process.exit(bad || missing ? 1 : 0);
}

/* ---------------------------------------------------------------- fetch one */

const url = flag("url", null);
if (!url) {
  console.log('usage: node tools/store-source.mjs --url="https://..." [--label=name]');
  console.log("       node tools/store-source.mjs --list");
  console.log("       node tools/store-source.mjs --verify");
  process.exit(2);
}

const when = new Date().toISOString();
const day = when.slice(0, 10);
const dir = join(ROOT, BASE, day);
mkdirSync(dir, { recursive: true });

const label =
  (flag("label", null) ??
    (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return "source";
      }
    })()) + "-" + Math.random().toString(36).slice(2, 7);

let status = 0;
let bytes = 0;
let sha = null;
let file = null;
let note = "";
let contentType = "";

try {
  const r = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(45000),
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/pdf,application/json,*/*" },
  });
  status = r.status;
  contentType = r.headers.get("content-type") ?? "";
  const buf = Buffer.from(await r.arrayBuffer());
  bytes = buf.length;

  /*
   * A body is stored when there is a body, whatever the status. A 412 page is kept too: knowing what
   * the block page says is how the next attempt is shaped, and an empty directory is not a record.
   */
  if (buf.length > 0) {
    const ext = /pdf/i.test(contentType) || buf.slice(0, 5).toString("latin1") === "%PDF-" ? ".pdf" : /json/i.test(contentType) ? ".json" : ".html";
    file = join(BASE, day, `${label}${ext}`);
    writeFileSync(join(ROOT, file), buf);
    sha = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  }

  const head = buf.slice(0, 600).toString("utf8").toLowerCase();
  if (status === 200 && bytes < 900) note = "200 but tiny - probable block or empty shell";
  else if (/just a moment|checking your browser|cf-browser-verification|captcha/i.test(head)) note = "challenge page";
  else if (status === 200) note = "document";
  else if (status === 403 || status === 412 || status === 429) note = "blocked";
  else note = "status " + status;
} catch (e) {
  note = "threw: " + (e.cause?.code ?? e.name ?? e.message);
}

const ok = status === 200 && bytes >= 900 && note === "document";
const record = { fetched: when, url, label, status, bytes, contentType, ok, note, file, sha256: sha };

mkdirSync(join(ROOT, BASE), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(record) + "\n", { flag: "a" });

console.log(`  ${ok ? "ok  " : "FAIL"}  ${status}  ${bytes} bytes  ${note}`);
if (file) console.log(`        archived: ${file}  sha256:${sha}`);
console.log(`        manifest: ${MANIFEST}`);
if (!ok) {
  console.log("");
  console.log("  A non-200 is recorded rather than retried blindly. 412 and 403 are raised against");
  console.log("  request characteristics - egress, headers, frequency - so the next attempt should");
  console.log("  change one of those rather than repeat this one. tools/check-source-reachability.mjs");
  console.log("  reports which sources answer from here at all.");
}
process.exit(ok ? 0 : 1);
