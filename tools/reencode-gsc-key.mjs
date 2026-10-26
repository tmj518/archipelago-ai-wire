/*
 * Re-encode a Search Console service-account key so GitHub stores something the runner can read.
 *
 * Why this exists. The runner reported, four times in a row:
 *
 *   GSC_CREDENTIALS_BASE64 does not decode to JSON
 *     base64:           '\uFFFD^\uFFFD\uFFFD\u04F7k\uFFFD\uFFFD^' is not valid JSON
 *     base64 of base64: '\uFFFD\uFFFD9\uFFFD' is not valid JSON
 *
 * Those bytes are not a broken JSON document, they are UTF-16 on a UTF-8 wire. PowerShell's
 * [Text.Encoding]::Unicode.GetBytes($json) produces exactly that, and [Convert]::ToBase64String over it is valid base64
 * of text no JSON parser will read. The fix is not in the decoder, it is in what gets pasted into the secret.
 *
 * Usage:
 *   node tools/reencode-gsc-key.mjs path/to/key.json
 *
 * It reads the file as bytes, works out the encoding from the byte-order mark, writes clean UTF-8 JSON, and prints the
 * base64 of those bytes. Nothing is sent anywhere.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const file = process.argv[2];
if (!file) {
  console.log("");
  console.log("  usage: node tools/reencode-gsc-key.mjs path/to/key.json");
  console.log("");
  console.log("  Point it at the service-account key you downloaded from Google Cloud. It prints the");
  console.log("  base64 you paste into GitHub -> Settings -> Secrets -> GSC_CREDENTIALS_BASE64.");
  console.log("");
  process.exit(2);
}

let bytes;
try {
  bytes = readFileSync(file);
} catch (e) {
  console.log(`  cannot read ${file}: ${e.message}`);
  process.exit(1);
}

/*
 * The byte-order mark is the whole story, so it is read before anything else is attempted.
 */
let text;
let encoding;
if (bytes[0] === 0xff && bytes[1] === 0xfe) {
  text = bytes.subarray(2).toString("utf16le");
  encoding = "UTF-16LE (byte-order mark FF FE) - this is what PowerShell's Unicode encoder produces";
} else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
  text = Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  encoding = "UTF-16BE (byte-order mark FE FF)";
} else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
  text = bytes.subarray(3).toString("utf8");
  encoding = "UTF-8 with a byte-order mark";
} else {
  text = bytes.toString("utf8");
  encoding = "UTF-8, no byte-order mark";
}

text = text.replace(/^\uFEFF/, "").trim();

let key;
try {
  key = JSON.parse(text);
} catch (e) {
  console.log("");
  console.log(`  the file is ${encoding}, but it still does not parse as JSON: ${e.message.slice(0, 120)}`);
  console.log("  The first 60 characters are:");
  console.log("    " + JSON.stringify(text.slice(0, 60)));
  console.log("");
  console.log("  A service-account key starts with {\"type\": \"service_account\". If this does not, it is a different file.");
  process.exit(1);
}

const problems = [];
if (key.type !== "service_account") problems.push(`type is "${key.type}", not "service_account"`);
if (!key.client_email) problems.push("no client_email");
if (!key.private_key) problems.push("no private_key");
if (key.private_key && !String(key.private_key).includes("BEGIN PRIVATE KEY")) {
  problems.push("private_key does not look like a PEM block");
}

console.log("");
console.log("  file        : " + basename(file) + "  (" + bytes.length + " byte(s))");
console.log("  encoding    : " + encoding);
console.log("  project_id  : " + (key.project_id ?? "(none)"));
console.log("  client_email: " + (key.client_email ?? "(none)"));
console.log("");

if (problems.length) {
  console.log("  This is not a usable service-account key:");
  for (const p of problems) console.log("    - " + p);
  console.log("");
  process.exit(1);
}

/*
 * The payload is the JSON text as bytes, exactly as a JSON parser will read it back. That is the definition of
 * "lossless" here: the round trip base64 -> bytes -> utf8 -> JSON.parse has to land on the same object.
 */
const clean = Buffer.from(JSON.stringify(key), "utf8");
const b64 = clean.toString("base64");

let round;
try {
  round = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
} catch (e) {
  console.log("  the round trip failed, which should not be possible: " + e.message);
  process.exit(1);
}
const same = round.client_email === key.client_email && round.private_key === key.private_key;

mkdirSync(join(process.cwd(), "data", "tmp"), { recursive: true });
const out = join(process.cwd(), "data", "tmp", "gsc-key-base64.txt");
writeFileSync(out, b64 + "\n", "utf8");

console.log("  round trip  : " + (same ? "OK - base64 decodes back to the same key" : "MISMATCH"));
console.log("  base64      : " + b64.length + " characters, written to data/tmp/gsc-key-base64.txt");
console.log("");
console.log("  ─────────────────────────────────────────────────────────────────────────────");
console.log("  Copy the whole line below. It is one line, with no spaces and no line breaks.");
console.log("  ─────────────────────────────────────────────────────────────────────────────");
console.log("");
console.log(b64);
console.log("");
console.log("  Then: GitHub -> Settings -> Secrets and variables -> Actions -> Secrets");
console.log("        GSC_CREDENTIALS_BASE64 -> Update -> paste -> Save");
console.log("");
console.log("  Verify with: node tools/gsc-blue-ocean.mjs --days=7");
console.log("");
