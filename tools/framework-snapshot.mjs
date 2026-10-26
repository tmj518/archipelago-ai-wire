#!/usr/bin/env node
/**
 * Directory framework snapshot.
 *
 * Writes a dated tree of the repository to docs/framework-<stamp>.md, annotated
 * with what each part is for. The point is a reference a later session can read
 * instead of re-deriving the layout, and a record of what existed on a given
 * date — the project has already had two documents go stale without anyone
 * noticing (the reciprocal-link count and the disclaimer wording), so the date
 * in the filename is deliberate rather than decorative.
 *
 * Deliberately excluded from the tree: node_modules, .git, dist, .astro, and the
 * contents of build/ and _research/. Their existence is noted with a one-line
 * description, because what matters is that they are gitignored and why.
 *
 * Usage: node tools/framework-snapshot.mjs [--print]
 */

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "docs");

const SKIP = new Set([
  "node_modules", ".git", "dist", ".astro", "build", "_research", "out",
  "2026-export-rebate-evidence", "cbam",
]);

const NOTES = {
  "src/content/blog": "the articles; drafts carry draft: true and are excluded from the gate's blocking rules",
  "src/content.config.ts": "Zod schema for the collection — the single source of truth for frontmatter",
  "src/pages": "routes; /blog/<slug>/ is frozen, columns come from frontmatter not directories",
  "src/layouts": "BaseLayout (site chrome) and ArticleLayout (article chrome)",
  "src/components": "12 presentation components; every one keeps its CSS in global.css",
  "src/lib": "post.ts — published(), relatedPosts(), readingTime(), numbersFor()",
  "src/consts.ts": "site constants; SITE_URL, DISCLAIMER and the author persona live only here",
  "src/styles/global.css": "the only stylesheet",
  tools: "cost models, gates, publishers. 28 scripts",
  data: "evidence: SERP snapshots, QA reports, keyword runs",
  scripts: "image generation only (OG cards, channel art)",
  public: "favicon, og-default.png, _headers",
  docs: "generated reference documents",
};

function tree(dir, prefix = "", depth = 0) {
  if (depth > 3) return [];
  const entries = readdirSync(dir)
    .filter((e) => !SKIP.has(e) && !e.startsWith("."))
    .sort((a, b) => {
      const ad = statSync(join(dir, a)).isDirectory();
      const bd = statSync(join(dir, b)).isDirectory();
      if (ad !== bd) return ad ? -1 : 1;
      return a.localeCompare(b);
    });

  const lines = [];
  entries.forEach((e, i) => {
    const full = join(dir, e);
    const last = i === entries.length - 1;
    const isDir = statSync(full).isDirectory();
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    const note = NOTES[rel] ? `   # ${NOTES[rel]}` : "";
    lines.push(`${prefix}${last ? "└── " : "├── "}${e}${isDir ? "/" : ""}${note}`);
    if (isDir) lines.push(...tree(full, prefix + (last ? "    " : "│   "), depth + 1));
  });
  return lines;
}

const now = new Date();
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const count = (dir, ext) => {
  try {
    return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).length;
  } catch {
    return 0;
  }
};

/** Published vs draft, so the count in the table is unambiguous. */
const articleCounts = (() => {
  const dir = join(ROOT, "src/content/blog");
  let published = 0;
  let drafts = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    if (/^draft:\s*true/m.test(readFileSync(join(dir, f), "utf8"))) drafts++;
    else published++;
  }
  return { published, drafts, total: published + drafts };
})();

let commit = "";
try {
  commit = execFileSync("git", ["log", "-1", "--format=%h %s"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
  commit = "(git unavailable)";
}

const lines = [];
lines.push(`# 目录框架快照 ${iso}`);
lines.push("");
lines.push(`生成时间：${now.toISOString().slice(0, 19).replace("T", " ")} UTC  `);
lines.push(`生成工具：\`node tools/framework-snapshot.mjs\`  `);
lines.push(`对应提交：\`${commit}\``);
lines.push("");
lines.push("## 顶层结构");
lines.push("");
lines.push("```");
lines.push("china-cross-border-insider/");
lines.push(...tree(ROOT));
lines.push("```");
lines.push("");
lines.push("## 被 git 忽略的目录（存在但不在仓库里）");
lines.push("");
lines.push("| 目录 | 是什么 | 为什么忽略 |");
lines.push("| --- | --- | --- |");
lines.push("| `build/` | 渲染出的视频、播客音频、preflight 状态 | 生成产物，可重建 |");
lines.push("| `_research/` | 一手素材（BOE/Federal Register 的 HTML、PDF 文本提取） | 原始素材体积大，可重抓 |");
lines.push("| `cbam/` | 第 13 篇的 CBAM dossier（含 EUR-Lex 抓取的条例全文） | 同上 |");
lines.push("| `2026-export-rebate-evidence/` | 出口退税研究证据 | 同上 |");
lines.push("| `out/` | 抓取中间产物 | 同上 |");
lines.push("| `dist/` `.astro/` `node_modules/` | 构建输出与依赖 | 标准忽略 |");
lines.push("");
lines.push("## 内容与技术计数");
lines.push("");
lines.push("| 项 | 数量 |");
lines.push("| --- | --- |");
lines.push(`| 已发布文章 | ${articleCounts.published} 篇 |`);
lines.push(`| 草稿 | ${articleCounts.drafts} 篇（\`draft: true\`，闸门的阻断规则对它们降级为警告） |`);
lines.push(`| .md 总数 | ${articleCounts.total} |`);
lines.push(`| 成本模型 | ${readdirSync(join(ROOT, "tools")).filter((f) => /-cost|trq|mip|export-duty|per-item|price-drift|freight|rebate|deposit|guarantee|hold/.test(f)).length} |`);
lines.push(`| tools 脚本总数 | ${readdirSync(join(ROOT, "tools")).filter((f) => /\.(mjs|py|ps1)$/.test(f)).length} |`);
lines.push(`| SERP 快照 | ${count("data/serp", ".json")} |`);
lines.push(`| 机审报告 | ${count("data/qa", ".md")} |`);
lines.push("");
lines.push("## 技术栈");
lines.push("");
lines.push("```");
lines.push("Astro 7.3.5  ·  output: static  ·  无服务器、无 Docker、无 GitHub Actions");
lines.push("Cloudflare Pages  ·  git push 触发构建  ·  换 SITE_URL 一处即可全站生效");
lines.push("Python 3.13（独立安装，非 DSH 内置）·  edge-tts  ·  ffmpeg  ·  Pillow");
lines.push("```");
lines.push("");
lines.push("## 闸门（5 道）");
lines.push("");
lines.push("| 闸门 | 作用 | 失败时 |");
lines.push("| --- | --- | --- |");
lines.push("| `qa-check.mjs` | 21 条结构规则 + About 承诺核查 | 退出 1 |");
lines.push("| `serp-check.mjs` | 信息增量（对真实竞品集） | 仅 UNSUPPORTED 退出 1 |");
lines.push("| `qa-report.mjs` | 8 项机审（原创性/模板化/敏感词/长度/权利/链接/SEO） | 报告 |");
lines.push("| `link-check.mjs` | 内链图：孤儿、断链、环形 | 退出 1 |");
lines.push("| `preflight.mjs` | 开工前环境自检 + 档位就绪 | 阻断项退出 1 |");
lines.push("");
lines.push("> **`review-dates.mjs` 不算闸门**：它报告到期与发布节奏，不阻断——");
lines.push("> 历史已违规的项目，永久失败的检查会被忽略。");
lines.push("");

const out = lines.join("\n");

if (process.argv.includes("--print")) {
  console.log(out);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `framework-${stamp}.md`);
  writeFileSync(path, out, "utf8");
  console.log(`wrote ${relative(ROOT, path)}  (${out.length} bytes, ${out.split("\n").length} lines)`);
}
