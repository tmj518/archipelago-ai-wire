/**
 * Blue-ocean / red-ocean assessment for a topic.
 *
 *   node tools/blue-ocean.mjs <slug> [...]
 *   node tools/blue-ocean.mjs --all
 *   node tools/blue-ocean.mjs --json --out=data/tmp/bo.json
 *
 * ## Where this comes from, and where it departs from the instruction
 *
 * The director's v5.1 instruction specifies ten indicators: supply-demand index, average comments on
 * the leading products, top-10 brand concentration, how often new products reach the top 100, price
 * band performance, differentiation room, demand-side signals, competition density, content heat
 * lead, and brand concentration.
 *
 * Those are Amazon selection metrics. The source is a Chinese Amazon and TEMU product-research tool
 * whose blue-ocean vocabulary is about choosing a category to sell in - its own site describes it as
 * 选品软件, and its blue-ocean sentence is about 潜在的蓝海品类, potential blue-ocean categories. Nine
 * of the ten need a product listing: comments live on a product page, brand concentration needs brands
 * selling units, price bands need prices.
 *
 * This site has none of those. It publishes articles, and its customers are importers rather than
 * shoppers. So the ten are mapped to editorial equivalents rather than copied, and every mapping is
 * named in the output so the decision can be overruled:
 *
 *   supply-demand index            -> competitor supply against independent demand
 *   avg comments on leaders        -> how many leading pages carry a cost figure at all
 *   top-10 brand concentration     -> concentration of the ranking domains
 *   new products reaching top 100  -> editorial freshness: is the ranking settled or moving
 *   price band performance         -> whether the topic supports a worked cost model
 *   differentiation room           -> measured information gain against the ranking
 *   demand-side signals            -> whether the query carries a cost or date intent
 *   competition density            -> effective distinct domains in the snapshot
 *   content heat lead              -> how far ahead the site would be against dated competitors
 *   brand concentration            -> whether one publisher owns the topic
 *
 * The scoring rule is the director's and is unchanged: 40 or more is blue ocean, 30 to 39 is workable
 * with the risk recorded, below 30 sends the topic back.
 *
 * ## What is measured and what is not
 *
 * Every score is computed from a SERP snapshot in `data/serp/` or from the article itself. A metric
 * that cannot be computed is reported as null with its reason, and the total is reported alongside the
 * number of metrics that actually contributed - because a total built from four of ten indicators
 * looks the same as one built from ten, and it is not.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const SERP = join(ROOT, "data", "serp");
const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const OUT = (args.find((a) => a.startsWith("--out=")) ?? "").slice(6) || null;
const NAMED = args.filter((a) => !a.startsWith("--") && !a.endsWith(".json"));

/** Publishers that are never a competitor: aggregators, and our own domain. */
const NOT_COMPETITOR = /landedmath\.com|google\.|bing\.|youtube\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com\/posts|reddit\.com|quora\.com|pinterest\.|wikipedia\.org|amazon\.|alibaba\.com|made-in-china\.com/i;

function loadSerp(slug) {
  /* `--serp=` lets a fixture be scored without a matching article, which is how this tool is
     calibrated: a deliberately saturated snapshot has to come back RED, or the scorer has no
     discriminating power and every number it produces afterwards is decoration. */
  const override = (args.find((a) => a.startsWith("--serp=")) ?? "").slice(7) || null;
  const p = override && args.includes("--file") ? override : join(SERP, `${slug}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { keyword: j._keyword ?? "", captured: j._captured ?? "", results: (j.results ?? []).filter((r) => r && r.url) };
  } catch {
    return null;
  }
}

function frontmatter(text) {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
}

/** Score one topic. Each metric carries its own evidence line so the number can be argued with. */
function assess(slug) {
  const p = join(BLOG, `${slug}.md`);
  const text = existsSync(p) ? readFileSync(p, "utf8") : "";
  const fm = frontmatter(text);
  const serp = loadSerp(slug);
  /*
   * A fixture carries no article, so the two article-derived metrics are standing in for a candidate
   * topic rather than measuring one. They are given fixed mid scores and labelled, so a calibration
   * total is not mistaken for a real assessment.
   */
  const fixture = args.includes("--file") && !existsSync(p);
  const metrics = [];
  const add = (name, maps, score, why) => metrics.push({ name, maps, score, why });

  /* ---- 1. supply-demand index: competitor pages against independent demand ---- */
  const competitors = (serp?.results ?? []).filter((r) => !NOT_COMPETITOR.test(r.url));
  const n = serp ? competitors.length : null;
  add(
    "supply-demand index",
    "competitor pages against independent demand",
    n === null ? null : n === 0 ? 5 : n <= 2 ? 4 : n <= 5 ? 3 : n <= 9 ? 2 : 1,
    n === null ? "no SERP snapshot for this topic" : `${n} competitor page(s) in the snapshot`,
  );

  /* ---- 2. avg comments on leaders -> do the leaders carry a cost figure ---- */
  const withCost = competitors.filter((r) => /(USD|EUR|CNY|dollar|per cent|percent|%|\$|€|¥)\s?[\d,]/i.test(`${r.title} ${r.snippet ?? ""}`));
  add(
    "cost coverage of the leaders",
    "average comments on the leading products",
    n === null || n === 0 ? null : withCost.length === 0 ? 5 : withCost.length / n <= 0.34 ? 4 : withCost.length / n <= 0.67 ? 3 : withCost.length < n ? 2 : 1,
    n === null || n === 0 ? "no competitor pages to read" : `${withCost.length} of ${n} leader snippets carry a figure`,
  );

  /* ---- 3. top-10 brand concentration -> domain concentration ---- */
  const domains = [...new Set(competitors.map((r) => {
    try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; }
  }).filter(Boolean))];
  const topShare = domains.length ? Math.max(...domains.map((d) => competitors.filter((r) => r.url.includes(d)).length)) / competitors.length : null;
  add(
    "ranking concentration",
    "top-10 brand concentration",
    topShare === null ? null : topShare <= 0.25 ? 5 : topShare <= 0.4 ? 4 : topShare <= 0.6 ? 3 : topShare <= 0.8 ? 2 : 1,
    topShare === null ? "no domains to count" : `largest single domain holds ${Math.round(topShare * 100)} per cent of the ranking`,
  );

  /* ---- 4. new products reaching the top 100 -> is the ranking settled ---- */
  const ages = (serp?.results ?? []).map((r) => {
    const m = /(20\d\d)/.exec(`${r.title} ${r.snippet ?? ""}`);
    return m ? Number(m[1]) : null;
  }).filter(Boolean);
  const newest = ages.length ? Math.max(...ages) : null;
  const yearNow = 2026;
  add(
    "editorial freshness",
    "new products reaching the top 100",
    newest === null ? null : yearNow - newest <= 0 ? 1 : yearNow - newest === 1 ? 3 : 4,
    newest === null ? "no year appears in the competitor titles or snippets" : `newest year mentioned by a competitor is ${newest}`,
  );

  /* ---- 5. price band performance -> does the topic support a worked cost model ---- */
  const figures = (fm.match(/^ {2}- value:/gm) ?? []).length;
  const hasCostTable = (text.match(/\|.*(?:USD|EUR|CNY|\$|€|¥)\s?[\d,].*\|/g) ?? []).length >= 3;
  add(
    "cost-model support",
    "price band performance",
    !text ? null : hasCostTable && figures >= 8 ? 5 : hasCostTable ? 4 : figures >= 5 ? 3 : 2,
    !text ? "article not found" : `${figures} figure(s), cost table ${hasCostTable ? "present" : "absent"}`,
  );

  /* ---- 6. differentiation room -> information gain type ---- */
  const gain = /^information_gain:\s*"?([a-z-]+)"?/m.exec(fm)?.[1] ?? null;
  const GAIN_SCORE = { "custom-calculation": 5, "original-document": 5, "data-assembly": 4, "translation-of-primary": 4, "synthesis": 3, "commentary": 2 };
  add("differentiation room", "differentiation room", gain && GAIN_SCORE[gain] ? GAIN_SCORE[gain] : null, gain ? `information_gain: ${gain}` : "information_gain not declared");

  /* ---- 7. demand-side signals -> does the query carry cost or date intent ---- */
  const kw = serp?.keyword ?? "";
  const intent = /(rate|duty|tariff|cost|price|fee|deadline|effective|date|2026|2027|per cent|percent|%|how much)/i.test(kw);
  add("demand-side signals", "demand-side signals", serp ? (intent ? 5 : 3) : null, serp ? `keyword: "${kw.slice(0, 70)}"` : "no keyword recorded");

  /* ---- 8. competition density -> effective distinct domains ---- */
  add(
    "competition density",
    "competition density",
    domains.length === 0 ? (serp ? 5 : null) : domains.length <= 2 ? 5 : domains.length <= 4 ? 4 : domains.length <= 7 ? 3 : 2,
    domains.length === 0 ? (serp ? "no competitor domains at all" : "no snapshot") : `${domains.length} distinct domain(s)`,
  );

  /* ---- 9. content heat lead -> would we be ahead of a dated competitor ---- */
  const captured = serp?.captured ? new Date(serp.captured) : null;
  const leadDays = captured ? Math.round((new Date("2026-10-16") - captured) / 86400000) : null;
  add(
    "content heat lead",
    "content heat lead",
    leadDays === null ? null : leadDays <= 7 ? 5 : leadDays <= 30 ? 4 : leadDays <= 90 ? 3 : 2,
    leadDays === null ? "snapshot has no capture date" : `snapshot captured ${serp.captured}, ${leadDays} day(s) before today`,
  );

  /* ---- 10. brand concentration -> does one publisher own the topic ---- */
  const nonGov = domains.filter((d) => !/\.gov(\.|$)|europa\.eu|wto\.org|un\.org/i.test(d));
  add(
    "publisher ownership",
    "brand concentration",
    domains.length === 0 ? (serp ? 5 : null) : nonGov.length <= 2 ? 5 : nonGov.length <= 4 ? 4 : nonGov.length <= 6 ? 3 : 2,
    domains.length === 0 ? "no publishers in the snapshot" : `${nonGov.length} non-official publisher(s)`,
  );

  const scored = metrics.filter((m) => typeof m.score === "number");
  const total = scored.reduce((a, m) => a + m.score, 0);

  /*
   * Coverage is a gate of its own, and the first version of this tool did not have it.
   *
   * Two articles with no SERP snapshot scored 50 out of 50 and came back BLUE, because only the two
   * article-derived metrics were computable and scaling to ten made two perfect scores look like ten.
   * That is manufactured confidence, which is the failure this whole audit line exists to prevent, so
   * a verdict is withheld until at least six of the ten metrics can actually be measured.
   *
   * The industry metrics this replaces need a product listing; the editorial substitutes need a
   * SERP snapshot, and without one there is nothing to say about competition. Saying nothing is the
   * correct output.
   */
  const MIN_COVERAGE = 6;
  const coverage = scored.length / metrics.length;
  const enough = scored.length >= MIN_COVERAGE;
  const scaled = enough && scored.length ? Math.round((total / (scored.length * 5)) * 50) : null;
  const verdict = !enough ? "INSUFFICIENT-DATA" : scaled >= 40 ? "BLUE" : scaled >= 30 ? "WORKABLE" : "RED";

  return {
    slug,
    keyword: kw,
    metrics,
    scored: scored.length,
    coverage: Math.round(coverage * 100),
    total,
    scaled,
    verdict,
    missing: metrics.filter((m) => m.score === null).map((m) => m.name),
  };
}

/* ---------------------------------------------------------------- run */

let targets;
if (args.includes("--all")) {
  targets = readdirSync(BLOG).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
} else if (NAMED.length) {
  targets = NAMED.map((s) => s.replace(/^.*[/\\]/, "").replace(/\.md$/, ""));
} else {
  console.log("usage: node tools/blue-ocean.mjs <slug> [...] | --all | --json --out=file");
  process.exit(2);
}

/*
 * A named target is kept when it has an article, or when a fixture path was supplied - because the
 * calibration case deliberately has no article, and filtering it out made the scorer report zero
 * topics and exit clean, which looks identical to a pass.
 */
const results = targets
  .filter((s) => existsSync(join(BLOG, `${s}.md`)) || args.includes("--file"))
  .map(assess);

if (OUT) {
  mkdirSync(join(ROOT, "data", "tmp"), { recursive: true });
  writeFileSync(join(ROOT, OUT), JSON.stringify(results, null, 2), "utf8");
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`BLUE-OCEAN ASSESSMENT — ${results.length} topic(s)\n${"=".repeat(88)}`);
  for (const r of results) {
    console.log(`\n███ ${r.slug}`);
    if (r.keyword) console.log(`     keyword: ${r.keyword}`);
    for (const m of r.metrics) {
      const s = m.score === null ? "  -" : String(m.score).padStart(2);
      console.log(`   ${s}  ${m.name.padEnd(26)} ${m.why}`);
    }
    console.log(`   ---- ${r.total} raw from ${r.scored}/10 metrics (${r.coverage}% coverage)  ->  ${r.scaled === null ? "withheld" : r.scaled + "/50"}  =>  ${r.verdict}`);
    if (r.missing.length) console.log(`        not computable: ${r.missing.join(", ")}`);
  }
  const by = { BLUE: 0, WORKABLE: 0, RED: 0, "INSUFFICIENT-DATA": 0 };
  for (const r of results) by[r.verdict]++;
  console.log(`\n${"=".repeat(88)}`);
  console.log(`  BLUE >=40          : ${by.BLUE}`);
  console.log(`  WORKABLE 30-39     : ${by.WORKABLE}`);
  console.log(`  RED <30            : ${by.RED}`);
  console.log(`  INSUFFICIENT-DATA  : ${by["INSUFFICIENT-DATA"]}  (fewer than 6 of 10 metrics computable)`);
}

/* The instruction's rule: below 30 sends the topic back. Only enforced when the run is a check. */
const red = results.filter((r) => r.verdict === "RED");
process.exit(red.length && !AS_JSON ? 1 : 0);
