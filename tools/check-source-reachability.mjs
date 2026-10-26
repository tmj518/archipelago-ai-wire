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
 */
const TARGETS = [
  ["cacs.mofcom.gov.cn", "https://cacs.mofcom.gov.cn/", "trade remedies: the highest-value entry, foreign anti-dumping against China"],
  ["gss.mof.gov.cn", "http://gss.mof.gov.cn/gzdt/", "Tariff Commission: rate schedules and adjustments"],
  ["mof.gov.cn", "https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/", "Ministry of Finance: tax and subsidy notices"],
  ["mofcom.gov.cn", "https://www.mofcom.gov.cn/zfxxgk/", "MOFCOM: trade policy and announcements"],
  ["stats.gov.cn", "https://www.stats.gov.cn/sj/zxfb/", "NBS: PPI, CPI, industrial profit"],
  ["chinatax.gov.cn", "https://www.chinatax.gov.cn/chinatax/n810341/n810755/index.html", "STA: export tax rebate rates"],
  ["miit.gov.cn", "https://www.miit.gov.cn/zwgk/zcwj/index.html", "MIIT: industrial policy and access rules"],
  ["samr.gov.cn", "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/", "SAMR: standards, certification, inspections"],
  ["safe.gov.cn", "https://www.safe.gov.cn/safe/whxw/index.html", "SAFE: exchange rates and cross-border capital"],
  ["customs.gov.cn", "http://www.customs.gov.cn/", "GACC Chinese: known 412 site-wide, included to confirm it stays that way"],
  ["english.customs.gov.cn", "http://english.customs.gov.cn/Legislation/Announcement", "GACC English announcements: read but stale since 2023"],
  ["eur-lex.europa.eu", "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:C_202604924", "EUR-Lex: 202 to a plain fetch, needs a browser"],
  ["tron.trade.ec.europa.eu", "https://tron.trade.ec.europa.eu/investigations", "EU trade defence register: client-rendered, XML endpoint read separately"],
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
