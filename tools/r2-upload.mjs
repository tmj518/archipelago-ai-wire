#!/usr/bin/env node
/**
 * Upload article images to Cloudflare R2.
 *
 * Why this exists: images are the only asset that grows the repository
 * without growing the site. A hero image per article at 100-300 KB reaches
 * tens of megabytes inside a year, and every one of them stays in git history
 * forever. R2 keeps them out of the repository and serves them from the same
 * CDN that already serves the site.
 *
 * It calls `wrangler r2 object put` rather than the S3 SDK, so the only
 * dependency is the wrangler install we already have.
 *
 * Setup (once):
 *   1. Cloudflare dashboard → R2 → create a bucket, e.g. `landedmath-media`
 *   2. R2 → Manage API tokens → create a token with Object Read & Write
 *   3. Give the bucket a public hostname (R2 → bucket → Settings →
 *      Public access → connect a custom domain, or enable the r2.dev one)
 *   4. Put the four values in `.env.r2` at the repository root
 *
 * Usage:
 *   node tools/r2-upload.mjs public/images/hero-*.png
 *   node tools/r2-upload.mjs --dir public/images --prefix images/
 *   node tools/r2-upload.mjs --check          # report config, upload nothing
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_FILE = join(ROOT, ".env.r2");

/** Content types for the extensions we actually handle. */
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};

function loadEnv() {
  const env = { ...process.env };
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const BUCKET = env.R2_BUCKET;
const PUBLIC_BASE = (env.R2_PUBLIC_BASE || "").replace(/\/$/, "");
const WRANGLER = join(env.N8N_DIR || "C:/Users/tmj19/AppData/Local/Programs/n8n",
                      "node_modules", ".bin", "wrangler.cmd");

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function checkConfig() {
  const missing = [];
  if (!env.CLOUDFLARE_API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
  if (!BUCKET) missing.push("R2_BUCKET");
  if (!PUBLIC_BASE) missing.push("R2_PUBLIC_BASE");
  if (!existsSync(WRANGLER)) missing.push(`wrangler at ${WRANGLER}`);

  console.log("R2 configuration");
  console.log(`  env file          : ${existsSync(ENV_FILE) ? ENV_FILE : "not found"}`);
  console.log(`  CLOUDFLARE_API_TOKEN : ${env.CLOUDFLARE_API_TOKEN ? "set" : "MISSING"}`);
  console.log(`  R2_BUCKET         : ${BUCKET || "MISSING"}`);
  console.log(`  R2_PUBLIC_BASE    : ${PUBLIC_BASE || "MISSING"}`);
  console.log(`  wrangler          : ${existsSync(WRANGLER) ? "found" : "MISSING"}`);
  if (missing.length) {
    console.log(`\n  Missing: ${missing.join(", ")}`);
    console.log("  See the header of this file for the setup steps.\n");
    return false;
  }
  console.log("");
  return true;
}

/**
 * Walk a directory, skipping anything that is not a media file.
 */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (MIME[extname(p).toLowerCase()]) out.push(p);
  }
  return out;
}

function parseArgs(argv) {
  const args = { files: [], dir: null, prefix: "images/", check: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--dir") args.dir = argv[++i];
    else if (a === "--prefix") args.prefix = argv[++i];
    else args.files.push(a);
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.check) {
  process.exit(checkConfig() ? 0 : 1);
}
if (!checkConfig()) process.exit(1);

const files = args.dir ? collect(resolve(ROOT, args.dir)) : args.files.map((f) => resolve(ROOT, f));
if (!files.length) fail("nothing to upload — pass file paths or --dir <directory>");

console.log(`Uploading ${files.length} object(s) to ${BUCKET}\n`);

let uploaded = 0;
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`  skip (missing): ${file}`);
    continue;
  }
  const ext = extname(file).toLowerCase();
  // The key mirrors the path under the prefix, so an article's assets can be
  // found by slug later without a lookup table.
  const key = args.prefix + relative(ROOT, file).replace(/\\/g, "/").replace(/^public\//, "");
  const ctype = MIME[ext] || "application/octet-stream";

  if (args.dryRun) {
    console.log(`  would upload ${key}  (${ctype})`);
    continue;
  }

  try {
    execFileSync(
      WRANGLER,
      ["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", ctype, "--remote"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(`  ${PUBLIC_BASE}/${key}`);
    uploaded++;
  } catch (err) {
    const detail = (err.stderr?.toString() || err.message || "").split("\n")[0];
    console.error(`  FAILED ${key}: ${detail}`);
  }
}

console.log(`\n${uploaded}/${files.length} uploaded.`);
if (uploaded) {
  console.log("\nPoint a frontmatter heroImage at the printed URL, or set");
  console.log("R2_PUBLIC_BASE as the base and store only the key.");
}
