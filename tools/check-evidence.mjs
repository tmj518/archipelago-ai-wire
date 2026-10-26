/**
 * Check that a figure's evidence actually appears in the archived document it cites.
 *
 *   node tools/check-evidence.mjs <article.md>
 *   node tools/check-evidence.mjs --directive=data/directive.json
 *   node tools/check-evidence.mjs --draft=data/drafts/<slug>.md --json
 *   node tools/check-evidence.mjs --selftest        prove it can fail
 *
 * ## Why this exists, and why it is the precondition for unattended research
 *
 * Every other check reads what the writer wrote. L2 confirms a figure carries a source string, L4
 * confirms the piece does not narrate an invented experience, L5 has a second model read it for
 * internal consistency. None of them opens the document. So a figure can carry a real citation to a
 * real instrument and still be wrong, and nothing in the pipeline can tell.
 *
 * That is tolerable while a person reads the primary document before writing. It stops being
 * tolerable the moment the pipeline chooses its own subjects and finds its own numbers, because then
 * the same model that writes the figure also decides that the figure is supported.
 *
 * This closes it by making the claim checkable. A figure carries `evidence`, a verbatim excerpt from
 * the source, and `evidence_from`, a path to an archived copy. This script opens the archive, strips
 * the markup, and looks for the excerpt. A number that was never in the document cannot be accompanied
 * by an excerpt that is, and inventing an excerpt is the same work as reading the file.
 *
 * ## What it does not do
 *
 * It cannot tell whether the source is right, only whether we quoted it correctly. It cannot catch a
 * genuine sentence read to mean the opposite of what it says. And an excerpt plucked from a different
 * part of the document than the number proves citation, not relevance - which is why the excerpt is
 * required to contain the value itself, not merely to exist somewhere in the file.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

/** Everything a document says, as one searchable string. */
function textOf(file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "latin1");
  /*
   * Markup is stripped and whitespace normalised. Entities and non-breaking spaces are decoded
   * because an excerpt typed by a person will not contain them, and a mismatch on an invisible
   * character would look like a fabricated number.
   */
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\u202f\u2009]/g, " ")
    .replace(/\s+/g, " ");
}

/** Normalise a needle the same way, so punctuation and spacing do not decide the answer. */
const norm = (s) => String(s ?? "").replace(/&nbsp;/g, " ").replace(/[\u00a0\u202f\u2009]/g, " ").replace(/\s+/g, " ").trim();

/** The value as it would appear in a document: strip formatting a human added. */
function valueVariants(value) {
  const v = norm(value);
  const bare = v.replace(/[$,]/g, "").replace(/%$/, "");
  const out = new Set([v, bare]);
  /* 17.45% is written as 17.45 in the source more often than not. */
  if (/%$/.test(v)) out.add(v.replace(/%$/, ""));
  if (/^\d+(\.\d+)?$/.test(bare)) out.add(bare.replace(/\.0+$/, ""));
  return [...out].filter((x) => x.length >= 2);
}

function checkOne({ value, evidence, evidence_from, source }, docCache) {
  const problems = [];
  if (!evidence) problems.push("no evidence excerpt");
  if (!evidence_from) problems.push("no evidence_from path");
  if (problems.length) return { value, ok: false, problems };

  if (!(evidence_from in docCache)) docCache[evidence_from] = textOf(evidence_from);
  const doc = docCache[evidence_from];
  if (doc === null) return { value, ok: false, problems: [`evidence_from does not exist: ${evidence_from}`] };

  const needle = norm(evidence);
  if (!doc.includes(needle)) {
    /* Report what is nearby, so a near miss can be told from an invention. */
    const first = needle.split(" ").slice(0, 4).join(" ");
    const at = doc.indexOf(first);
    const near = at >= 0 ? doc.slice(Math.max(0, at - 80), at + 160) : doc.slice(0, 200);
    return { value, ok: false, problems: ["the excerpt is not in the archived document"], near };
  }

  /*
   * The excerpt must also contain the value. An excerpt that exists but does not carry the number
   * proves only that we quoted something, and the failure mode this guards against is a real sentence
   * attached to a figure it does not support.
   */
  const hay = norm(evidence).replace(/[$,]/g, "");
  const carried = valueVariants(value).some((v) => hay.includes(v.replace(/[$,]/g, "")));
  if (!carried) {
    return { value, ok: false, problems: [`the excerpt exists but does not contain the value "${norm(value)}"`], near: needle.slice(0, 200) };
  }

  return { value, ok: true, source: source ? String(source).slice(0, 70) : "" };
}

/* ---------------------------------------------------------------- selftest */

if (args.includes("--selftest")) {
  /*
   * A checker that has never failed has no discriminating power, so it is given two fixtures it must
   * reject before it is trusted to pass anything: a number that is not in the archive, and a real
   * excerpt that does not carry the number.
   */
  const doc = "data/sources/2026-10-16/eurlex-oj-c-2026-4924-ad760-notice.txt";
  if (!existsSync(join(ROOT, doc))) {
    console.log("  selftest needs " + doc);
    process.exit(2);
  }
  const cases = [
    {
      name: "invented value with an invented excerpt",
      figure: { value: "99.99%", evidence: "the duty shall be 99.99 per cent of the net free-at-Union-frontier price", evidence_from: doc },
      expect: false,
    },
    {
      name: "invented value with a REAL excerpt",
      figure: { value: "99.99%", evidence: "provisional measures may be imposed not later than seven months", evidence_from: doc },
      expect: false,
    },
    {
      name: "real excerpt that exists in the document",
      figure: { value: "seven", evidence: "provisional measures may be imposed not later than seven months", evidence_from: doc },
      expect: true,
    },
    {
      name: "missing archive",
      figure: { value: "1%", evidence: "anything", evidence_from: "data/sources/2026-10-16/does-not-exist.txt" },
      expect: false,
    },
    {
      name: "no evidence field",
      figure: { value: "1%", evidence_from: doc },
      expect: false,
    },
  ];
  let pass = 0;
  let fail = 0;
  console.log("EVIDENCE CHECK SELFTEST\n" + "=".repeat(78));
  const cache = {};
  for (const c of cases) {
    const r = checkOne(c.figure, cache);
    const good = r.ok === c.expect;
    if (good) pass++;
    else fail++;
    console.log(`  ${good ? "ok  " : "FAIL"}  expect ${c.expect ? "PASS" : "REJECT"}  got ${r.ok ? "PASS" : "REJECT"}  ${c.name}`);
    if (!r.ok && r.problems) for (const p of r.problems) console.log(`           ${p}`);
  }
  console.log(`\n  ${pass} correct, ${fail} wrong`);
  console.log(fail ? "  ★ the checker is not discriminating; do not trust it yet" : "  ★ it rejects what it must and accepts what it must");
  process.exit(fail ? 1 : 0);
}

/* ---------------------------------------------------------------- load targets */

function figuresFromFile(path) {
  const t = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const j = JSON.parse(t);
    return { label: j.slug ?? path, figures: (j.figures ?? []).map((f) => ({ ...f })) };
  }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? "";
  const block = fm.split(/^figures:\s*$/m)[1]?.split(/^\w+:/m)[0] ?? "";
  const out = [];
  let cur = null;
  for (const line of block.split(/\r?\n/)) {
    const start = /^\s{2}- (\w+):\s*(.*)$/.exec(line);
    if (start) {
      if (cur) out.push(cur);
      cur = { [start[1]]: start[2].trim().replace(/^"|"$/g, "") };
      continue;
    }
    const cont = /^\s{4}(\w+):\s*(.*)$/.exec(line);
    if (cont && cur) cur[cont[1]] = cont[2].trim().replace(/^"|"$/g, "");
  }
  if (cur) out.push(cur);
  return { label: path.replace(/\\/g, "/").split("/").pop(), figures: out };
}

const explicit = flag("directive", null) ?? flag("draft", null) ?? args.find((a) => a.endsWith(".md"));
let targets = [];
if (flag("directive", null)) targets = [{ path: flag("directive"), kind: "directive" }];
else if (explicit) targets = [{ path: explicit, kind: explicit.endsWith(".json") ? "directive" : "article" }];
else if (args.includes("--all")) {
  targets = readdirSync(join(ROOT, "src", "content", "blog"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ path: join("src", "content", "blog", f), kind: "article" }));
} else {
  console.log("usage: node tools/check-evidence.mjs <article.md> | --directive=... | --all | --selftest");
  process.exit(2);
}

/* ---------------------------------------------------------------- run */

const cache = {};
const results = [];
for (const t of targets) {
  const p = join(ROOT, t.path);
  if (!existsSync(p)) {
    results.push({ label: t.path, error: "not found", checked: 0, failed: [] });
    continue;
  }
  const { label, figures } = figuresFromFile(p);
  /* Figures that are our own arithmetic have no document to point at and are out of scope. */
  const external = figures.filter((f) => !/landed math|model|calculated|this article|worked example|reader input|^Calculated:/i.test(`${f.source} ${f.period}`));
  const failed = [];
  let checked = 0;
  for (const f of external) {
    checked++;
    const r = checkOne(f, cache);
    if (!r.ok) failed.push(r);
  }
  results.push({ label: label || t.path, path: t.path, checked, failed, ownArithmetic: figures.length - external.length });
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`EVIDENCE CHECK\n${"=".repeat(84)}`);
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label}: ${r.error}`);
      continue;
    }
    console.log(`\n  ${r.label}`);
    console.log(`    external figures checked : ${r.checked}`);
    console.log(`    our own arithmetic       : ${r.ownArithmetic} (out of scope)`);
    console.log(`    failed                   : ${r.failed.length}`);
    for (const f of r.failed.slice(0, 8)) {
      console.log(`      "${f.value}"  ${f.problems.join("; ")}`);
      if (f.near) console.log(`        nearest text: ${String(f.near).slice(0, 150)}`);
    }
  }
  const totalChecked = results.reduce((a, r) => a + (r.checked ?? 0), 0);
  const totalFailed = results.reduce((a, r) => a + (r.failed?.length ?? 0), 0);
  console.log(`\n${"=".repeat(84)}`);
  console.log(`  ${totalChecked} figure(s) checked, ${totalFailed} failed`);
  if (totalChecked && !totalFailed) {
    console.log("  Every external figure's excerpt was found in its archived document, carrying its value.");
  } else if (!totalChecked) {
    console.log("  Nothing to check. On a corpus written before this field existed that is expected:");
    console.log("  the figures carry a source name and no archived excerpt. Run --selftest to see the");
    console.log("  checker reject the cases it must before relying on its silence.");
  }
}

process.exit(results.some((r) => (r.failed?.length ?? 0) > 0) ? 1 : 0);
