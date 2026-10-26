import { readdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Rebuild the instrument registry with a correct frontmatter parser.
 *
 * The first version grepped line by line for `retrieved:` and came back empty for all 207
 * figures. The cause is real rather than a typo: `unit` and `period` are long sentences
 * that the frontmatter wraps across several lines, and a line-oriented regex reads the
 * continuation lines as if they were new keys. A parser that tracks indentation is the fix;
 * patching the regex would leave the same class of bug for the next long field.
 *
 * This is a deliberately small subset of YAML - the shapes Astro content actually uses in
 * this repository:
 *
 *   key: value
 *   key: "quoted value"
 *   key:
 *     - value            (a list of scalars)
 *     - key: value       (a list of maps, with continued keys aligned under the first)
 *         key: value
 *
 * Anything it does not understand is reported rather than silently dropped, because a
 * registry that quietly loses figures is worse than one that fails.
 */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const root = {};
  let i = 0;

  const indentOf = (l) => l.match(/^ */)[0].length;
  const scalar = (v) => {
    v = v.trim();
    if (v === "") return "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1).replace(/\\"/g, '"');
    }
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const keyM = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!keyM) { i++; continue; }
    const [, pad, key, rest] = keyM;
    const baseIndent = pad.length;

    if (rest.trim() === "") {
      // Either a list or a nested map. Look at the next non-empty line.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^\s*-\s/.test(lines[j])) {
        const items = [];
        while (j < lines.length && (/^\s*-\s/.test(lines[j]) || (lines[j].trim() && indentOf(lines[j]) > baseIndent && !/^\s*-\s/.test(lines[j])))) {
          const li = lines[j];
          if (/^\s*-\s/.test(li)) {
            const after = li.replace(/^\s*-\s*/, "");
            const inlineKey = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(after);
            if (inlineKey) {
              // A list of maps: the first key sits on the dash line, the rest follow.
              const obj = {};
              if (inlineKey[2].trim() !== "") obj[inlineKey[1]] = scalar(inlineKey[2]);
              const itemIndent = indentOf(li);
              j++;
              while (j < lines.length) {
                const cont = lines[j];
                if (!cont.trim()) { j++; continue; }
                if (/^\s*-\s/.test(cont)) break;
                if (indentOf(cont) <= itemIndent - 1) break;
                const ck = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(cont);
                if (!ck) break;
                obj[ck[1]] = scalar(ck[2]);
                j++;
              }
              items.push(obj);
              continue;
            }
            items.push(scalar(after));
            j++;
            continue;
          }
          j++;
        }
        root[key] = items;
        i = j;
        continue;
      }
      // Nested map, one level.
      const obj = {};
      j = i + 1;
      while (j < lines.length) {
        const cont = lines[j];
        if (!cont.trim()) { j++; continue; }
        if (indentOf(cont) <= baseIndent) break;
        const ck = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(cont);
        if (!ck) break;
        obj[ck[1]] = scalar(ck[2]);
        j++;
      }
      root[key] = obj;
      i = j;
      continue;
    }
    root[key] = scalar(rest);
    i++;
  }
  return root;
}

/* ------------------------------------------------------------------ build */

/**
 * --check regenerates in memory and compares against what is committed.
 *
 * The registry is derived from the article frontmatter, so it goes stale the moment a new
 * article adds figures from a document that crosses the depth threshold. Stale here is
 * invisible: the pages still build, they are simply missing. preflight runs this with
 * --check so the drift surfaces before a deploy rather than months later.
 */
const CHECK_ONLY = process.argv.includes("--check");
const OUT = "src/data/instruments.json";

const DIR = "src/content/blog";
const figures = [];
const articles = [];

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
  const raw = readFileSync(`${DIR}/${f}`, "utf8");
  const fm = parseFrontmatter(raw);
  if (!fm || fm.draft === true) continue;
  const slug = f.replace(/\.md$/, "");
  articles.push({ slug, num: fm.articleNumber ?? 0, title: fm.title ?? "", category: fm.category ?? "" });

  const list = Array.isArray(fm.figures) ? fm.figures : [];
  for (const fig of list) {
    if (typeof fig !== "object" || fig === null) continue;
    figures.push({
      articleSlug: slug,
      articleNum: fm.articleNumber ?? 0,
      value: String(fig.value ?? "").trim(),
      unit: String(fig.unit ?? "").trim(),
      period: String(fig.period ?? "").trim(),
      source: String(fig.source ?? "").trim(),
      retrieved: String(fig.retrieved ?? "").trim(),
    });
  }
}

console.log("PARSE RESULT\n" + "=".repeat(80));
console.log(`  articles parsed (published): ${articles.length}`);
console.log(`  figure records             : ${figures.length}`);

/*
 * "X news article" and "X" are one document, not two.
 *
 * The registry carried both strings for the European Commission's DG Trade page, so slugify() produced
 * two ids and the site published two instrument pages whose titles are identical once truncated - the
 * metadata gate's only remaining complaint on 2026-10-21, and a duplicate page for a reader.
 *
 * Narrow on purpose: a source is merged ONLY when the bare form is also present. Three sources end in
 * "news article"; stripping unconditionally would change the slug - and therefore the URL - of the two
 * that have no twin.
 */
const sources = new Set(figures.map((f) => String(f.source ?? "").trim()));
for (const f of figures) {
  const s = String(f.source ?? "").trim();
  const bare = s.replace(/\s*news article$/i, "").trim();
  if (bare !== s && sources.has(bare)) f.source = bare;
}

const missing = figures.filter((f) => !f.value || !f.unit || !f.period || !f.source || !f.retrieved);
console.log(`  records missing any of the five fields: ${missing.length}`);
for (const f of missing.slice(0, 8)) {
  console.log(`     ${f.articleSlug} value="${f.value}"  missing: ${["value", "unit", "period", "source", "retrieved"].filter((k) => !f[k]).join(", ")}`);
}

// Sanity: the five-part rule is a blocking gate, so every published figure should have all five.
if (missing.length) {
  console.log("\n  !! the parser or the content is wrong - not writing the registry");
  process.exit(1);
}

const retrieved = [...new Set(figures.map((f) => f.retrieved))].sort();
console.log(`  distinct retrieval dates   : ${retrieved.length}  (${retrieved[0]} .. ${retrieved[retrieved.length - 1]})`);

/* ------------------------------------------------------------------ registry */

const docKey = (s) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "").slice(0, 72);

function slugify(src) {
  const cleaned = src
    .replace(/^Archipelago AI Wire[^,]*,\s*/i, "")
    .replace(/[\u4e00-\u9fff]+/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  let out = cleaned.split(/\s+/).slice(0, 9).join("-").slice(0, 60).replace(/-+$/, "");
  if (out.length < 6) out = "instrument-" + out;
  return out;
}

const isModelOutput = (s) => /^Archipelago AI Wire\b/i.test(s.trim()) || /priceDrift\(\)|freightAdjustment\(\)/.test(s);

const byDoc = new Map();
for (const f of figures) {
  const k = docKey(f.source);
  if (!byDoc.has(k)) byDoc.set(k, { source: f.source, figs: [] });
  byDoc.get(k).figs.push(f);
}

const candidates = [...byDoc.values()].map((d) => ({
  id: slugify(d.source),
  source: d.source,
  figures: d.figs,
  articleNums: [...new Set(d.figs.map((f) => f.articleNum))].sort((a, b) => a - b),
  articleSlugs: [...new Set(d.figs.map((f) => f.articleSlug))],
  modelOutput: isModelOutput(d.source),
}));

const seen = new Set();
for (const c of candidates.sort((a, b) => a.source.localeCompare(b.source))) {
  if (seen.has(c.id)) c.id = `${c.id}-${c.articleNums[0] ?? 0}`;
  seen.add(c.id);
}

const selected = candidates
  .filter((c) => !c.modelOutput)
  .filter((c) => c.figures.length >= 2 || c.articleNums.length >= 2)
  .sort((a, b) => b.figures.length - a.figures.length || a.source.localeCompare(b.source));

const payload = { generated: new Date().toISOString().slice(0, 10), instruments: selected };
const serialised = JSON.stringify(payload, null, 2);

if (CHECK_ONLY) {
  let current = null;
  try { current = readFileSync(OUT, "utf8"); } catch { /* not generated yet */ }
  if (current === null) {
    console.log(`\n  STALE: ${OUT} does not exist - run node tools/build-instruments.mjs`);
    process.exit(1);
  }
  // Compare the instrument list, not the generation date: the date changes daily and
  // would report drift every single run.
  const sameList = JSON.stringify(JSON.parse(current).instruments) === JSON.stringify(selected);
  if (sameList) {
    console.log(`\n  up to date: ${selected.length} instruments`);
    process.exit(0);
  }
  const before = new Set(JSON.parse(current).instruments.map((i) => i.id));
  const after = new Set(selected.map((i) => i.id));
  const added = [...after].filter((x) => !before.has(x));
  const removed = [...before].filter((x) => !after.has(x));
  console.log(`\n  STALE: the registry does not match the articles.`);
  if (added.length) console.log(`     would be added  : ${added.join(", ")}`);
  if (removed.length) console.log(`     would be removed: ${removed.join(", ")}`);
  if (!added.length && !removed.length) console.log(`     same set of instruments, different figures per instrument`);
  console.log(`     run: node tools/build-instruments.mjs`);
  process.exit(1);
}

writeFileSync(OUT, serialised, "utf8");

console.log("\nREGISTRY\n" + "=".repeat(80));
console.log(`  distinct documents : ${byDoc.size}`);
console.log(`  model output (excluded): ${candidates.filter((c) => c.modelOutput).length}`);
console.log(`  pages written      : ${selected.length}`);
console.log(`  figures covered    : ${selected.reduce((a, c) => a + c.figures.length, 0)} of ${figures.length}`);
console.log(`  wrote src/data/instruments.json`);
