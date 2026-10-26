/**
 * Can a machine in a hosting data centre read China's official sites?
 *
 *   node tools/check-source-reachability.mjs            # human output
 *   node tools/check-source-reachability.mjs --json --out=reachability.json
 *
 * ## Why this exists, and why it runs before anything else is built
 *
 * The plan is to move the pipeline off this computer and onto a runner. Everything in it depends on
 * one assumption: that the runner can read the source documents. On 2026-10-16 that was measured as
 * "5 of 6 sites reachable from a foreign IP" - but that measurement went through a local proxy whose
 * exit node may well be a residential address. A GitHub runner's egress is a data-centre range, and
 * Chinese government sites block data-centre ranges far more aggressively than residential ones.
 *
 * So the assumption is not established by that earlier test, and building the pipeline on it would be
 * building on sand. This probes it from wherever it runs, and it is designed to be run by a
 * `workflow_dispatch` in GitHub Actions precisely because that is the network being asked about.
 *
 * ## What it reports
 *
 * Per host: the status, the byte count, whether the body looks like a document or a block page, and
 * how long it took. A 412 or a 403 is a finding, not an error. A 200 carrying a few hundred bytes is
 * reported as a probable block page, because that is what 200-with-nothing looks like and this project
 * has already been caught by it twice - the WTO gateway and the GACC English list.
 *
 * Nothing here is a gate. It answers a question, and the answer decides the architecture.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const OUT = (args.find((a) => a.startsWith("--out=")) ?? "").slice(6) || null;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/*
 * The sources that matter, with what each is for. Ordered by value to the pipeline rather than
 * alphabetically, because if only some come through the order is the answer.
 *
 * Rebuilt for the Malaysian project on 2026-10-26. The previous list was fifteen Chinese and EU
 * endpoints, and its note on GACC ("known 412 site-wide") is the reason the old pipeline could
 * not read the customs statistics it was built around.
 *
 * Three things are encoded in the choices below, because the probe is the only place they can be
 * measured from the network the automation actually runs on:
 *
 *   1. NUMBER SOURCES come first. These publish figures in the page body and are the only ones
 *      that can satisfy a verbatim-quote check.
 *   2. ANALYSIS SOURCES are last. ISEAS and ISIS supply the reasoning for `Why now` and `So what`
 *      and almost never a number; treating them as figure sources is how a piece ends up with an
 *      argument and no evidence.
 *   3. The known-bad ones stay on the list. JKDM and the Securities Commission are included so the
 *      probe keeps proving they are unusable from a runner, rather than being quietly dropped and
 *      then rediscovered the week a guide needs them.
 */
const TARGETS = [
  ["bnm.gov.my", "https://www.bnm.gov.my/pr", "Bank Negara Malaysia press releases: policy rate, reserves, exchange rate - English, figures in HTML"],
  ["bnm.gov.my/rates", "https://www.bnm.gov.my/rates-statistics", "the key rates and statistics page the daily numbers are read from"],
  ["dosm.gov.my", "https://www.dosm.gov.my/portal-main/home", "DOSM key indicators: CPI, trade, GDP, employment - English path, figures in HTML"],
  ["open.dosm.gov.my", "https://open.dosm.gov.my/", "DOSM open data: the structured channel, CSV and API rather than sentences"],
  ["mida.gov.my", "https://www.mida.gov.my/media-release/feed/", "MIDA media releases as RSS: investment approvals with RM amounts in the body"],
  ["mof.gov.my", "https://www.mof.gov.my/portal/en/news/speech", "Ministry of Finance: the budget speech in English, a separate page from the Malay one"],
  ["miti.gov.my", "https://www.miti.gov.my/index.php/pages/view/10936", "MITI media releases 2026: trade measures. Titles in HTML, figures in linked PDFs"],
  ["customs.gov.my", "https://mysst.customs.gov.my/", "JKDM sales-and-service tax portal: English shell, Malay guidance PDFs - expected to be the weak link"],
  ["sc.com.my", "https://www.sc.com.my/resources/media/media-release", "Securities Commission: listing is client-rendered, included to keep measuring that"],
  ["iseas.edu.sg", "https://www.iseas.edu.sg/category/articles-commentaries/iseas-perspective/iseas-perspective-2026/", "ISEAS Perspective: regional analysis, English, for Why now and So what"],
  ["isis.org.my", "https://www.isis.org.my/", "ISIS Malaysia: strategic analysis from a Malaysian standpoint"],
  ["federalreserve.gov", "https://www.federalreserve.gov/newsevents/pressreleases.htm", "US Fed: the world-side rate decisions that move the ringgit"],
  ["ecb.europa.eu", "https://www.ecb.europa.eu/press/html/index.en.html", "ECB press: euro-area decisions"],
  ["imf.org", "https://www.imf.org/en/News", "IMF: country reviews and forecasts"],
  ["worldbank.org", "https://www.worldbank.org/en/news", "World Bank: development data and country briefs"],
  ["wto.org", "https://www.wto.org/english/news_e/news_e.htm", "WTO: trade notices and disputes"],
  ["api.indexnow.org", "https://api.indexnow.org/indexnow", "IndexNow: the submission step, checked for reachability only"],
  ["registry.npmjs.org", "https://registry.npmjs.org/astro", "npm registry: needed by install, so a failure here explains a failed run"],
];

const t0 = Date.now();
const rows = [];

for (const [host, url, why] of TARGETS) {
  const started = Date.now();
  let status = 0;
  let bytes = 0;
  let note = "";
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json,*/*" },
    });
    status = r.status;
    const body = await r.text();
    bytes = Buffer.byteLength(body, "utf8");
    const head = body.slice(0, 600).toLowerCase();
    if (status === 200 && bytes < 900) note = "200 but tiny - probable block or empty shell";
    else if (/just a moment|checking your browser|cf-browser-verification|captcha/i.test(head)) note = "challenge page";
    else if (status === 200) note = "document";
  } catch (e) {
    note = "threw: " + (e.cause?.code ?? e.name ?? e.message);
  }
  rows.push({ host, url, why, status, bytes, ms: Date.now() - started, note });
  /* Sequential with a pause: this is a reachability probe, not a load test, and the sources are
     government sites that react badly to bursts. */
  await new Promise((r) => setTimeout(r, 1200));
}

const reachable = rows.filter((r) => r.status === 200 && r.bytes >= 900 && r.note === "document");
const blocked = rows.filter((r) => r.status === 403 || r.status === 412 || r.status === 429);
const challenged = rows.filter((r) => r.note === "challenge page" || r.note.startsWith("200 but tiny"));
const failed = rows.filter((r) => r.note.startsWith("threw") || r.status === 0);

const summary = {
  generated: new Date().toISOString(),
  runSeconds: Math.round((Date.now() - t0) / 1000),
  egress: "reported by the caller if needed; this script does not call a geo service",
  totals: { probed: rows.length, reachable: reachable.length, blocked: blocked.length, challenged: challenged.length, failed: failed.length },
  rows,
};

if (OUT) {
  mkdirSync(join(process.cwd(), "data", "tmp"), { recursive: true });
  writeFileSync(join(process.cwd(), OUT), JSON.stringify(summary, null, 2), "utf8");
}

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`SOURCE REACHABILITY PROBE  (${summary.runSeconds}s)\n${"=".repeat(88)}`);
  console.log(`  ${"host".padEnd(26)} ${"status".padStart(6)} ${"bytes".padStart(8)}  note`);
  for (const r of rows) {
    console.log(`  ${r.host.padEnd(26)} ${String(r.status).padStart(6)} ${String(r.bytes).padStart(8)}  ${r.note}`);
  }
  console.log(`\n${"=".repeat(88)}`);
  console.log(`  reachable : ${reachable.length} of ${rows.length}   ${reachable.map((r) => r.host).join(", ")}`);
  console.log(`  blocked   : ${blocked.length}   ${blocked.map((r) => r.host).join(", ") || "-"}`);
  console.log(`  challenged: ${challenged.length}   ${challenged.map((r) => r.host).join(", ") || "-"}`);
  console.log(`  failed    : ${failed.length}   ${failed.map((r) => r.host).join(", ") || "-"}`);
  console.log("");
  console.log("  WHAT THIS DECIDES");
  console.log("    If the Chinese sources come back reachable, a data-centre runner can fetch the primary");
  console.log("    documents and the pipeline can be built there. If they come back blocked or challenged,");
  console.log("    the fetch step has to stay somewhere with a residential or proxied egress, and only the");
  console.log("    deterministic half - build, gates, deploy, notify - moves to the cloud.");
}

if (OUT) console.log(`\n  written to ${OUT}`);
