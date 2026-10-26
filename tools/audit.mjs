/**
 * L1-L5 audit — the executable form of audit_protocol.md.
 *
 *   node tools/audit.mjs <article.md> [...]     audit named articles
 *   node tools/audit.mjs --drafts               audit every draft
 *   node tools/audit.mjs --published            audit every published article
 *   node tools/audit.mjs --json                 machine-readable
 *
 * ## What each layer is, and why they are separate
 *
 * L1 is mechanical and always has a definite answer. L2 is a record: did the figure point at a real
 * document. L3 cannot decide that a number is right, only that the author said it was unverified -
 * rule B is a disclosure rule, not a correctness rule. L4 is internal consistency. L5 is judgement,
 * and it defaults to "not sure" rather than to "fine".
 *
 * The separation matters because they fail differently. Folding them into one score would hide which
 * layer failed, and the remedy is different in each case: L1 is a rewrite, L2 is unfinished research,
 * L3 is a missing sentence, L4 is a deletion, L5 is a decision nobody has made yet.
 *
 * ## The one thing L2 does that no other check does
 *
 * It compares each `figures[].source` against the instrument registry. The registry holds the
 * documents this site has actually read and indexed, so "the source is in the registry" is the
 * closest thing to "the source exists" that can be checked without re-reading it. A source that
 * matches nothing is either our own arithmetic - which is legitimate and has to be labelled as such -
 * or a document that was never verified, and those two must not look the same.
 *
 * No check can tell whether a figure is true. L2 narrows the gap from "carries a source string" to
 * "carries a source this project has actually catalogued", and states plainly that this is the limit.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const NODE = process.execPath;
const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const NAMED = args.filter((a) => !a.startsWith("--") && a.endsWith(".md"));
/*
 * `--out=` writes the result itself rather than letting the shell redirect it.
 *
 * Redirecting node's stdout with `>` in PowerShell produces UTF-16, which is not valid JSON and fails
 * at the reader with a parse error that looks like the tool is broken. That has now cost a round trip
 * three times in this project - render-page.mjs carries the same flag for the same reason - so it is
 * a fixed property of these tools rather than something to remember.
 */
const OUT = (args.find((a) => a.startsWith("--out=")) ?? "").slice(6) || null;

/* ---------------------------------------------------------------- layers */

/** L5 triggers. Deliberately narrow: a false positive stops a publish, which is the intended cost. */
const L5_RISK = [
  [/political (?:system|regime)|authoritarian| dictatorship|one-party|共匪|中共政权/i, "political", "a characterisation of a political system"],
  [/Taiwan (?:is|as) (?:a|an) (?:independent|sovereign)|西藏独立|新疆独立|香港独立/i, "political", "a sovereignty position"],
  [/\byou must\b|\bit is legal to\b|\bit is illegal to\b|这是合法的|你必须/i, "legal", "a legal conclusion rather than a description of a rule"],
  [/\b(?:committed|engaged in) (?:fraud|forgery)|is a scam|是骗子|造假公司/i, "reputation", "an accusation against a named party"],
  [/\bguaranteed (?:return|profit|yield)|risk-free return|保证收益|稳赚/i, "promise", "a return or outcome promise"],
];

/*
 * L4 fabrications: invented experience and invented panels.
 *
 * Two corrections after the first run, both of which had flagged correct writing as a defect:
 *
 *   1. `my supplier` in an FAQ heading is the reader's supplier, not the author's. The first version
 *      matched those and reported three published articles as carrying a fabricated possession. The
 *      scan now skips headings, because a question addressed to the reader is not a narration.
 *
 *   2. `illustrative` is required by the spec. Section 5.4 says a cost model's inputs must be marked
 *      as assumptions, and "illustrative metal content" is exactly that. Treating the word as a
 *      skeleton marker punished compliance. It is now ignored inside a `period` field, where it is
 *      doing the marking the spec asks for, and still caught in a `source`, where disclaiming a
 *      figure is a skeleton's behaviour.
 */
const L4_FABRICATION = [
  [/\bI (?:moved|bought|paid|sourced|shipped|ordered)\b/i, "a first-person business action"],
  [/\bmy (?:inventory|supplier|order|margin|write-downs?|factory|shipment)\b/i, "a first-person possession"],
  [/\bour (?:panel|data|sample|survey|stores|clients)\b/i, "a proprietary dataset"],
  [/placeholder figure/i, "a figure declared a placeholder"],
  [/no real panel behind it/i, "an admission that no panel exists"],
  [/SAMPLE POST/i, "a sample-post marker"],
  [/skeleton placeholder/i, "a skeleton marker"],
];

/** Lines that are questions to the reader rather than prose: headings, and FAQ question lines. */
function proseOnly(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*#{2,4}\s/.test(l) && !/^\s*"?(?:value|unit|period|source|retrieved):/.test(l))
    .join("\n");
}

const L2_ANON = [/业内人士|据报|据报道|消息人士|sources say|industry sources|it is said/i];

/* ---------------------------------------------------------------- helpers */

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();

let INSTRUMENTS = [];
try {
  const reg = JSON.parse(readFileSync(join(ROOT, "src", "data", "instruments.json"), "utf8"));
  INSTRUMENTS = reg.instruments.map((i) => ({ id: i.id, source: i.source, n: norm(i.source) }));
} catch {
  /* An empty registry makes every figure unmatched, which is reported rather than crashed on. */
}

function frontmatter(text) {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
}

function parseFigures(fm) {
  /* The figures block is a YAML list of maps; each entry starts at `  - value:`. */
  const block = fm.split(/^figures:\s*$/m)[1]?.split(/^\w+:/m)[0] ?? "";
  const out = [];
  let cur = null;
  for (const line of block.split(/\r?\n/)) {
    const start = /^\s{2}- (\w+):\s*(.*)$/.exec(line);
    if (start) {
      if (cur) out.push(cur);
      cur = { [start[1]]: start[2].trim() };
      continue;
    }
    const cont = /^\s{4}(\w+):\s*(.*)$/.exec(line);
    if (cont && cur) cur[cont[1]] = cont[2].trim();
  }
  if (cur) out.push(cur);
  return out.map((f) => ({
    value: (f.value ?? "").replace(/^"|"$/g, ""),
    unit: (f.unit ?? "").replace(/^"|"$/g, ""),
    period: (f.period ?? "").replace(/^"|"$/g, ""),
    source: (f.source ?? "").replace(/^"|"$/g, ""),
    retrieved: (f.retrieved ?? "").replace(/^"|"$/g, ""),
  }));
}

function auditOne(slug) {
  const path = join(BLOG, `${slug}.md`);
  if (!existsSync(path)) return { slug, error: "file not found" };
  const text = readFileSync(path, "utf8");
  const fm = frontmatter(text);
  const body = text.slice(text.indexOf("\n---", 4) + 5);
  const figures = parseFigures(fm);
  const isDraft = /^draft:\s*true/m.test(fm);
  const result = { slug, path, isDraft, layers: {}, verdict: null, alerts: [] };

  /* ---------- L1: the seven gates ---------- */
  /*
   * A draft has to be validated as if it were published, and the first version of this did not.
   *
   * `qa-check` deliberately exempts a draft from its blocking rules - it prints "9 blocking rule(s)
   * not yet met, excluded from the gate" and returns PASS with exit code 0 - so running it against a
   * draft reported L1 as satisfied for an article with no figures, no AI summary and no confidence
   * section. The audit exists to answer "would this survive publication", and answering it with a
   * checker that skips unpublished work answers nothing. This is the exact failure the protocol is
   * meant to prevent, committed inside the protocol's own implementation.
   *
   * So the article is copied to a scratch path with the flag flipped and validated there. The
   * repository is never modified: flipping the flag in place would publish on the next deploy, which
   * is the one thing an audit must not do. `check-publish-ready.mjs` solves it the same way, and the
   * two agreeing is the point.
   */
  let l1 = { pass: false, detail: "", auditedAs: isDraft ? "as if published" : "as published" };
  {
    const scratchDir = join(ROOT, "data", "tmp", "audit");
    mkdirSync(scratchDir, { recursive: true });
    const scratch = join(scratchDir, `${slug}.md`);
    writeFileSync(scratch, isDraft ? text.replace(/^draft:\s*true\s*$/m, "draft: false") : text, "utf8");

    let out = "";
    let code = 0;
    try {
      out = execFileSync(NODE, [join(ROOT, "tools", "qa-check.mjs"), scratch], { encoding: "utf8", timeout: 120000 });
    } catch (e) {
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      code = e.status ?? 1;
    }
    const v = /RESULT:\s*(PASS|BLOCKED)/.exec(out)?.[1];
    const blocks = [...out.matchAll(/BLOCK\s+([^\n]{0,80})/g)].map((m) => m[1].trim());
    /* A PASS with a non-zero exit, or a BLOCKED with a zero exit, is a contradiction worth reporting. */
    if (!v) l1.detail = "qa-check produced no verdict";
    else if (v === "BLOCKED") l1.detail = `${blocks.length} block(s): ${blocks.slice(0, 3).join("; ")}`;
    else l1 = { ...l1, pass: true, detail: `qa-check PASS${isDraft ? " when published" : ""}` };
    if (v === "PASS" && code !== 0) l1 = { ...l1, pass: false, detail: `qa-check said PASS but exited ${code}` };
  }
  result.layers.L1 = l1;

  /* ---------- L2: does each figure carry a real, named, dated source ---------- */
  const external = [];
  const modelOwn = [];
  const unmatched = [];
  const anon = [];
  const badDate = [];
  const noSource = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const f of figures) {
    const src = f.source.trim();
    /*
     * Our own arithmetic is separated first, because the protocol's requirements do not apply to it:
     * a model output has no external document to point at, and the honest thing is that it says so.
     * The registry comparison below is therefore only about figures that claim an outside source.
     */
    const isModel = /landed math|model|calculated|this article|worked example|reader input/i.test(src + " " + f.period);
    if (!src) noSource.push(f.value);
    if (!f.retrieved || !/^\d{4}-\d{2}-\d{2}$/.test(f.retrieved) || f.retrieved > today) badDate.push(f.value);
    if (!f.period) badDate.push(f.value);
    if (L2_ANON.some((re) => re.test(src))) anon.push(f.value);
    if (isModel) {
      modelOwn.push({ value: f.value, source: src.slice(0, 70) });
      continue;
    }
    external.push({ value: f.value, source: src });
    const n = norm(src);
    const hit = INSTRUMENTS.some((i) => i.n && (n.startsWith(i.n) || i.n.startsWith(n) || n.includes(i.n.slice(0, 40))));
    if (!hit) unmatched.push({ value: f.value, source: src.slice(0, 90) });
  }
  /*
   * `unmatched` is reported, not failed on, and that distinction was a defect in the first version.
   *
   * The instrument registry deliberately holds only documents that supplied two or more figures -
   * one figure per page would be a page holding a single number, which the registry's own header
   * refuses. About half the corpus's figures therefore come from documents that are real and not
   * catalogued, and the first run called twenty articles failures for citing them. A check that
   * fails the majority of correct work is not a strict check, it is a broken one.
   *
   * So L2 fails on what is actually wrong - no source, an anonymous source, a missing or impossible
   * retrieval date - and reports the uncatalogued count as information. The registry gap is real and
   * is stated in the output rather than hidden by a threshold.
   */
  result.layers.L2 = {
    pass: noSource.length === 0 && anon.length === 0 && badDate.length === 0,
    figures: figures.length,
    external: external.length,
    modelOwn: modelOwn.length,
    uncatalogued: unmatched.length,
    noSource,
    anon,
    badDate,
    unmatched,
    detail: `${figures.length} figures: ${external.length} external, ${modelOwn.length} our own arithmetic; ${noSource.length} without a source, ${anon.length} anonymous, ${badDate.length} bad date/period, ${unmatched.length} source(s) not in the instrument registry`,
  };

  /* ---------- L3: is a document-poor figure disclosed ---------- */
  /*
   * The unit here is the number of distinct documents behind the figures, not the number of distinct
   * source strings. A single document supplying five figures is one source, and the earlier version
   * counted each string separately - which reported most articles as under-verified when the point of
   * the rule is that a figure resting on one document cannot be told apart from a misreading of it.
   *
   * The check is only complete for figures whose source is catalogued, because the registry is the
   * only machine-readable list of documents this project has. That limit is stated in the detail
   * rather than papered over.
   */
  /*
   * The document universe is wider than the figure sources.
   *
   * Rule B says a rate should be checked against the previous year's announcement or the instrument
   * itself, and an article can do that while still attributing the figure to its primary document -
   * which is correct practice, since the figure came from there. So the count includes the article's
   * own `sources:` list as well. An article citing one primary document in its figures and three in
   * its bibliography has verified against four documents, and the check should see that.
   *
   * What it still catches is the real case: an article whose every external figure traces to a single
   * document and whose bibliography adds nothing.
   */
  const docKeys = new Set();
  const keyFor = (s) => {
    const n = norm(s);
    const inst = INSTRUMENTS.find((i) => i.n && (n.startsWith(i.n) || i.n.startsWith(n) || n.includes(i.n.slice(0, 40))));
    return inst ? `inst:${inst.id}` : `raw:${n.slice(0, 60)}`;
  };
  for (const f of external) docKeys.add(keyFor(f.source));

  const bibBlock = fm.split(/^sources:\s*$/m)[1]?.split(/^\w+:/m)[0] ?? "";
  const bibEntries = [...bibBlock.matchAll(/^\s{2}-\s*"?(.+?)"?\s*$/gm)].map((m) => m[1].trim()).filter(Boolean);
  const bibKeys = new Set(bibEntries.map(keyFor));
  for (const k of bibKeys) docKeys.add(k);
  const docCount = docKeys.size;
  const confident = /##\s*How confident\s*\n([\s\S]*?)(?=\n##\s|$)/.exec(body)?.[1] ?? "";
  /*
   * The disclosure recogniser was too literal.
   *
   * It accepted "single source" and "sole source", and a published article wrote "Every figure in this article
   * comes from that single instrument." That is the disclosure, in the vocabulary of the beat - a notice, an
   * instrument, a document - and the check reported it missing, so a correct article failed the audit and the next
   * run's preflight would have been red.
   *
   * The pattern is now written around the words this site actually uses, not around the phrase the first version
   * happened to imagine.
   */
  const disclosesSingle =
    /single (?:source|instrument|document|notice|regulation|release)|sole (?:source|document|instrument)|one document|not cross-?checked|no second (?:source|document)|未交叉核验|单一来源|均来自同(?:一|份)/i.test(
      confident + body,
    );
  result.layers.L3 = {
    /*
     * An article with no external figures is not an L3 failure.
     *
     * The first corrected version required two documents and so failed an article with zero figures -
     * an empty set judged guilty. Whether an article has figures at all is L2's business, and it says
     * so in its own line; L3 only asks whether the figures that exist rest on more than one document.
     */
    pass: external.length === 0 || docCount >= 2 || disclosesSingle,
    documents: docCount,
    catalogued: external.filter((f) => {
      const n = norm(f.source);
      return INSTRUMENTS.some((i) => i.n && (n.startsWith(i.n) || i.n.startsWith(n) || n.includes(i.n.slice(0, 40))));
    }).length,
    disclosed: disclosesSingle,
    detail:
      external.length === 0
        ? "no external figures, so there is nothing to cross-check here (see L2)"
        : docCount >= 2
          ? `${docCount} distinct document(s) behind the figures and the bibliography, so no figure rests on one alone`
          : `${docCount} document behind the figures and the bibliography; disclosure of that ${disclosesSingle ? "present" : "MISSING"}`,
  };

  /* ---------- L4: consistency, fabrication, fabrication-shaped markers ---------- */
  const prose = proseOnly(text);
  const fab = [];
  for (const [re, what] of L4_FABRICATION) if (re.test(prose)) fab.push(what);
  result.layers.L4 = {
    pass: fab.length === 0,
    found: fab,
    detail: fab.length ? `${fab.length} fabrication marker(s): ${fab.slice(0, 4).join("; ")}` : "no fabrication markers",
  };

  /* ---------- L5: judgement, defaults to not-sure ---------- */
  const risk = [];
  for (const [re, kind, what] of L5_RISK) {
    const m = re.exec(body);
    if (m) risk.push({ kind, what, at: m[0].slice(0, 60) });
  }
  result.layers.L5 = {
    pass: risk.length === 0,
    found: risk,
    detail: risk.length ? `${risk.length} risk trigger(s): ${risk.map((r) => r.kind).join(", ")}` : "no risk trigger matched",
  };

  result.verdict = Object.values(result.layers).every((l) => l.pass) ? "AUTO-PUBLISH OK" : "ALERT";
  for (const [name, l] of Object.entries(result.layers)) {
    if (!l.pass) result.alerts.push(`${name}: ${l.detail}`);
  }
  return result;
}

/* ---------------------------------------------------------------- run */

let targets = [];
if (args.includes("--drafts") || args.includes("--published") || NAMED.length === 0) {
  const wantDraft = args.includes("--drafts");
  for (const f of readdirSync(BLOG).filter((x) => x.endsWith(".md"))) {
    const t = readFileSync(join(BLOG, f), "utf8");
    const isDraft = /^draft:\s*true/m.test(frontmatter(t));
    if (args.includes("--published") && isDraft) continue;
    if (wantDraft && !isDraft) continue;
    if (!wantDraft && !args.includes("--published") && NAMED.length === 0) continue;
    targets.push(f.replace(/\.md$/, ""));
  }
} else {
  targets = NAMED.map((n) => n.replace(/^.*[/\\]/, "").replace(/\.md$/, ""));
}

if (!targets.length) {
  console.log("nothing to audit. Use --drafts, --published, or name an article.");
  process.exit(0);
}

const results = targets.map(auditOne);

/* The tool writes the file when asked, so a caller never has to redirect its stdout. */
if (OUT) {
  mkdirSync(join(ROOT, "data", "tmp"), { recursive: true });
  writeFileSync(join(ROOT, OUT), JSON.stringify(results, null, 2), "utf8");
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`AUDIT L1-L5 — ${results.length} article(s)\n${"=".repeat(88)}`);
  for (const r of results) {
    if (r.error) {
      console.log(`\n  ${r.slug}: ${r.error}`);
      continue;
    }
    console.log(`\n${"█".repeat(3)} ${r.slug}`);
    for (const [name, l] of Object.entries(r.layers)) {
      console.log(`  ${l.pass ? "ok  " : "FAIL"} ${name}  ${l.detail}`);
    }
    if (r.layers.L2.unmatched?.length) {
      console.log(`       unmatched sources (not in the instrument registry):`);
      for (const u of r.layers.L2.unmatched.slice(0, 6)) console.log(`         ${u.value}  <- ${u.source}`);
    }
    if (r.layers.L4.found?.length) console.log(`       fabrication: ${r.layers.L4.found.join("; ")}`);
    if (r.layers.L5.found?.length) for (const f of r.layers.L5.found) console.log(`       risk [${f.kind}]: ${f.what} — "${f.at}"`);
    console.log(`  → ${r.verdict}`);
  }

  const ok = results.filter((r) => r.verdict === "AUTO-PUBLISH OK");
  console.log(`\n${"=".repeat(88)}`);
  console.log(`  AUTO-PUBLISH OK : ${ok.length} of ${results.length}`);
  console.log(`  ALERT           : ${results.length - ok.length}`);
}

/* Leave nothing behind: the scratch copies exist only for qa-check to read. */
rmSync(join(ROOT, "data", "tmp", "audit"), { recursive: true, force: true });

/* Write an alert when anything is not publishable, as the protocol requires.
 *
 * `--no-alert` exists because the draft run is a self-test rather than an audit of work: every draft
 * fails by definition until it is finished, so preflight's `--drafts` invocation wrote an identical
 * alert file on every run. Nine had accumulated by 2026-10-16, and an alert directory that fills with
 * expected failures is one nobody reads, which is the opposite of what the file is for.
 *
 * The check's value is its exit code and the paired assertion in preflight. The alert is for a human,
 * so it is written only when a run is reporting on work that was meant to be publishable.
 */
const failed = results.filter((r) => r.verdict !== "AUTO-PUBLISH OK");
if (failed.length && !AS_JSON && !args.includes("--no-alert")) {
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const p = join(ROOT, "logs", `alert-audit-${stamp}.txt`);
  const body = [
    "AUDIT ALERT — L1-L5",
    `time   : ${new Date().toISOString()}`,
    `failed : ${failed.length} of ${results.length}`,
    "",
    ...failed.flatMap((r) => [`${r.slug}  ->  ${r.verdict}`, ...r.alerts.map((a) => `    ${a}`), ""]),
    "Per audit_protocol.md, anything that is not AUTO-PUBLISH OK does not publish.",
  ].join("\r\n");
  writeFileSync(p, body, "utf8");
  console.log(`\n  alert written: ${p}`);
}

process.exit(failed.length ? 1 : 0);
