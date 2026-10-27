#!/usr/bin/env node
/**
 * Run every gate once, in parallel where that is safe, and cache the network-bound ones.
 *
 * Why this exists. A full gate pass was measured at 5.5 minutes, and 99 per cent of that
 * was three checks that go to the network: serp-check (270s, fetching competitor pages
 * for all 23 articles), check-mobile (60s, launching a browser), and the rest (0.9s
 * combined). The agent runs the gates after each edit to an article, so a run that
 * touches one article several times spent most of its wall clock re-fetching the same
 * unchanged competitor pages and re-launching the same browser.
 *
 * That is not a bug in the tools. It is a design fault in how they are called: the
 * expensive checks are pure functions of files on disk, and were being recomputed every
 * time regardless of whether those files changed.
 *
 * So: hash the inputs, reuse the last verdict when the hash matches, and run the cheap
 * checks concurrently because they are independent processes reading the same files.
 *
 * Usage:
 *   node tools/gate.mjs              # cached; re-runs only what changed
 *   node tools/gate.mjs --fresh      # ignore the cache and recompute everything
 *   node tools/gate.mjs --json       # machine-readable summary
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, ".cache");
const CACHE_FILE = join(CACHE_DIR, "gates.json");
const FRESH = process.argv.includes("--fresh");
const JSON_OUT = process.argv.includes("--json");
const NODE = process.execPath;

/* ------------------------------------------------------------------ caching */

function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { return {}; }
}
function saveCache(c) {
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify(c, null, 0), "utf8"); } catch { /* non-fatal */ }
}

/**
 * Hash a set of paths: contents for files, a recursive walk for directories.
 *
 * The directory branch used to read the entries of the top level only:
 *
 *     for (const f of readdirSync(abs).sort()) {
 *       try { h.update(f).update(readFileSync(join(abs, f))); }
 *       catch { h.update(f + ":unreadable"); }
 *     }
 *
 * For `dist` that read nothing at all. Its top level holds directories - blog, instrument, topic,
 * category and so on - so every entry went to the catch branch and contributed only its name. The
 * hash of `dist` was therefore very nearly constant, and the two gates that take it as their input,
 * mobile layout and CSP, served verdicts from a previous build.
 *
 * What that looked like in practice, twice on 2026-10-16: the pre-run check reported a mobile overflow on a
 * specific page - a table 71px too wide, then a code block 87px too wide - while check-mobile alone
 * passed all 135 pages. Both were real numbers attached to a stale dist. The tell was that the gate
 * said 131 pages and the standalone check said 135.
 *
 * A recursive walk costs a little more and cannot produce that class of wrong answer. Paths are
 * hashed alongside contents so a file moving does not leave the key unchanged.
 */
function hashPaths(paths) {
  const h = createHash("sha256");
  const walk = (abs, rel) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      h.update(`${rel}:unreadable`);
      return;
    }
    for (const e of entries) {
      const childAbs = join(abs, e.name);
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(childAbs, childRel);
      else {
        try {
          h.update(childRel).update(readFileSync(childAbs));
        } catch {
          h.update(`${childRel}:unreadable`);
        }
      }
    }
  };
  for (const p of [...paths].sort()) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) {
      h.update(`${p}:missing`);
      continue;
    }
    if (statSync(abs).isDirectory()) walk(abs, p);
    else h.update(p).update(readFileSync(abs));
  }
  return h.digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------------ the gates */

/** Articles and their frontmatter, which most gates depend on. */
const ARTICLES = readdirSync(join(ROOT, "src", "content", "blog")).filter((f) => f.endsWith(".md")).map((f) => `src/content/blog/${f}`);

const GATES = [
  {
    id: "qa-check",
    tier: "hard",
    label: "structural gates",
    args: ["tools/qa-check.mjs", "--all"],
    inputs: ARTICLES,
    fast: true,
  },
  {
    id: "reviewer-check",
    tier: "soft",
    label: "reviewer agent",
    args: ["tools/reviewer-check.mjs", "--all"],
    inputs: ARTICLES,
    fast: true,
  },
  {
    id: "link-integrity",
    tier: "hard",
    label: "internal targets in dist",
    args: ["tools/link-integrity.mjs"],
    inputs: [],
    fast: true,
  },
  {
    id: "link-check",
    tier: "hard",
    label: "internal links",
    args: ["tools/link-check.mjs"],
    inputs: ARTICLES,
    fast: true,
  },
  {
    id: "check-structured-data",
    tier: "soft",
    label: "structured data",
    args: ["tools/check-structured-data.mjs"],
    inputs: ["dist"],
    fast: true,
  },
  {
    /*
     * Contrast, computed rather than reviewed.
     *
     * Two greys sat below WCAG AA for eighteen months while carrying .sources and .disclaimer - the block
     * listing where every figure came from, and the note about what the figures cannot tell you. Nobody computes
     * contrast by looking, so the only way to keep it fixed is to compute it on every build.
     *
     * It reads src/styles/global.css, not dist, so it costs microseconds and needs no build.
     */
    id: "check-contrast",
    tier: "soft",
    label: "text contrast",
    args: ["tools/check-contrast.mjs"],
    inputs: ["src/styles"],
    fast: true,
  },
  {
    /*
     * Titles and descriptions as a search result shows them: 60 display columns for a title, 155 for a
     * description, both unique across the site. It read 174 violations the first time it ran - the longest
     * title was 125 columns - and zero after the pages were wired to fitTitle/fitDescription.
     *
     * Soft, and on the publish path anyway: it costs about a second, needs no network, and a duplicate title
     * between two articles is cheap to prevent and expensive to discover.
     */
    id: "check-meta",
    tier: "soft",
    label: "titles and descriptions",
    args: ["tools/check-meta.mjs"],
    inputs: ["dist"],
    fast: true,
  },
  {
    id: "check-csp",
    tier: "soft",
    label: "content security policy",
    args: ["tools/check-csp.mjs"],
    inputs: ["dist"],
    fast: true,
  },
  {
    id: "serp-check",
    tier: "slow",
    label: "information gain (network)",
    args: ["tools/serp-check.mjs", "--all", "--serp=file:data/serp"],
    inputs: [...ARTICLES, "data/serp"],
    fast: false,
  },
  {
    id: "check-mobile",
    tier: "slow",
    label: "mobile layout (browser)",
    args: ["tools/check-mobile.mjs"],
    inputs: ["dist"],
    fast: false,
  },
  /*
   * Vocabulary parity, added as a hard gate on 2026-10-26.
   *
   * It existed before but nothing ran it: no workflow, no gate entry, and one tool mentioned it
   * in a comment. So when the categories were replaced, the copy in src/lib/schema-rules.mjs kept
   * telling the writer that `trade-policy` and `importer` were legal, and no check noticed. A rule that
   * nothing executes is documentation.
   *
   * Hard, not soft: the two sides it compares are the schema and the writer's instructions, and a
   * disagreement means an article that passes the writer and fails the build.
   */
  {
    id: "check-schema-parity",
    tier: "hard",
    label: "schema and vocabulary parity",
    args: ["tools/check-schema-parity.mjs"],
    inputs: [
      "src/content.config.ts",
      "src/lib/schema-rules.mjs",
      "src/lib/taxonomy.json",
      "src/lib/writer-prompt.mjs",
    ],
    fast: true,
  },
];

/* ------------------------------------------------------------------ run them */

const cache = FRESH ? {} : loadCache();

function runOne(gate) {
  const key = hashPaths(gate.inputs);
  const hit = cache[gate.id];
  if (!FRESH && hit && hit.key === key) {
    return { ...gate, ms: 0, status: hit.status, cached: true, out: hit.out ?? "" };
  }
  const t = Date.now();
  const r = spawnSync(NODE, gate.args, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const ms = Date.now() - t;
  /*
   * A signalled gate is not a verdict. Same reasoning as the parallel branch: caching the output of an
   * interrupted run stores a FAIL that no later invocation will re-derive, because the input hash has
   * not changed. Only a clean exit is remembered.
   */
  if (r.signal) {
    return { ...gate, ms, status: r.status ?? 1, cached: false, out: out + `\n[gate killed by ${r.signal}; not cached]` };
  }
  cache[gate.id] = { key, status: r.status ?? 1, out: out.slice(-4000) };
  return { ...gate, ms, status: r.status ?? 1, cached: false, out };
}

const start = Date.now();
const results = [];

// The cheap ones are independent processes reading the same files: run them together.
/*
 * --tier=hard|soft|slow  run only that tier.
 *
 * Without it every gate runs, which is what a manual full check wants. With it the publish path can ask
 * for the tier that is allowed to block and skip the two that need the network, so a flaky fetch cannot
 * cost a day's publishing.
 */
const tierArg = process.argv.find((a) => a.startsWith("--tier="));
const TIER_FILTER = tierArg ? tierArg.slice("--tier=".length) : null;
const SELECTED = TIER_FILTER ? GATES.filter((g) => g.tier === TIER_FILTER) : GATES;
if (TIER_FILTER && !SELECTED.length) {
  console.log(`no gate has tier "${TIER_FILTER}". Known tiers: hard, soft, slow.`);
  process.exit(2);
}

const fastGates = SELECTED.filter((g) => g.fast);
const slowGates = SELECTED.filter((g) => !g.fast);

const pending = fastGates.map(
  (g) => new Promise((resolve) => {
    const key = hashPaths(g.inputs);
    const hit = cache[g.id];
    if (!FRESH && hit && hit.key === key) { resolve({ ...g, ms: 0, status: hit.status, cached: true, out: hit.out ?? "" }); return; }
    const t = Date.now();
    const child = spawn(NODE, g.args, { cwd: ROOT });
    let buf = "";
    child.stdout.on("data", (d) => (buf += d));
    child.stderr.on("data", (d) => (buf += d));
    child.on("close", (code, signal) => {
      /*
       * A gate killed by a signal is not a verdict, and must not be cached.
       *
       * This is not hypothetical. A cold full run takes fifteen minutes on this machine because
       * serp-check fetches competitor pages; interrupting one leaves whatever the child managed to
       * print, and caching that records a FAIL produced by an incomplete run. The next invocation then
       * reuses it, because the input hash has not changed - so a killed run poisons every run after it
       * until someone deletes .cache/gates.json. That happened four times on 2026-10-16, each time
       * reporting a mobile overflow on a different page, and each page passed when measured on its own.
       *
       * Only a clean exit is cached. A signalled exit is reported as a failure for this run and not
       * remembered, which is the conservative direction: a check that runs again costs time, a check
       * that remembers a wrong answer costs trust.
       */
      if (signal) {
        resolve({ ...g, ms: Date.now() - t, status: code ?? 1, cached: false, out: buf + `\n[gate killed by ${signal}; not cached]` });
        return;
      }
      cache[g.id] = { key, status: code ?? 1, out: buf.slice(-4000) };
      resolve({ ...g, ms: Date.now() - t, status: code ?? 1, cached: false, out: buf });
    });
  }),
);

for (const r of await Promise.all(pending)) results.push(r);
for (const g of slowGates) results.push(runOne(g));

saveCache(cache);

/* ------------------------------------------------------------------ report */

const totalMs = Date.now() - start;
const failed = results.filter((r) => r.status !== 0);
/* A soft failure is reported and does not change the exit code; the caller decides what to do with it. */
const failedHard = failed.filter((r) => (r.tier ?? "hard") !== "soft" && (r.tier ?? "hard") !== "slow");

if (JSON_OUT) {
  console.log(JSON.stringify({ totalMs, results: results.map(({ id, label, status, ms, cached }) => ({ id, label, status, ms, cached })) }, null, 2));
} else {
  console.log("GATES\n" + "=".repeat(78));
  for (const r of results.sort((a, b) => b.ms - a.ms)) {
    const mark = r.status === 0 ? "ok  " : "FAIL";
    const tag = r.cached ? "cached" : `${(r.ms / 1000).toFixed(1)}s`;
    console.log(`  ${mark} ${tag.padStart(7)}  ${r.label}`);
  }
  console.log(`\n  total ${(totalMs / 1000).toFixed(1)}s   cached ${results.filter((r) => r.cached).length}/${results.length}`);

  if (failed.length) {
    console.log(`\n${failed.length} GATE(S) FAILED:\n`);
    for (const r of failed) {
      const tail = r.out.split("\n").filter((l) => /BLOCK|FAIL|UNSUPPORTED|problem|✗/.test(l)).slice(0, 5);
      console.log(`  --- ${r.label} (exit ${r.status}) ---`);
      for (const l of tail) console.log(`     ${l.trim().slice(0, 120)}`);
      console.log("");
    }
  } else {
    console.log("\nRESULT: every gate passed");
  }
}

process.exit(failed.length ? 1 : 0);
