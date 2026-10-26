# Landed Math

> **2026-10-01 改名**：项目原名 "China Cross-border Insider"（暂定名），域名 `crossborderinsider.com` 已被占用，
> 正式定名为 **Landed Math**（域名 `landedmath.com`）
---

## 一、目录结构

```
├── astro.config.mjs          # site / sitemap 集成 / 构建格式
├── package.json              # 依赖与脚本（engines: node >= 22.12）
├── pnpm-workspace.yaml       # pnpm 11 的构建脚本白名单（esbuild）
├── tsconfig.json             # 继承 astro/tsconfigs/strict
├── .nvmrc                    # Cloudflare Pages 读它选 Node 版本
│
├── public/                   # 原样拷贝到 dist/
│   ├── favicon.svg
│   ├── og-default.png        # 默认社交分享图（1200×630，脚本生成）
│   └── _headers              # CF Pages 安全响应头 + 缓存策略
│
├── scripts/
│   └── make-og-image.mjs     # 重新生成 og-default.png
│
└── src/
    ├── consts.ts             # 站点/导航/分类/作者/页脚 —— 唯一事实来源
    ├── content.config.ts     # blog 集合的 frontmatter schema（zod）
    ├── content/blog/*.md     # 文章（Markdown）
    ├── lib/post.ts           # 排序、字数时长、related、Today's Numbers
    ├── styles/global.css     # 设计 token + 全部样式（原型 CSS 的整理版）
    ├── layouts/BaseLayout.astro   # <head> SEO + 导航 + 页脚
    ├── components/           # Nav / Hero / FeaturedCard / ArticleRow /
    │                         # Sidebar / AuthorCard / NumbersWidget /
    │                         # NewsletterForm / ArticleFooter / RelatedCard / Footer
    └── pages/
        ├── index.astro            # 首页
        ├── blog/[slug].astro      # 文章页
        ├── category/[category].astro  # 三个栏目页（由 CATEGORIES 生成）
        ├── about / privacy / contact / 404
        ├── rss.xml.ts             # /rss.xml
        └── robots.txt.ts          # /robots.txt
```

## 二、常用命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 本地预览 http://localhost:4321
pnpm build          # 构建到 dist/（Cloudflare Pages 用这条）
pnpm preview        # 预览构建产物
pnpm check          # Astro + TypeScript 类型检查（当前 0 error / 0 warning）
pnpm og             # 重新生成 public/og-default.png
```

## 三、环境说明（重要，只影响本机）



### 3.2 GitHub 仓库（2026-10-01 建立）

|


## 四、写一篇文章

在 `src/content/blog/` 新建 `<slug>.md`，文件名即 URL（`/blog/<slug>/`）。frontmatter 字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✅ | ≤120 字符 |
| `description` | ✅ | ≤300 字符，同时用作 `<meta description>` 和卡片摘要 |
| `publishDate` | ✅ | `2026-09-29` |
| `updatedDate` | | 有更正时填，会输出 `article:modified_time` |
| `category` | ✅ | `trade-policy` / `platforms` / `supply-chain` 三选一 |
| `tags` | | 字符串数组 |
| `priority` | | `P0` / `P1` / `P2`，首页侧栏统计用 |
| `featured` | | `true` 时进首页 Hero |
| `draft` | | `true` 则完全不出现在站点与 RSS |
| `sources` | | 信源名单，正文底部渲染成 Sources。**正文里不写 URL**（规范 §4.3） |
| `heroImage` / `heroImageAlt` | | 配图路径 + alt |

正文按写作模板 V6.1 组织：

```markdown
Hook 段（不写小标题，直接抛反常识问题）

## What happened
## Why now
## So what
## For you
## The data point
```

可直接用的两个片段：

```html
<div class="callout">
<span class="callout-label">Data point</span>
一句话关键数字收尾。
</div>
```

成本测算用标准 Markdown 表格即可（样式已内置）。

### 发布前自检

```

**闸门一：[qa-check.mjs](tools/qa-check.mjs)** — 阻断项包括

| 规则 | 判定 |
| --- | --- |
| 数字五元组 | `figures[]` 每条必须有 value + unit + period + source + retrieved，缺项即阻断 |
| 数字数量 | 少于 5 个即阻断 |
| 信息增量声明 | 缺 `information_gain` 即阻断 |
| 目标关键词 | 缺 `target_keyword` 即阻断 |
| AI Summary | 必须恰好 40-60 词 |
| 六段结构 | Hook / What happened / Why now / So what / For you / The data point 缺一即阻断 |
| FAQ | 3-5 问，答案 80-150 词 |
| 字数 | 正文 1500-2500 |
| 对比表 / 定义块 | 各至少 1 个 |
| 分人群建议 | ≥3 |
| 模糊词 | may / might / possibly / perhaps / could / reportedly … |
| AI 套话 | delve / landscape / in today's fast-paced world … |
| 敏感词 | 政策红线黑名单 |
| 正文 URL | 一个都不许有 |




## 五、部署

## 六、相对原型做的改动

原型是视觉稿，转成站点时补了工程必需但原型没有的部分：

1. **SEO 骨架**：canonical、description、OG/Twitter、JSON-LD（WebSite / Article / AboutPage）、
   sitemap-index.xml、robots.txt、RSS —— 原型一个都没有。
2. **修掉中文混入**：原型 Related Reading 里那条 `保税物流` 已改成英文
   （`Bonded Logistics Growth of 42.3%...`）。
3. **订阅框变成真表单**：`<form>` + `<label>` + `required`，不再是裸 input/button。
   **但还没有后端**：`src/consts.ts` 的 `newsletterAction` 为空，接 Buttondown/ConvertKit 时填上即可。
4. **移动端导航**：原型在 ≤900px 直接 `display:none`，现在有 Menu 按钮可展开。
5. **Today's Numbers 不再写死**：由文章数量、P0/P1 条数、覆盖栏目数实时算出，
   不会出现原型那种编造的数字。
6. **标题层级修正**：原作者卡用了 `h5`、相关阅读用了 `h6`，现在按语义归位。
7. **无障碍**：skip link、`:focus-visible`、`aria-current`、图片 alt、`<main id="main">`。
8. **示例文章**：`src/content/blog/` 下 6 篇是**占位样例**（文件顶部有注释标明），
   数字是示意性的，上线前必须替换成真实取材的稿件 —— 规范 §7 明令不编造数据。

## 七、待你确认 / 待补
★ 所以不需要 git filter-repo。 那件事会重写 264 个提交的历史，只在确实超限时才值得做，而现在离限制还有 93%。

★ 我把判断标准也给你：到 400 MB 再做，那时候梯度也还在（一次 gc + 一次 filter-repo 能回收大部分）。

## 八、规范里还没落地的部分


