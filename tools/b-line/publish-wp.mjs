#!/usr/bin/env node
/**
 * B线 — publish one case study to a WordPress site over its REST API.
 *
 * Modelled on the workflow that worked first time: read the category's existing posts, refuse a
 * duplicate, publish, then fetch the public URL and confirm it is there. The difference is that this
 * script never invents the article - it takes a finished markdown file and puts it where it belongs.
 *
 * Credentials come from the environment only, never from the command line:
 *   WP_SITE          https://example.com
 *   WP_USER          the account name
 *   WP_APP_PASSWORD  application password, not the login password
 *   WP_CATEGORY_ID   numeric category id
 *
 *   node tools/b-line/publish-wp.mjs --file=draft.md --slug=my-case-study [--dry-run]
 *
 * Exit codes: 0 published and verified, 2 duplicate, 3 credentials missing or rejected, 1 other.
 */
import { readFileSync, existsSync } from "node:fs";

const flag = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const site = (process.env.WP_SITE ?? "").replace(/\/$/, "");
const user = process.env.WP_USER ?? "";
const pass = process.env.WP_APP_PASSWORD ?? "";
const categoryId = Number(process.env.WP_CATEGORY_ID ?? 0);
const file = flag("file");
const wantedSlug = flag("slug");
const dryRun = process.argv.includes("--dry-run");

if (!site || !user || !pass || !categoryId) {
  console.error("  b-line: WP_SITE, WP_USER, WP_APP_PASSWORD and WP_CATEGORY_ID must all be set");
  process.exit(3);
}
if (!file || !existsSync(file)) {
  console.error(`  b-line: no draft at ${file || "(unset)"}`);
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const api = (path) => `${site}/wp-json/wp/v2${path}`;

async function listExisting() {
  const res = await fetch(api(`/posts?categories=${categoryId}&per_page=100&_fields=slug,title,link`), {
    headers: { authorization: auth },
  });
  if (!res.ok) throw new Error(`listing posts failed: HTTP ${res.status}`);
  return res.json();
}

/*
 * Markdown to the small HTML WordPress needs. Deliberately plain: headings, paragraphs, lists, links
 * and bold. Anything cleverer and the article would look different in the editor from what was written.
 */
function toHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function inline(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
}

function titleOf(md) {
  const hit = /^#\s+(.+)$/m.exec(md);
  return hit ? hit[1].trim() : "";
}

const md = readFileSync(file, "utf8");
const title = titleOf(md) || wantedSlug || "Untitled";
const slug = (wantedSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 80);

const existing = await listExisting();
const clash = existing.find((p) => p.slug === slug);
if (clash) {
  console.log(`  b-line: ${slug} already exists (${clash.link}) - refusing to publish a duplicate`);
  process.exit(2);
}
console.log(`  b-line: ${existing.length} existing post(s) in category ${categoryId}; ${slug} is free`);

if (dryRun) {
  console.log("  b-line: dry run, nothing sent");
  process.exit(0);
}

const res = await fetch(api("/posts"), {
  method: "POST",
  headers: { authorization: auth, "content-type": "application/json" },
  body: JSON.stringify({ title, slug, content: toHtml(md), status: "publish", categories: [categoryId] }),
});
if (!res.ok) {
  console.error(`  b-line: publish failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const post = await res.json();
console.log(`  b-line: published ${post.link} (id ${post.id})`);

/* Verify the public page, not just the API response. */
const check = await fetch(post.link, { headers: { "user-agent": "Mozilla/5.0" } });
const body = await check.text();
const hasTitle = body.toLowerCase().includes(title.toLowerCase().slice(0, 40));
console.log(`  b-line: live check HTTP ${check.status}, title present: ${hasTitle}`);
process.exit(check.status === 200 && hasTitle ? 0 : 1);
