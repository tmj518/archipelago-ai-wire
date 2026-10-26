/**
 * Render a page in a real browser and return its text.
 *
 * ## Why this exists
 *
 * Two sources this project needs are unreachable by `fetch` for the same reason and it is not a
 * block: the page arrives, the HTML is a shell, and the content is assembled by JavaScript after
 * load. Measured on 2026-10-12:
 *
 *   tron.trade.ec.europa.eu/investigations   HTTP 200, 28 characters of text
 *   eur-lex.europa.eu                        HTTP 202 to an automated request
 *
 * The Commission's trade-defence register is where an anti-dumping proceeding is listed by case
 * number, and EUR-Lex is where the notice of initiation is published. Three draft articles depend on
 * exactly those documents, so this is the difference between writing them from a primary text and
 * not writing them at all.
 *
 * The browser driver is the one `check-mobile.mjs` already uses, pointed at a remote URL instead of a
 * local file. Chrome is already required by that check, so this adds no dependency.
 *
 * ## Usage
 *
 *   node tools/render-page.mjs <url> [--wait=6000] [--selector=...] [--out=file]
 *   node tools/render-page.mjs <url> --json      # structured, for piping
 *
 * `--wait` is the settle time after load. Client-rendered pages fill in at unpredictable moments, so
 * the tool waits for the text to stop growing rather than for a fixed period, and `--wait` is the cap.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const AS_JSON = args.includes("--json");
const MAX_WAIT = Number(flag("wait", 15000));
const SELECTOR = flag("selector", null);
const OUT = flag("out", null);
const OUT_JSON = flag("out-json", null);

if (!url) {
  console.error("usage: node tools/render-page.mjs <url> [--wait=15000] [--selector=css] [--json] [--out=file]");
  process.exit(2);
}

const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.log("RESULT: SKIP - no Chrome or Edge found, so a client-rendered page cannot be read here");
  process.exit(0);
}

/* ---------------------------------------------------------------- proxy
 *
 * Both target hosts sit outside mainland China, and this machine reaches them through a local proxy.
 * The browser does not inherit the shell's proxy environment, so it is passed explicitly. An empty
 * value is skipped rather than passed as an empty server, which Chrome rejects.
 */
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";

const PORT = 9244;
const profile = mkdtempSync(join(tmpdir(), "dsh-render-"));
const chromeArgs = [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-gpu",
  "--no-sandbox",
  "--window-size=1400,2000",
  "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ...(proxy ? [`--proxy-server=${proxy}`] : []),
  "about:blank",
];
const chrome = spawn(browser, chromeArgs, { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let version = null;
for (let i = 0; i < 40 && !version; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    await sleep(500);
  }
}
if (!version) {
  console.log("RESULT: SKIP - the browser did not start");
  chrome.kill();
  process.exit(0);
}

const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text ?? "evaluation failed" };
  return { value: r.result?.result?.value };
};

await send("Runtime.enable");
await send("Page.enable");

const t0 = Date.now();
await send("Page.navigate", { url });

/*
 * Wait for the text to stop growing rather than for a fixed time. A client-rendered page fills in at
 * unpredictable moments, and a fixed wait is either too short (an empty shell) or too long (a minute
 * per page). Three consecutive stable readings mean the page has settled.
 */
let text = "";
let stable = 0;
let last = "";
while (Date.now() - t0 < MAX_WAIT) {
  await sleep(900);
  const r = await evaluate(SELECTOR
    ? `(document.querySelector(${JSON.stringify(SELECTOR)})||{}).innerText || ''`
    : "document.body ? document.body.innerText : ''");
  text = r.value ?? "";
  if (text === last && text.length > 0) stable++;
  else stable = 0;
  last = text;
  if (stable >= 3) break;
}

const title = (await evaluate("document.title || ''")).value ?? "";
const links = (await evaluate(`
  JSON.stringify([...document.querySelectorAll('a[href]')].slice(0, 400).map(a => ({href: a.href, text: (a.innerText||'').trim().slice(0,140)})))
`)).value ?? "[]";
const html = (await evaluate("document.documentElement.outerHTML.length")).value ?? 0;

ws.close();
chrome.kill();
await sleep(300);

const result = {
  url,
  title,
  waitedMs: Date.now() - t0,
  textChars: text.length,
  htmlChars: html,
  text,
  links: JSON.parse(links),
};

if (OUT) writeFileSync(OUT, text, "utf8");

/*
 * The structured result can be written by the tool itself rather than piped through the shell.
 * Redirecting node's stdout with `>` in PowerShell produces UTF-16, which is not valid JSON and
 * fails at the reader with a confusing parse error - a wasted round trip that this flag avoids.
 */
if (OUT_JSON) writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), "utf8");

if (AS_JSON) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`RENDERED ${url}`);
  console.log(`${"=".repeat(76)}`);
  console.log(`  title      : ${title}`);
  console.log(`  waited     : ${result.waitedMs} ms`);
  console.log(`  text chars : ${result.textChars}`);
  console.log(`  html chars : ${result.htmlChars}`);
  console.log(`  links      : ${result.links.length}`);
  if (OUT) console.log(`  written to : ${OUT}`);
  console.log(`\nTEXT\n${"-".repeat(76)}`);
  console.log(text.slice(0, 6000));
  if (text.length > 6000) console.log(`\n… ${text.length - 6000} more characters`);
}

/* A page that renders to almost nothing is the failure this tool exists to detect, so it says so. */
if (result.textChars < 200) {
  console.log(`\nWARNING: only ${result.textChars} characters of text. The page may still be a shell, or it may be refusing the automation.`);
}
