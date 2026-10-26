/**
 * Capture a SERP snapshot for a topic.
 *
 *   node tools/serp-snapshot.mjs <slug> --keyword="..." [--out=data/serp/<slug>.json]
 *
 * ## Why this is a tool
 *
 * `data/serp/<slug>.json` is the input to two gates now: the information-gain gate, which asks whether
 * competitors already deliver this, and the L5 blue-ocean assessment, which scores how crowded the
 * topic is. Thirteen of the thirty-one published articles have no snapshot, so both gates report
 * "not computable" for them - and a gate that cannot run on a third of the corpus is a gate that has
 * quietly stopped being one.
 *
 * ## How it reads the results
 *
 * DuckDuckGo's HTML endpoint is used because it answers a plain fetch. Its result links are wrapped:
 *
 *   //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=...
 *
 * so the URL is taken from the `uddg` parameter rather than from the href. The catch is recorded here
 * because a naive `href` read yields duckduckgo.com for every row, which looks like a result set and
 * is not one.
 *
 * Snippets are captured when the endpoint returns them. The lite endpoint returns titles without
 * snippets, and a missing snippet is written as an empty string rather than invented.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BLOG = join(ROOT, "src", "content", "blog");
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const strip = (s) =>
  s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
   .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'")
   .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

if (!slug) {
  console.log('usage: node tools/serp-snapshot.mjs <slug> --keyword="..."');
  process.exit(2);
}

/* The keyword defaults to the article's target_keyword, which is what the gate should be judging. */
let keyword = flag("keyword", "");
const p = join(BLOG, `${slug}.md`);
if (!keyword && existsSync(p)) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(p, "utf8"))?.[1] ?? "";
  keyword = (/^target_keyword:\s*"?([^"\n]+)"?/m.exec(fm)?.[1] ?? "").trim();
}
if (!keyword) {
  console.log("  no keyword: pass --keyword= or set target_keyword in the article");
  process.exit(2);
}
console.log(`  slug    : ${slug}`);
console.log(`  keyword : ${keyword}\n`);

const endpoints = [
  `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`,
  `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(keyword)}`,
];

const rows = [];
for (const u of endpoints) {
  try {
    const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(45000), headers: { "user-agent": UA, accept: "text/html" } });
    if (!r.ok) {
      console.log(`  [HTTP ${r.status}] ${u.slice(0, 58)}`);
      continue;
    }
    const h = await r.text();
    /* Titles, in document order. */
    const titles = [...h.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1]));
    /* Real URLs, from the uddg parameter. */
    const urls = [...h.matchAll(/uddg=([^&"]+)/gi)].map((m) => {
      try { return decodeURIComponent(m[1]); } catch { return ""; }
    }).filter(Boolean);
    /* Snippets, when the endpoint supplies them. */
    const snips = [...h.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1]));

    const seen = new Set();
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (seen.has(url)) continue;
      seen.add(url);
      rows.push({ url, title: titles[i] ?? "", snippet: snips[i] ?? "" });
    }
    console.log(`  [HTTP 200] ${h.length} bytes  titles=${titles.length} urls=${[...new Set(urls)].length} snippets=${snips.length}  ${u.slice(0, 44)}`);
    if (rows.length >= 8) break;
  } catch (e) {
    console.log(`  ERR ${e.cause?.code ?? e.message}  ${u.slice(0, 58)}`);
  }
}

const out = rows.slice(0, 12);
if (out.length < 2) {
  console.log(`\n  only ${out.length} result(s) parsed - not writing a snapshot.`);
  console.log(`  A snapshot with one row would make every competition metric read as "no competition",`);
  console.log(`  which is the opposite of what an absent snapshot should mean.`);
  process.exit(1);
}

const target = flag("out", join("data", "serp", `${slug}.json`));
mkdirSync(join(ROOT, "data", "serp"), { recursive: true });
writeFileSync(
  join(ROOT, target),
  JSON.stringify(
    {
      _note:
        "SERP snapshot for the information-gain gate and the L5 blue-ocean assessment. Collected from DuckDuckGo's HTML endpoint, which answers a plain fetch; result URLs are unwrapped from its uddg redirect parameter. Snippets are empty where the endpoint did not return them, which is recorded rather than filled in.",
      _captured: new Date().toISOString().slice(0, 10),
      _keyword: keyword,
      results: out,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`\n  wrote ${target}  (${out.length} results)`);
for (const r of out) console.log(`    ${(r.title || "(no title)").slice(0, 66).padEnd(68)} ${r.url.slice(0, 46)}`);
