# 谷歌官方 SEO 学习总结（Landed Math 专用）

- 调研对象：`https://landedmath.com`（Astro 7 静态站，Cloudflare Pages，英文单语，22 篇已发布文章）
- 依据范围：**仅** Google 官方文档（developers.google.com/search、web.dev），不含任何第三方 SEO 博客
- 抓取日期：2026-10-07
- 抓取方式：全文抓取官方页面并保留原文，落地在 `_research/gdocs/`（43 个文件）；同时实测线上站点与本地仓库

## 0. 先立规矩：三种说法的区别

这份总结严格区分 Google 的三种表述，后文每个结论都标明属于哪一档：

| 档位 | Google 的措辞 | 含义 | 违反后果 |
|---|---|---|---|
| **硬性要求（requirement / must）** | "technical requirements"、"must follow these guidelines"、"shouldn't violate" | 决定**能否被索引 / 能否出现在结果里** | 不被索引，或收到 manual action（人工处置） |
| **排名相关信号（used by ranking systems）** | "Core Web Vitals are used by our ranking systems" | Google 明说它进了排序系统 | 影响排名，但不影响索引 |
| **建议 / 常见做法（recommend / best practice）** | "we recommend"、"consider" | 官方建议，不是门槛 | 无直接惩罚，只失去机会 |

**一个必须记住的前提**，Google 在每个核心页面都重复了一遍：

> "just because a page meets all of these requirements and best practices, doesn't mean that Google will crawl, index, or serve its content."
> —— https://developers.google.com/search/docs/essentials

也就是说：**符合全部官方要求 ≠ 会被收录 ≠ 会排名**。这份文档能优化的是"消除人为障碍"，不是"保证结果"。

---

## 1. 官方硬性要求

### 1.1 技术硬性要求只有 3 条

来源：https://developers.google.com/search/docs/essentials/technical

Google 原文：**"As long as your page meets the minimum technical requirements, it's eligible to be indexed by Google Search"**，只有三条：

1. **Googlebot isn't blocked** —— 爬虫能找到并访问该页。原文："Google only indexes pages on the web that are accessible to the public and which don't block our crawler, Googlebot, from crawling them. If a page is made private, such as requiring a log-in to view it, Googlebot will not crawl it."
2. **The page works** —— 必须返回 **HTTP 200**。原文："Google only indexes pages that are served with an HTTP 200 (success) status code. Client and server error pages aren't indexed."
3. **The page has indexable content** —— 文本属于 Google 支持的文件类型，**且内容不违反 spam policies**。

原文紧接着的一句限定：**"Just because a page meets these requirements doesn't mean that a page will be indexed; indexing isn't guaranteed."**

### 1.2 一个极易搞错的硬性区别：robots.txt ≠ noindex

来源：https://developers.google.com/search/docs/essentials/technical 与 https://developers.google.com/search/docs/crawling-indexing/robots/intro

> "While blocking Googlebot with a robots.txt file will prevent crawling, a page's URL might still appear in search results. To instruct Google not to index a page, use noindex and allow Google to crawl the URL."

robots.txt 页面自己的警告：

> "**Don't use a robots.txt file as a means to hide your web pages** … from Google Search results."

**禁止收录只能靠 `noindex`（meta 标签或 HTTP 头），且必须同时允许抓取。** 这是硬性机制，不是建议。

### 1.3 Spam policies：硬性门槛

来源：https://developers.google.com/search/docs/essentials/spam-policies

> "**To be eligible to appear in Google web search results, content … shouldn't violate** Google Search's overall policies or the spam policies listed on this page."

> "Sites that violate our policies **may rank lower in results or not appear in results at all**."

两条重要限定，说明它不是机械规则：

- "We detect policy-violating practices both through automated systems and, as needed, **human review** that can result in a manual action."
- "Our policies cover common spam practices, but **Google may act against any type of spam practices we detect**."（即：清单不是穷尽的）

### 1.4 明确**不是**硬性要求的东西（官方原话）

这一节最关键，因为绝大多数"SEO 必须做"的说法在此被官方否定。

| 项目 | Google 原话 | 出处 |
|---|---|---|
| **canonical（rel="canonical"）** | "**While we encourage you to use these methods, none of them are required**; your site will likely do just fine without specifying a canonical preference." / "indicating a canonical preference is **a hint, not a rule**." | [consolidate-duplicate-urls](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)、[canonicalization](https://developers.google.com/search/docs/crawling-indexing/canonicalization) |
| **sitemap** | "A sitemap helps search engines discover URLs on your site, but **it doesn't guarantee that all the items in your sitemap will be crawled and indexed**." / 500 页以下且内链完整的小站"might not need a sitemap" | [sitemaps/overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) |
| **sitemap 的 `<priority>` / `<changefreq>`** | "**Google ignores `<priority>` and `<changefreq>` values**." | [sitemaps/build-sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| **Article 结构化数据** | "**There are no required properties**; instead, add the properties that apply to your content." | [structured-data/article](https://developers.google.com/search/docs/appearance/structured-data/article) |
| **Organization 结构化数据** | "**There are no required properties**; instead, we recommend adding as many properties that are relevant to your organization." | [structured-data/organization](https://developers.google.com/search/docs/appearance/structured-data/organization) |
| **移动版页面** | "**While it's not required** to have a mobile version of your pages to have your content included in Google's Search results, **it is very strongly recommended**." | [mobile-first-indexing](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) |
| **AI Overviews / AI Mode 的特殊优化** | "**There are no additional requirements** to appear in AI Overviews or AI Mode, nor other special optimizations necessary." | [ai-features](https://developers.google.com/search/docs/appearance/ai-features) |
| **结构化数据是否必需（针对生成式 AI）** | "**Structured data isn't required for generative AI search, and there's no special schema.org markup you need to add.**" | [ai-optimization-guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) |
| **E-E-A-T** | "**While E-E-A-T itself isn't a specific ranking factor**, using a mix of factors that can identify content with good E-E-A-T is useful." | [creating-helpful-content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |

**相反的：结构化数据里真正有硬性 required 字段的是 Breadcrumb。** 来源：https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

- "To specify breadcrumbs, define a `BreadcrumbList` that contains **at least two `ListItem`s**. You **must** include the required properties for your content to be eligible for display with breadcrumbs."
- `BreadcrumbList` 必填：`itemListElement`
- `ListItem` 必填：`item`（**最后一项可省略**——"If the breadcrumb is the last item in the breadcrumb trail, `item` is not required"）、`name`、`position`

### 1.5 一条新的、容易被漏掉的硬性要求（生成式 AI 功能）

来源：https://developers.google.com/search/docs/fundamentals/ai-optimization-guide

> "In addition to the technical requirements for Search, **a site must be included in Search generative AI features in Search Console to be eligible for display in generative AI features on Google Search**."

这是 2026 年新增的**硬性 gate**：只满足技术三条件还不够，还要在 Search Console 里把站点纳入生成式 AI 功能。**这条必须在 GSC 里人工确认**（见第 7 节，标记为"需核实"）。

---

## 2. E-E-A-T 在实操上意味着什么

来源：https://developers.google.com/search/docs/fundamentals/creating-helpful-content

### 2.1 先纠正定义

Google 的原话是：

> "To do this, they identify a mix of factors that can help determine which content demonstrates aspects of **experience, expertise, authoritativeness, and trustworthiness**, or what we call E-E-A-T."

> "**Of these aspects, trust is most important.** The others contribute to trust, but content doesn't necessarily have to demonstrate all of them."

> "**While E-E-A-T itself isn't a specific ranking factor**, using a mix of factors that can identify content with good E-E-A-T is useful."

还有一句关于 YMYL 的：

> "our systems give **even more weight** to content that aligns with strong E-E-A-T for topics that could significantly impact the health, **financial stability**, or safety of people, or the welfare or well-being of society. We call these 'Your Money or Your Life' topics, or YMYL."

**对 Landed Math 的含义**：站点内容是"中国贸易政策 → 每单位到岸成本"，读者会据此定价、签合同、订舱、选路线，即**直接进入财务决策**。按 Google 对 YMYL 的定义（financial stability），这类内容应被当作需要更强 E-E-A-T 的题材来处理。

⚠️ 注意区分：Google **没有**点名"贸易政策/关税"属于 YMYL，上面的归类是我依据官方 YMYL 定义做出的推断，不是 Google 的声明。

### 2.2 质量评估员指南（QRG）：怎么用、别误会

来源：https://developers.google.com/search/docs/fundamentals/creating-helpful-content 与 https://developers.google.com/search/docs/fundamentals/using-gen-ai-content

> "**Search raters have no control over how pages rank. Rater data is not used directly in our ranking algorithms.** Rather, we use them as a restaurant might get feedback cards from diners."

> "These guidelines **are not a guide to ranking first in Google**; they're used by our search raters to help evaluate the performance of our various search ranking systems, and **their ratings don't directly influence ranking**."

**正确用法**：把 QRG 当成"自检清单"来校准内容方向，而不是当成可以"照着刷分"的排名规则。使用 AI 生成内容时，官方**明确点名**要看两节：

- 4.6.5 scaled content abuse（规模化内容滥用）
- 4.6.6 低投入 / 低原创 / 低附加值的主内容

### 2.3 一人站点真正能生产的 E-E-A-T 信号

Google 在 `creating-helpful-content` 里给了 **Who / How / Why** 三问框架，全部都是**一人站点可以诚实满足**的：

**Who（谁写的）**

> "Is it self-evident to your visitors who authored your content?"
> "Do pages carry a byline, where one might be expected?"
> "**Do bylines lead to further information about the author or authors involved, giving background about them and the areas they write about?**"
> "We **strongly encourage** adding accurate authorship information, such as bylines to content where readers might expect it."

红线，原文：

> "However, **avoid using deceptive authorship information. Fabricating creator profiles (such as by using AI-generated headshots, made-up names, or false credentials to make content appear as if it was written by human experts) is a form of deception.** Any form of deception makes a page untrustworthy to both users and our automated quality systems, and is a signal of a low-quality page."

作者标记最佳实践（https://developers.google.com/search/docs/appearance/structured-data/article）：

> "To help Google better understand who the author is, we **strongly recommend** using the `type` and `url` (or `sameAs`) properties. Use valid URLs for the `url` or `sameAs` properties."

**How（怎么做的）**

> "It's helpful to readers to know how a piece of content was produced: this is the 'How' to consider including in your content."
> "If automation is used to substantially generate content, here are some questions to ask yourself: Is the use of automation, including AI-generation, self-evident to visitors through disclosures or in other ways? Are you providing background about how automation or AI-generation was used to create content? Are you explaining why automation or AI was seen as useful?"

**Why（为什么做）**

> "'Why' is perhaps the most important question to answer about your content. … The 'why' should be that you're creating content primarily to help people, content that is useful to visitors **if they come to your site directly**."

### 2.4 一人站可实际落地的清单（依据上述官方条目映射）

| 官方要求 | Landed Math 可执行的形态 | 当前状态 |
|---|---|---|
| 清楚的 Who | 具名 byline + 可点进作者页/About，说明背景与领域 | byline 为"V"，**无作者页**，标记里无 `author.url` |
| 不伪造作者 | 不用 AI 头像、不编造履历 | 已遵守（`AUTHOR.avatar` 为空字符串，未伪造） |
| 说明 How | 每篇有"How this was made"段落 | **已做**（ArticleLayout 内置，且带 `/about/` 链接） |
| 说明 Why | About 页讲清站点目的与受众 | **已做**，`/about/` 写明双受众与立场 |
| 清晰的信息来源 | Sources 段 + 具名机构 + 检索日期 | **已做**，`/sources/` 记录 195 个数字、119 个具名来源 |
| 可核查的准确性 | 每个数字五要素（value/unit/period/source/retrieved） | **已做**，写进 content schema |
| 透明的更正机制 | 带日期的更正记录 | **部分**：仅 2 篇有 `revisions` |
| 承认能力边界 | 明确写出"读不到的一手资料" | **已做**，`/sources/` 有专节"我们读不到的东西" |

**结论**：Landed Math 在 "How / Why / 来源透明度" 上已经做得比绝大多数同类站强，这几项是真正的护城河。**短板集中在 "Who"**——byline 是一个单字母"V"，既没有作者页，结构化数据里也没有 `author.url`，而 Google 把这三点（是否有 byline、byline 是否指向作者背景信息、作者身份是否可核）写成了明确的评估问题。

需要强调：Google 说"不要伪造作者"，所以**正确做法不是编一个更丰满的假人**，而是把真实存在的背景写出来（`/about/` 已有真实内容："Years on the sourcing and platform side of cross-border commerce: Amazon FBA, TikTok Shop and Temu, in consumer electronics and home goods"）并让 byline 能指向它。

---

## 3. 技术要点

### 3.1 URL 结构

来源：https://developers.google.com/search/docs/crawling-indexing/url-structure

官方把这一页分成 **Requirements（硬性）** 和 **Best practices（建议）** 两部分。

**硬性 Requirements：**

1. **Follow IETF STD 66** —— reserved 字符必须 percent-encode
2. **Don't use URL fragments to change content** —— "Google Search generally doesn't support URL fragments"
3. **Use a common encoding for URL parameters** —— `=` 分隔键值，`&` 追加参数

**建议 Best practices：**

- **Use descriptive URLs** —— 用可读词，不用长 ID："use readable words rather than long ID numbers"
- **Use your audience's language** —— 用受众语言（英文站即英文）
- **Use hyphens to separate words** —— "we recommend using hyphens (`-`) instead of underscores (`_`)"
- **Use as few parameters as you can**
- **Be aware that URLs are case sensitive** —— "/APPLE and /apple as distinct URLs"
- 多地区站用 locale-specific URL

**Astro 静态站该做的**：`trailingSlash` 行为要唯一化（见 7.1，实测已正确）；slug 全小写、连字符分隔、无参数、无 fragment；避免 `?ref=` 之类跟踪参数进入可抓取链接。当前 33 个 sitemap URL 全部是干净路径，无参数、无 fragment ✅

### 3.2 内链与可抓取链接

来源：https://developers.google.com/search/docs/crawling-indexing/links-crawlable

**硬性机制：**

> "Generally, Google can **only crawl your link if it's an `<a>` HTML element … with an `href` attribute**. Most links in other formats won't be parsed and extracted by Google's crawlers."

可用：`<a href="https://example.com">`、`<a href="/products/category/shoes">`、`<a href="..." onclick="...">`
不可靠：`<a routerLink="...">`、`<span href="...">`、`<a onclick="goto(...)">`、`<a href="javascript:...">`

> "As a fallback, Google can use the `title` attribute as anchor text if the `<a>` element is for some reason empty."
> "For images as links, Google uses the `alt` attribute of the `img` element as anchor text."

**内链的官方定性：**

> "**Every page you care about should have a link from at least one other page on your site.** Think about what other resources on your site could help your readers understand a given page on your site, and link to those pages in context."
> "**There's no magical ideal number of links** a given page should contain. However, if you think it's too much, then it probably is."

**外链与可信度（对 Landed Math 直接相关）：**

> "Linking to other sites isn't something to be scared of; in fact, **using external links can help establish trustworthiness (for example, citing your sources)**."
> "Use `nofollow` **only when you don't trust the source**, and not for every external link on your site."

⚠️ **这条对 Landed Math 是一个需要正视的冲突点**：项目规范 §4.3 规定"正文中不放 URL"，来源只以**名字**列在 Sources 段。Google 明确说"引用来源的外部链接有助于建立可信度"（citing your sources）。当前做法在**合规与防抄**上有理由（不让竞争对手顺着链接抄来源），但它也确实放弃了 Google 点名的那个信任信号。这不是错误，而是一个**有代价的取舍**，本总结只陈述官方立场，不替项目做决定。

**Astro 静态站该做的**：确认导航/页脚/相关阅读全部是原生 `<a href>`；Astro 默认输出原生 `<a>`，无需改造。`aria-current="page"` 不影响抓取。

### 3.3 Sitemap

来源：https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview、https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap

**是否需要（官方判断标准）：**

- **需要**：站点大；站点新且外链少；有大量富媒体或出现在 Google News
- **不需要**："Your site is 'small'. By small, we mean **about 500 pages or fewer**"；内链完整可从首页到达全部重要页

Landed Math 只有 33 个 URL，**严格按官方标准属于"不需要 sitemap"**。但官方也说 "in most cases, your site will benefit from having a sitemap"，且站点新、外链少，正好命中"新站外链少"这条 —— **保留 sitemap 是合理的**。

**硬性规格：**

- 单个 sitemap ≤ **50MB（未压缩）或 50,000 URL**
- 文件必须 **UTF-8**
- 必须用**完全限定的绝对 URL**："if your site is at https://www.example.com/, don't specify a URL such as /mypage.html"
- 建议放在**站点根目录**（除非通过 Search Console 提交，否则 sitemap 只影响其父目录以下）

**Google 明确说的忽略项：** "Google ignores `<priority>` and `<changefreq>` values."

**`<lastmod>` 的精确规则：**

> "Google uses the `<lastmod>` value **if it's consistently and verifiably (for example by comparing to the last modification of the page) accurate**."
> "The `<lastmod>` value should reflect the date and time of the **last significant update** to the page. … an update to the main content, the structured data, or links on the page is generally considered significant, **however an update to the copyright date is not**."

注意措辞：`lastmod` 不是"填了就一定被采信"，而是**只有在持续且可验证地准确时才被使用**。填不准反而有害。

### 3.4 robots.txt

来源：https://developers.google.com/search/docs/crawling-indexing/robots/intro

> "A robots.txt file tells search engine crawlers which URLs the crawler can access on your site. This is used mainly **to avoid overloading your site with requests; it is not a mechanism for keeping a web page out of Google**."

**三条限制（官方原文）：**

- "robots.txt rules **may not be supported by all search engines**"
- "Different crawlers interpret syntax differently"
- "**A page that's disallowed in robots.txt can still be indexed if linked to from other sites.**"（URL 和锚文本仍可能出现在结果里，只是没有描述）

**Astro 静态站该做的**：`src/pages/robots.txt.ts` 生成的 robots.txt 里 `Sitemap:` 行跟随 `site` 配置，这是正确做法（单一事实来源）。不要用它来"隐藏"任何页面。

### 3.5 Canonical

来源：https://developers.google.com/search/docs/crawling-indexing/canonicalization、https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

**官方定性：** "indicating a canonical preference is **a hint, not a rule**"；"**Google may choose a different page as canonical than you do**"。

**信号强度排序（官方）：**

1. **Redirects** —— "A **strong** signal that the target of the redirect should become canonical."
2. **rel="canonical"** —— "A **strong** signal that the specified URL should become canonical."
3. **Sitemap inclusion** —— "A **weak** signal that helps the URLs that are included in a sitemap become canonical."

> "these methods can stack and thus become more effective when combined"

**Best practices（官方原文，逐条）：**

- "**Don't use the robots.txt file for canonicalization purposes.**"
- "Don't use the URL removal tool for canonicalization."
- "Don't specify different URLs as canonical for the same page using different canonicalization techniques."
- "Don't specify a URL fragment as canonical."
- "**Do include a `rel="canonical"` link on the canonical page itself (also known as a self-referential canonical).**"
- "We don't recommend using `noindex` to prevent selection of a canonical page within a single site … `rel="canonical"` link annotations are the preferred solution."
- "When linking within your site, **link to the canonical URL** rather than a duplicate URL."
- "**Use absolute paths rather than relative paths** with the `rel="canonical"` link element."

**HTTPS 的隐含 canonical 偏好：**

> "**Google prefers HTTPS pages over equivalent HTTP pages as canonical**, except when there are issues or conflicting signals"

会导致反效果的四件事："The HTTPS page has an invalid SSL certificate" / "contains insecure dependencies" / "redirects users to or through an HTTP page" / "has a `rel="canonical"` link to the HTTP page"。

> "**Implement HSTS.**"（列在"确保 HTTPS 被选为 canonical"的三种做法之一）

**Astro 静态站该做的**：`BaseLayout` 从 `Astro.site` 构造绝对 canonical 并对每一页（含 canonical 页自身）输出自引用 canonical —— 这**完全符合**官方 best practice。同时要确保 www / 非 www、`/path` / `/path/` 都收敛到同一个 URL（见 7.1）。

### 3.6 结构化数据

来源：https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data、https://developers.google.com/search/docs/appearance/structured-data/sd-policies

**格式选择（官方）：**

> "we recommend using a format that's easiest for you to implement and maintain (**in most cases, that's JSON-LD**); all 3 formats are equally fine for Google, as long as the markup is valid"
> "Google recommends using JSON-LD … as it's the easiest solution for website owners to implement and maintain at scale (**in other words, less prone to user errors**)"

支持的三种格式：**JSON-LD（推荐）、Microdata、RDFa**。注意：`Data-vocabulary.org` markup **已不再有资格**获得富媒体结果。

**"必填 vs 推荐"的官方表述：**

> "You **must** include all the required properties for an object to be eligible for appearance in Google Search with enhanced display."

但同时给了一个反直觉的优先级建议：

> "**it is more important to supply fewer but complete and accurate recommended properties rather than trying to provide every possible recommended property with less complete, badly-formed, or inaccurate data.**"

**质量硬性条款（sd-policies，违反可致 manual action）：**

- "Don't mark up content that is not visible to readers of the page."（**页面必须能看到**）
- "Don't mark up irrelevant or misleading content"
- "Don't use structured data to deceive or mislead users. Don't impersonate any person or organization, or misrepresent your ownership, affiliation, or primary purpose."
- "Your structured data **must be a true representation of the page content**."
- "Provide up-to-date information. **We won't show a rich result for time-sensitive content that is no longer relevant.**"
- "All image URLs specified in structured data must be **crawlable and indexable**."

**关键预期管理：**

> "**Google does not guarantee that your structured data will show up in search results**, even if your page is marked up correctly according to the Rich Results Test."
> "A structured data manual action means that a page **loses eligibility for appearance as a rich result; it doesn't affect how the page ranks in Google web search**."

**重复页上的结构化数据（官方）：**

> "If you have duplicate pages for the same content, we recommend placing **the same structured data on all page duplicates**, not just on the canonical page."

**Astro 静态站该做的**：因为内容是 Markdown frontmatter 驱动的，JSON-LD 应当在 layout 层生成，保证所有文章一致（当前 `src/pages/blog/[slug].astro` 就是这样做的 ✅）。多类型用数组（`[{...},{...}]`）或嵌套，两者 Google 都懂。

### 3.7 Article / Organization / WebSite 的具体字段

**Article**（https://developers.google.com/search/docs/appearance/structured-data/article）

- 类型必须是 `Article`、`NewsArticle`、`BlogPosting` 之一："Article objects **must** be based on one of the following schema.org types"
- **无 required 字段**；以下全部是 **Recommended**：
  - `author`（Person 或 Organization）、`author.name`（Text）、`author.url`（URL）
  - `dateModified`（DateTime, ISO 8601）、`datePublished`（DateTime, ISO 8601）
  - `headline`（Text）——"Consider using a concise title, as long titles may be truncated on some devices"
  - `image`（Repeated ImageObject or URL）
- **image 的额外要求**：
  - "Image URLs must be crawlable and indexable."
  - "Images must represent the marked up content."
  - "Images must be in a file format that's supported by Google Images."
  - "For best results, we recommend providing multiple high-resolution images (**minimum of 50K pixels** when multiplying width and height) with the following aspect ratios: **16x9, 4x3, and 1x1**."
- **author 标记四条最佳实践**：把所有作者都写进标记 / 多作者各占一个 `author` 字段（不要合并成一个 name 字符串）/ **用 `url` 或 `sameAs`** / `author.name` 里只放名字（不要放职务、敬称、"posted by"）/ 人用 `Person`，机构用 `Organization`
- 技术条款："For multi-part articles, make sure that the rel=canonical points at either each individual page or a 'view-all' page (**and not to page 1 of a multi-part series**)."

**Organization**（https://developers.google.com/search/docs/appearance/structured-data/organization）

- **无 required 字段**
- 官方建议聚焦在这些属性："`name` or `alternateName` for your business name as well as an indication of real-world presence (for example, `address` or `telephone`) and online presence (for example, `url` or `logo`)"
- `logo` 的作用有明确定义："Adding this property can help Google **better understand which logo you want to show**, for example in Search results and knowledge panel"
- 还应放在**首页**："Adding organization structured data **to your home page** can help Google better understand your organization's administrative details and disambiguate your organization"

**WebSite / 站点名称**（https://developers.google.com/search/docs/appearance/site-names）

> "To indicate your site name preference, add **WebSite structured data to your home page**. Our site name system will also consider content in `og:site_name`, `<title>`, heading elements, and other text on a home page. However, **WebSite structured data is most important**, if you want to specify a preference."
> "Only one name per site: … Google Search only supports one site name per site, where a site is defined by the domain or subdomain. **Google Search does not support site names at the subdirectory level.**"

建议提供 `alternateName` 作为备选："Providing an alternative name using the `alternateName` property allows Google to consider other options if your preferred choice isn't selected."

**⚠️ Sitelinks Search Box：该功能已被移除，不要再做。**

请求的 URL `https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox` 抓取时**已不再返回功能文档**（返回的是 Search Central 更新日志页）。官方在 2024-11-29 的 changelog 条目里写明：

> **"What: Removed the sitelinks search box documentation and archived the `nositelinkssearchbox` rule."**
> **"Why: The sitelinks search box feature is no longer available in Google Search results."**
> —— 见 https://developers.google.com/search/blog 的 changelog（该 URL 现重定向至此）

历史版本（现已失效）曾说明 `WebSite` + `SearchAction` + `potentialAction` 的写法。**现在往首页加 `SearchAction` 没有任何搜索外观收益。** 这一点本项目没有做错，但要在以后的"待办清单模板"里彻底删掉，避免被第三方文章重新塞回来。

### 3.8 移动端

来源：https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing

> "Google uses the **mobile version** of a site's content, crawled with the smartphone agent, for indexing and ranking. This is called **mobile-first indexing**."
> "**While it's not required** to have a mobile version of your pages to have your content included in Google's Search results, **it is very strongly recommended**."

三种配置，官方偏好：

> "**Responsive design** … Google recommends Responsive Web Design because it's the easiest design pattern to implement and maintain."

**内容一致性是硬性逻辑**：

> "Make sure that your mobile site contains the same content as your desktop site." / "If it's your intention that the mobile page should have less content than the desktop page, **you can expect some traffic loss**"
> "Use the **same clear and meaningful headings** on the mobile site as you do on the desktop site."
> "Make sure that your mobile and desktop sites have the same structured data."
> "Use the same `robots` meta tags on the mobile and desktop site."

**懒加载红线（对数据密集长文特别相关）：**

> "**Don't lazy-load primary content upon user interaction.** Google won't load content that requires user interactions (for example, swiping, clicking, or typing) to load."

**Astro 静态站该做的**：Astro 输出同一份 HTML，天然是响应式（`<meta name="viewport">` 已存在 ✅），移动端与桌面端内容必然一致，`robots` meta 也必然一致 —— **完全满足 mobile-first indexing**。唯一需要留意的是：**不要把正文表格或关键数字放进需要点击才展开的 `<details>`/tab 里**（Google 能读，但别只放在交互后才生成的内容里）。折叠在 HTML 里是允许的（spam policies 明确把 accordion/tabbed content 列为合规）。

### 3.9 页面体验与速度

见第 6 节。

### 3.10 国际化 / hreflang

来源：https://developers.google.com/search/docs/specialty/international、https://developers.google.com/search/docs/specialty/international/localized-versions

**结论：本项目不需要 hreflang。**

官方前提是"If your site **contains content in different languages**, or with different content for different locations"。Landed Math 是 **纯英文单语单地区**站点（`<html lang="en">`），没有语言/地区变体，因此：

- 不需要 `rel="alternate" hreflang`
- 不需要 locale-specific URL 结构
- 反而**要注意**：canonicalization 文档提到 Google 偏好 "URLs that are part of hreflang clusters" —— 这条对一个没有 hreflang 的单语站**不适用**，不构成劣势

如果未来要加中文/西班牙语版本，正确做法是：`/es/` 子目录 + 双向 hreflang + 每种语言指定自己的 canonical，且按 canonical 文档要求"specify a canonical page in the same language"。

---

## 4. 内容质量

来源（本节除特别注明外）：https://developers.google.com/search/docs/fundamentals/creating-helpful-content

### 4.1 People-first 的自检问题（官方原文）

> "**Do you have an existing or intended audience** for your business or site that would find the content useful **if they came directly to you**?"
> "Does your content clearly demonstrate **first-hand expertise and a depth of knowledge**?"
> "Does your site have a **primary purpose or focus**?"
> "After reading your content, will someone leave feeling **they've learned enough about a topic to help achieve their goal**?"
> "Will someone reading your content leave feeling like they've had a **satisfying experience**?"

### 4.2 会被判定为"搜索引擎优先"的警告信号（官方原文，逐条）

- "Is the content **primarily made to attract visits from search engines**?"
- "Are you producing **lots of content on many different topics** in hopes that some of it might perform well?"
- "Are you using **extensive automation to produce content on many topics**?"
- "**Are you mainly summarizing what others have to say without adding much value?**"
- "Are you writing about things simply because they seem **trending**?"
- "**Does your content leave readers feeling like they need to search again** to get better information from other sources?"
- "Are you writing to a particular word count because you've heard or read that Google has a preferred word count? (**No, we don't.**)"
- "Are you changing the date of pages to make them seem fresh **when the content has not substantially changed**?"
- "Are you adding a lot of new content or removing a lot of older content primarily because you believe it will help your search rankings overall by somehow making your site seem 'fresh?' (**No, it won't**)"

### 4.3 QRG 的"主内容四属性"（官方转述）

> "**Effort**: The extent to which human work went into creating the content or the systems powering it. … Conversely, **automatically generating pages from feeds or using generative AI to produce large amounts of text without manual oversight or curation represents little to no effort. Attribution or giving credit to other sources doesn't replace the need for original effort.**"
> "**Originality**: The extent to which the content offers unique, original information or perspectives that aren't already available on other websites."
> "**Talent or skill**: Whether the content shows the talent, skill, or expertise necessary to provide a satisfying experience for visitors."
> "**Accuracy**: For informational pages, the content should be factually accurate. **For topics that could significantly impact people's lives or well-being (YMYL topics), the content must be highly accurate and consistent with established expert consensus.**"

注意 "Attribution or giving credit to other sources doesn't replace the need for original effort" 这句 —— **"我标注了来源"不能替代原创工作**。这对"翻译/整理官方文件"型的站点是直接警告。

### 4.4 什么会让数据密集的原文分析被判为 spam

来源：https://developers.google.com/search/docs/essentials/spam-policies

**Scaled content abuse（最相关的一条）：**

> "Scaled content abuse is when **many pages are generated for the primary purpose of manipulating search rankings and not helping users**. This abusive practice is typically focused on creating large amounts of unoriginal content that provides little to no value to users, **no matter how it's created**."

官方列举的形态（逐条原文）：

- "Using generative AI tools or other similar tools to **generate many pages without adding value for users**"
- "**Scraping feeds, search results, or other content to generate many pages (including through automated transformations like synonymizing, translating, or other obfuscation techniques)**, where little value is provided to users"
- "**Stitching or combining content from different web pages without adding value**"
- "Creating multiple sites with the intent of hiding the scaled nature of the content"
- "Creating many pages where the content makes little or no sense to a reader but contains search keywords"

并给出了处理建议：**"If you're hosting such content on your site, exclude it from Search."**

**Scraping：**

> "Republishing content from other sites **without adding any original content or value, or even citing the original source**"
> "Copying content from other sites, **modify it only slightly (for example, by substituting synonyms or using automated techniques), and republish it**"
> "Reproducing content feeds from other sites without providing some type of unique benefit to the user"

**Keyword stuffing（对"数据密集"站点风险最高的一条）：**

> "Keyword stuffing refers to the practice of **filling a web page with keywords or numbers** in an attempt to manipulate rankings. Often these keywords appear in a list or group, unnaturally, or out of context."

官方例子里的这两条**直接命中数据型内容**：

- "**Lists of phone numbers without substantial added value**"
- "**Blocks of text that list cities and regions that a web page is trying to rank for**"

**Doorway abuse：**

> "Having multiple domain names or pages targeted at specific regions or cities that funnel users to one page"
> "**Creating substantially similar pages that are closer to search results than a clearly defined, browseable hierarchy**"

**Thin affiliation（本项目无联盟链接，暂不适用，但记录以防将来引入）：**

> "Thin affiliation is the practice of publishing content with product affiliate links where the product descriptions and reviews are **copied directly from the original merchant without any original content or added value**."

**Site reputation policy（本项目无第三方内容，不适用）：** 前提是"**third-party content is published on a host site mainly because of that host's already-established ranking signals**"。自己写的内容不受此约束。

### 4.5 对本项目的具体判断

**风险最高的三种失败模式（都能用官方条款直接指认）：**

1. **"把官方文件翻成英文 + 加个表格"就发布。** 命中 QRG 的 "little to no effort"（自动从 feed 生成 / 用生成式 AI 大量产出而无人审）、以及 Scraping 里的 "citing the original source 也不能免责"。Google 的原话是 attribution **不替代**原创工作。
2. **为覆盖长尾而按"政策 × 品类 × 国家"批量铺页。** 命中 scaled content abuse 的 "generate many pages without adding value" 与 Doorway 的 "substantially similar pages"。**这是本项目和同类站最需要克制的冲动**：政策数量 × 品类数量 × 市场数量很容易膨胀到几百页模板内容。
3. **表格里堆数字/国家/港口名。** Keyword stuffing 官方例子里的 "lists of ... numbers without substantial added value" 和 "blocks of text that list cities and regions" 就是这个形状。

**保护它的是"每单位成本换算"这个动作本身：**

| 官方条款 | Landed Math 已有的对应物 |
|---|---|
| "original information, reporting, **research, or analysis**" | `figures` 五要素 + `information_gain: custom-calculation` |
| "provide **substantial additional value and originality**" beyond sources | 把 FOB/税率/运费换算成 per-unit、per-container，这是**官方文件里没有的** |
| "shouldn't violate ... **scaled content abuse**" | 22 篇（而非 220 篇），且有 `information_gain` 前置门槛 |
| QRG "**Effort**" | 人工核对每个数字到一手来源；`/sources/` 记录 195 个数字的检索日期 |
| QRG "**Originality**" | `cross-source` / `own-data` 的增值方式 |
| `sd-policies` "Provide original content that **you or your users have generated**" | 自建 CBAM 计算模型（`src/lib/cbam.mjs`） |
| "accuracy ... **must be highly accurate**"（YMYL） | 具名一手来源 + 检索日期 + 更正月志 |

**一句话结论**：这个站点的内容形态**天生贴近 Google 奖励的那一类**（原始分析、计算、一手来源）。真正会杀死它的是"为了规模而稀释"——即把 `information_gain` 门槛放开、批量生成同构页面。**当前 22 篇 + 7 篇草稿的节奏是安全的；危险的是把它变成"政策库"。**

---

## 5. AI 生成内容

### 5.1 Google 的实际立场（精确表述）

来源：https://developers.google.com/search/blog/2023/02/google-search-and-ai-content（Danny Sullivan & Chris Nelson，2023-02-08）

**核心原则——看质量，不看生产方式：**

> "**Our focus on the quality of content, rather than how content is produced**, is a useful guide that has helped us deliver reliable, high quality results to users for years."

**什么违规：**

> "Using automation—including AI—to generate content with **the primary purpose of manipulating ranking in search results** is a violation of our spam policies."

**什么不违规（官方 FAQ 原文）：**

> **"Is AI content against Google Search's guidelines?"** → "**Appropriate use of AI or automation is not against our guidelines.** This means that it is not used to generate content primarily to manipulate search rankings, which is against our spam policies."
> **"Why doesn't Google Search ban AI content?"** → "Automation has long been used in publishing to create useful content."
> "**it's important to recognize that not all use of automation, including AI generation, is spam.** Automation has long been used to generate helpful content, such as sports scores, weather forecasts, and transcripts."

**AI 不是排名加成：**

> **"Will AI content rank highly on Search?"** → "**Using AI doesn't give content any special gains. It's just content.** If it is useful, helpful, original, and satisfies aspects of E-E-A-T, it might do well in Search. If it doesn't, it might not."

**该不该用：**

> **"Should I use AI to generate content?"** → "If you see AI as an essential way to help you produce content that is helpful and original, it might be useful to consider. **If you see AI as an inexpensive, easy way to game search engine rankings, then no.**"

**能不能署 AI 的名：**

> **"Can I list AI as the author of content?"** → "**Giving AI an author byline is probably not the best way** to follow our recommendation to make clear to readers when AI is part of the content creation process."

### 5.2 更细的实操要求

来源：https://developers.google.com/search/docs/fundamentals/using-gen-ai-content

> "Generative AI can be particularly useful when researching a topic, and to add structure to original content. However, **using generative AI tools or other similar tools to generate many pages without adding value for users may violate Google's spam policy on scaled content abuse**."

**必须人工核实——包括元数据：**

> "**generative models don't retrieve facts, but predict a likely sequence of words** based on their training data. Because of this, generative AI outputs may contain inaccuracies (also known as hallucinations). **It is critical to manually factcheck and review all AI-generated content for accuracy and trustworthiness before publishing.**"
> "This review **also applies to metadata** like `<title>` elements, meta description elements, **structured data**, and alternate texts for images, which can appear in Search results."

⚠️ 这条直接约束本项目：**不要用 AI 生成文章、然后用 AI 顺手生成 JSON-LD、meta description、alt 文本，且不核对。** 官方把元数据点名列入了必须核实的范围。

**披露（disclosure）：**

> "Sharing information about **how a piece of content was created** can help give your readers more context. If you're automatically generating content, **consider adding information on how your content was created** in a way that makes sense for your audience."
> FAQ: "AI or automation disclosures are **useful** for content where someone might think 'How was this created?'. **Consider adding these when it would be reasonably expected.**"

注意措辞是 "consider" / "useful"，**不是硬性要求**。本项目已做的 "How this was made" 段落**超出了**官方的建议强度（那是为了满足 EU AI Act 第 50 条，属于法规义务，不是 Google 要求）。

### 5.3 生成式 AI 功能（AI Overviews / AI Mode）

来源：https://developers.google.com/search/docs/appearance/ai-features、https://developers.google.com/search/docs/fundamentals/ai-optimization-guide

**没有特殊要求：**

> "The best practices for SEO remain relevant for AI features in Google Search (such as AI Overviews and AI Mode). **There are no additional requirements** to appear in AI Overviews or AI Mode, nor other special optimizations necessary."
> "To be eligible to be shown as a supporting link in AI Overviews or AI Mode, a page must be **indexed and eligible to be shown in Google Search with a snippet**, fulfilling the Search technical requirements. **There are no additional technical requirements.**"

**两条硬性 gate（重复强调）：**

1. 必须被索引且**允许显示 snippet**（若被 `nosnippet` / `max-snippet:0` 限制，就不合格）
2. "**a site must be included in Search generative AI features in Search Console**"（ai-optimization-guide）

**Google 明确说"不用做"的事（"Mythbusting" 一节，逐条原文）：**

- **`llms.txt` 及类似"特殊标记"**："**You don't need to create new machine readable files, AI text files, markup, or Markdown** to appear in Google Search (including its generative AI capabilities), as **Google Search itself doesn't use them**." / "Doing so will **neither harm nor help** your site's visibility or rankings in Google Search, **as Google Search ignores them**."
- **"Chunking" 内容**："There's no requirement to break your content into tiny pieces for AI to better understand it."
- **为 AI 重写内容**："You don't need to write in a specific way just for generative AI search."
- **追求不真实的 "mentions"**："seeking inauthentic 'mentions' across the web isn't as helpful as it might seem."
- **过度关注结构化数据**："Structured data isn't required for generative AI search, and there's no special schema.org markup you need to add."
- **`ai-features` 页同样声明**："You don't need to create new machine readable files, AI text files, or markup to appear in these features. **There's also no special schema.org structured data that you need to add.**"

**关于 AEO / GEO：**

> "What about 'AEO' and 'GEO'? … **From Google Search's perspective, optimizing for generative AI search is optimizing for the search experience, and thus still SEO.**"
> "Be wary of third-party tools that promise ranking success or claim to use 'internal' Google metrics. **No third-party tool has access to our internal ranking or AI systems.**"

**内容要求的实质（"non-commodity content"）：**

> "Creating content that people find unique, compelling, and useful will likely influence your website's presence in generative AI search in the long run **more than any of the other suggestions in this guide**."
> "**Commodity content** (for example, something like '7 Tips for First-Time Homebuyers') is often based on common knowledge … and typically adds little unique insight. In contrast, **non-commodity content** … provides unique expert or experienced takes that go beyond common knowledge and the ordinary."
> "Don't just recycle what others on the internet have already said, **or could easily be produced by a generative AI model**."

**对 Landed Math 的直接含义**：站点定位是"把中文一手贸易政策数据换算成每单位到岸成本"，即"**别人（含 LLM）不容易产出**"的换算结果。这恰好是官方定义的 non-commodity content。**关键是不能退化成"政策摘要"**——政策摘要正是"could easily be produced by a generative AI model"的那一类。

**衡量方式：**

> "sites appearing in AI features … are included in the overall search traffic in Search Console. In particular, they're reported on in the **Performance report**, within the **'Web' search type**."
> "use the **Generative AI performance report** in Search Console"

### 5.4 内容控制（如果将来想限制）

来源：https://developers.google.com/search/docs/appearance/ai-features

> "AI is built into Search and integral to how Search functions, which is why **robots.txt directives for Googlebot is the control** for site owners to manage access to how their sites are crawled for Search. To limit the information shown from your pages in Search, use `nosnippet`, `data-nosnippet`, `max-snippet`, or `noindex` controls."
> "To limit AI training and grounding in some of **Google's other systems**, read more about **Google-Extended**."

注意：`Google-Extended` 只影响 Google 的其他系统（训练/grounding），**不影响** Search 的 AI Overviews。想同时被 AI Overviews 引用又是 SEO 目标的话，**不要屏蔽 Googlebot，也不要用 nosnippet**。

---

## 6. Core Web Vitals 的具体阈值

### 6.1 三个指标与阈值

来源：https://web.dev/articles/vitals、https://developers.google.com/search/docs/appearance/core-web-vitals

| 指标 | 测什么 | **good 阈值** | 生命周期状态 |
|---|---|---|---|
| **LCP**（Largest Contentful Paint） | 加载性能 | **≤ 2.5 秒**（从页面开始加载算起） | Stable |
| **INP**（Interaction to Next Paint） | 交互响应 | **≤ 200 毫秒** | Stable |
| **CLS**（Cumulative Layout Shift） | 视觉稳定性 | **≤ 0.1** | Stable |

两处官方措辞的细微差别（都很重要）：

- web.dev："LCP **should occur within 2.5 seconds** of when the page first starts loading" / "pages should have a INP of **200 milliseconds or less**" / "pages should maintain a CLS of **0.1 or less**"
- Google Search 文档："strive to have **LCP occur within the first 2.5 seconds**" / "strive to have **an INP of less than 200 milliseconds**" / "strive to have **a CLS score of less than 0.1**"

### 6.2 最容易漏掉的一条：75 分位

来源：https://web.dev/articles/vitals

> "To ensure you're hitting the recommended target for these metrics for most of your users, a good threshold to measure is **the 75th percentile of page loads, segmented across mobile and desktop devices**."
> "Tools that assess Core Web Vitals compliance should consider **a page passing if it meets the recommended targets at the 75th percentile for all three** of the Core Web Vitals metrics."

即：**必须在 p75、且移动端与桌面端分开看、且三项全达标**，才算通过。

### 6.3 实验室测不了 INP

> "Tools like Lighthouse that load pages in a simulated environment without a user **cannot measure INP**, as there is no user input. However, the **Total Blocking Time (TBT)** metric is lab-measurable and is a proxy for INP."

所以：**Lighthouse / PageSpeed Insights 的分数不能替代真实用户数据。** 官方明说 "lab measurement … is not a substitute for field measurement"。

### 6.4 Core Web Vitals 到底算不算排名因素

来源：https://developers.google.com/search/docs/appearance/page-experience

这一页的 FAQ 讲得最清楚，逐条：

> **"Is there a single 'page experience signal' that Google Search uses for ranking?"** → "**There is no single signal.** Our core ranking systems look at a variety of signals that align with overall page experience."
> **"What aspects of page experience are used in ranking?"** → "**Core Web Vitals are used by our ranking systems.** We recommend site owners achieve good Core Web Vitals for success with Search."
> "**Beyond Core Web Vitals, other page experience aspects don't directly help your website rank higher in search results.** However, they can make your website more satisfying to use."
> **"How important is page experience to ranking success?"** → "Google Search always seeks to show the most relevant content, **even if the page experience is sub-par**. But for many queries, there is lots of helpful content available. Having a great page experience can contribute to success in Search, in such cases."

以及一句防止过度优化的：

> "getting good results in reports like Search Console's Core Web Vitals report or third-party tools **doesn't guarantee that your pages will rank at the top** … **trying to get a perfect score just for SEO reasons may not be the best use of your time.**"

**准确的结论**：Core Web Vitals **是**排名信号（Google 明说）；但它是 **tie-breaker 性质**（在"内容都很好"的查询里起作用），不是能靠刷分拿排名的杠杆。

### 6.5 在静态站上真正能推动这三项的动作

基于已读官方文档，加上对本站实测结果：

**推动 LCP（≤2.5s）**

| 动作 | 依据 / 本站现状 |
|---|---|
| 降低 TTFB（服务器响应） | web.dev 把 TTFB 列为 "useful in diagnosing issues with LCP (slow server response times …)"。**本站 HTML 响应头是 `Cache-Control: public, max-age=0, must-revalidate`** → 每次访问都回源，CDN 不缓存 HTML。这是本站 LCP 最大的可控变量 |
| 启用 HTML 边缘缓存 | 静态站最直接的 TTFB 改善手段。`/_astro/*` 已经是 `max-age=31536000, immutable` ✅，但 HTML 没有 |
| 消除 render-blocking 资源 | 本站 CSS 由 Astro 打包成单个 `/_astro/BaseLayout.*.css`，且 **CSP 是 meta 标签**（不阻塞） |
| 不做懒加载 LCP 元素 | 官方禁止对主内容 lazy-load；本站无图片，暂时无此问题（**代价是也没有图片带来的信息量**） |
| 字体：`font-display: swap` + 预加载 | 未在本次范围内核实本站字体策略 → 标记"需核实" |

**推动 INP（≤200ms）**

| 动作 | 本站现状 |
|---|---|
| 减少主线程长任务 | 本站 JS 极少：只有一个模块化 nav 切换脚本 + 可选的 Cloudflare beacon（`defer`）。INP 风险极低 |
| 避免大型第三方脚本 | **无任何第三方分析脚本**（GA4 被明确否决），这是 INP 上的结构性优势 |
| 事件处理器保持轻量 | nav toggle 只改 `dataset.open` 和 `aria-expanded` ✅ |
| ⚠️ 若将来嵌入 YouTube | `ArticleVideo.astro` 已存在但 `youtube_id` 使用数为 **0**。真嵌入时要 lazy-load iframe，否则 iframe 是 CLS 与 INP 的常见来源 |

**推动 CLS（≤0.1）**

| 动作 | 本站现状 |
|---|---|
| 给所有图片写死 `width`/`height` | `ArticleLayout.astro` 的 hero `<img>` **已写死 width="1200" height="750"** ✅（目前 0 篇使用） |
| 预留广告/嵌入位 | 无广告 ✅（隐私页承诺 "No advertising networks"，也排除了 AdSense） |
| 避免字体替换造成位移 | 需核实 |
| 避免动态注入内容 | 内容全部静态，无客户端注入正文 ✅ |

**结论**：本站的 CWV 风险结构是**"没有风险源，但也没有优化动作"** —— 没有图片、没有广告、没有第三方脚本、JS 极少，所以 LCP/INP/CLS 很可能本来就达标。唯一明确的短板是 **HTML 不走 CDN 缓存**（TTFB）。

⚠️ **本次调研未能取得实测 CWV 数据**：PageSpeed Insights API 连续两次返回 HTTP 429（未使用 API key，共享 IP 限流），CrUX 也未取到。因此第 7 节里 CWV 相关条目一律标记 **需核实**，并给出可自测的命令。

---

## 7. 本项目的检查清单

**标记规则**：`已做` = 本次通过公开 URL 或本地仓库**实测确认**；`待做` = 已确认缺失；`需核实` = 无法从公开信息确认，需在 GSC 或本地测量。

### 7.1 索引与抓取

| # | 检查项 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | `robots.txt` 允许抓取并声明 sitemap | **已做** | `curl -s https://landedmath.com/robots.txt` → `User-agent: *` / `Allow: /` / `Sitemap: https://landedmath.com/sitemap-index.xml` |
| 2 | 所有页面返回 HTTP 200 | **已做** | `curl -o /dev/null -s -w "%{http_code}\n" https://landedmath.com/` → `200` |
| 3 | 不存在的页面返回真实 404 | **已做** | `curl -o /dev/null -s -w "%{http_code}\n" https://landedmath.com/no-such-page-xyz/` → `404` |
| 4 | 无页面被 `noindex` 误伤（除 privacy） | **已做** | 抽查 `/`、`/about/`、`/calculator/`、`/category/*/`、`/blog/*/` 均无 `robots` meta |
| 5 | `/privacy/` 正确 `noindex, nofollow` | **已做** | `curl -s https://landedmath.com/privacy/ \| grep -o '<meta name="robots"[^>]*>'` |
| 6 | `/contact/` 可索引但**不在** sitemap | **待核实**（决策不一致） | 该页无 `robots` meta（可索引），但 `astro.config.mjs` 的 `filter` 把它排除出 sitemap。**要么加 noindex，要么放回 sitemap**，不要停在中间态 |
| 7 | sitemap 只有一个、包含全部 22 篇文章 | **已做** | `curl -s https://landedmath.com/sitemap-0.xml \| grep -c "<loc>"` → 33 个 URL，其中 `/blog/` 22 个 |
| 8 | sitemap 用绝对 HTTPS URL、UTF-8 | **已做** | 见上，全部 `https://landedmath.com/...` |
| 9 | sitemap `lastmod` | **待做** | 实测 **33 个 URL 全部没有 `<lastmod>`**。官方："Google uses the `<lastmod>` value if it's **consistently and verifiably** accurate"。用 `revisions` 的最后一条日期（或 `updatedDate`）生成，**不要**用构建时间（会全部同一天，不可验证） |
| 10 | `http://` → `https://` 301 | **已做** | `curl -sI http://landedmath.com/` → `HTTP/1.1 301` / `Location: https://landedmath.com/` |
| 11 | `/path` → `/path/` 唯一化（308） | **已做** | `curl -sI https://landedmath.com/about` → `308` → `/about/` |
| 12 | **`www.landedmath.com` 未重定向** | **待做** | 实测 `https://www.landedmath.com/` 返回 **200**（无重定向）。好消息是它的 canonical 指向非 www（未产生 canonical 冲突），但官方把 redirects 列为**最强** canonical 信号："Pick one of those URLs as your canonical URL, and **use redirects** to send traffic from the other URLs to your preferred URL." 应在 Cloudflare 加 Bulk Redirect：`www.landedmath.com/*` → `https://landedmath.com/$1`（301） |
| 13 | **HSTS 未启用** | **待做** | `curl -sI https://landedmath.com/ \| grep -i strict-transport` → 无输出。官方在"确保 HTTPS 被选为 canonical"的三条做法里列了 "Implement HSTS"。`public/_headers` 里加 `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` |
| 14 | 每篇文章都有自引用绝对 canonical | **已做** | `curl -s <article> \| grep -o '<link rel="canonical"[^>]*>'` → 自引用、绝对、HTTPS、带尾斜杠 |
| 15 | 内链：每个重要页至少被一个其他页链接 | **已做** | 5 个 category 页在主导航；`/about/`、`/sources/`、`/privacy/`、`/contact/`、`/rss.xml` 在页脚；文章通过首页 + 相关阅读可达 |
| 16 | 链接全部是原生 `<a href>` | **已做** | Astro 默认输出原生锚点 |
| 17 | URL 无参数、无 fragment、全小写、连字符分离 | **已做** | 33 个 sitemap URL 全部符合 |
| 18 | Search Console 已验证 + 提交 sitemap | **需核实** | 无法从公开信息判断。登录 GSC 确认站点资源存在、`sitemap-index.xml` 已提交且状态 Success |
| 19 | **GSC「生成式 AI 功能」纳入设置已开启** | **需核实** | 官方新增硬性 gate："a site **must be included in Search generative AI features in Search Console** to be eligible for display in generative AI features"。在 GSC 里找到该设置并确认已开启 |

### 7.2 结构化数据

| # | 检查项 | 状态 | 验证方式 |
|---|---|---|---|
| 20 | 首页有 `WebSite` + `Organization` | **已做** | 实测首页 JSON-LD：`@type: WebSite`，`publisher` 嵌套 `Organization` |
| 21 | 文章有 `Article` JSON-LD | **已做** | 实测 `@type: "Article"`，含 `headline`、`description`、`datePublished`、`author`、`publisher`、`articleSection`、`keywords`、`mainEntityOfPage` |
| 22 | `Article` 的 `@type` 合法 | **已做** | 官方允许 `Article` / `NewsArticle` / `BlogPosting`，本站用 `Article` ✅ |
| 23 | **`Article.image` 缺失** | **待做** | 实测 22 篇文章的 JSON-LD **都没有 `image`**；本地 `heroImage` 使用数 **0/29**。官方 `image` 是 Recommended，并要求：(a) crawlable & indexable、(b) 代表内容、(c) 支持 Google Images 格式、(d) 建议多张高分辨率图（**≥50K 像素**），比例 **16x9 / 4x3 / 1x1**。**注意：`Article` 无 required 字段，所以这不是"错误"，而是失去机会** |
| 24 | **`author.url`（或 `sameAs`）缺失** | **待做** | 实测 `author` 只有 `name` + `jobTitle`。官方："we **strongly recommend** using the `type` and `url` (or `sameAs`) properties. Use valid URLs." 需有一个 `/about/` 内的作者锚点或独立作者页，然后指向它 |
| 25 | **`publisher` 的 `Organization` 缺 `url` / `logo`** | **待做** | 实测 `publisher` 只有 `{"@type":"Organization","name":"Landed Math"}`。建议补 `url` + `logo` |
| 26 | **首页 `Organization` 缺 `url` / `logo` / `sameAs`** | **待做** | 首页 `Organization` 只作为 `publisher` 嵌套存在，且只有 `name`。官方建议 `url` 或 `logo` 表示线上存在（"which logo you want to show, for example in Search results and knowledge panel"），并建议放在**首页**并加 `sameAs` |
| 27 | **全站无 `BreadcrumbList`** | **待做** | 实测首页只有 WebSite/Organization；文章只有 Article 系列；`/category/*/`、`/markets/`、`/sources/`、`/calculator/` **完全无结构化数据**。Breadcrumb 是唯一有**硬性 required** 的结构化数据（`BreadcrumbList.itemListElement`；`ListItem` 的 `item`/`name`/`position`，最后一项 `item` 可省），且要求 "at least two `ListItem`s"。建议：文章 `主页 > Category > 文章`，分类页 `主页 > Category` |
| 28 | 结构化数据与可见内容一致 | **已做** | 文章 `headline` == 页面 `<h1>`；`description` == 可见 standfirst + meta description ✅（这是 `sd-policies` 的硬性条款） |
| 29 | 未使用已废弃的 `SearchAction` / sitelinks search box | **已做**（正确的"没做"） | 官方 2024-11 已移除该功能。**保持现状，不要加** |
| 30 | 未使用 `Data-vocabulary.org` 标记 | **已做** | 全站用 JSON-LD |
| 31 | 用 Rich Results Test 验证线上文章 | **需核实** | 打开 https://search.google.com/test/rich-results 输入一篇线上的文章 URL，确认 `Article` 无 critical error、`Breadcrumb`（补完后）有效 |
| 32 | 文章结构化数据不含未来的 `datePublished` | **需核实** | 官方："**Don't specify future dates**, or the date of the action described on the page." 本站文章日期基于 2026 年、当前日期为 2026-10-07，抽样文章 `datePublished` 为 `2026-10-03`（过去）✅；但需批量确认没有 > 今天的日期 |

### 7.3 移动端、页面体验与性能

| # | 检查项 | 状态 | 验证方式 |
|---|---|---|---|
| 33 | 响应式（同一 URL 同一 HTML） | **已做** | Astro 静态输出 + `<meta name="viewport" content="width=device-width, initial-scale=1.0">` |
| 34 | 移动/桌面内容与结构化数据一致 | **已做** | 同一份 HTML，天然一致（满足 mobile-first indexing 要求） |
| 35 | 主内容未被"点击才加载"的懒加载挡住 | **已做** | 正文由服务端渲染进 HTML；导航折叠用 `aria-expanded` 但链接本身始终在 DOM 中 |
| 36 | **`max-image-preview:large` 未设置** | **待做** | 全站无此 meta（`src/` 内 grep 无匹配）。Google Discover 明确要求图片 "**Enabled by the `max-image-preview:large` setting**, or by using AMP"。这是一行改动、收益明确。在 `BaseLayout.astro` 加 `<meta name="robots" content="max-image-preview:large">`（注意与 `/privacy/` 的 `noindex` 分支合并，避免出现两个 robots meta） |
| 37 | **全站 0 张内容图片** | **待做** | 实测：`public/` 只有 `favicon.svg` + `og-default.png`；本地构建 HTML 中 `<img>` 标签数为 **0**；`heroImage` 使用 0/29。后果：(a) 无 `Article.image`、(b) 失去 Google Images 这个独立发现入口、(c) Discover 无缩略图。官方对文章图片的建议是 **≥50K 像素、16x9/4x3/1x1** |
| 38 | OG 默认图规格 | **待做**（部分符合） | 实测 `og-default.png` = **1200×630，756,000 像素**。满足 Discover 的"≥1200px 宽"和">300,000 像素"，但**不满足 16x9**（1200×630 ≈ 1.905:1；16:9 应为 1200×675）。且它是**通用站点图**，而 Discover 说 "**Avoid using generic images** (for example, your site logo)" |
| 39 | HTML 走 CDN 缓存 | **待做** | 实测响应头 `Cache-Control: public, max-age=0, must-revalidate` → 每次请求回源，直接影响 TTFB/LCP。对比：`/_astro/*` 已是 `public, max-age=31536000, immutable` ✅。**HTML 也应给一个短边缘缓存**（例如 `public, max-age=0, s-maxage=3600, must-revalidate`），并把 HTML 也纳入 Cloudflare 边缘缓存 |
| 40 | 字体加载策略（`font-display` / preload） | **需核实** | 需查 `src/styles/global.css` 的 `@font-face` 或系统字体栈。若用系统字体栈则无 CLS/LCP 影响 |
| 41 | 图片尺寸属性（防 CLS） | **已做**（但无图可测） | `ArticleLayout.astro` 的 hero `<img>` 已写死 `width="1200" height="750"`。当前 0 篇使用，所以实际上无从暴露问题 |
| 42 | 无第三方脚本拖慢 INP | **已做** | 无 GA4、无广告、无第三方分析；唯一可选脚本是 Cloudflare beacon（`defer`） |
| 43 | 实测 CWV 三项达标（p75，移动+桌面） | **需核实** | 本次 PSI API 返回 429，未能取得。自测：`curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Flandedmath.com%2F&strategy=mobile"`（建议加 `&key=<API_KEY>`）。或直接在 GSC → 「核心网页指标」报告看 p75 |
| 44 | Lighthouse 里 TBT 接近 0（INP 代理指标） | **需核实** | 因 Lighthouse 无法测 INP，官方指定 **TBT** 为实验室代理指标 |
| 45 | 无侵入式插页（interstitials） | **已做** | 无弹窗、无订阅遮挡层。`NewsletterForm` 在 `newsletterAction` 为空时渲染 mailto 链接而非弹窗 ✅ |

### 7.4 内容与 E-E-A-T

| # | 检查项 | 状态 | 验证方式 |
|---|---|---|---|
| 46 | 每篇有可见 byline | **已做** | 文章页 meta 行为 `Oct 3, 2026 · 12 min read · By V` |
| 47 | **日期未标注 "Published"/"Last updated"** | **待做** | 官方："**Label your dates appropriately with text like 'Publish' or 'Last updated'**"。当前 byline 直接以 `Oct 3, 2026` 开头，无标签。建议改为 `Published Oct 3, 2026` |
| 48 | **byline 未指向作者背景信息** | **待做** | 官方评估问题："Do bylines lead to further information about the author or authors involved, giving background about them and the areas they write about?"。`AUTHOR.name === "V"`，`src/pages/` 下**无作者页**。**不要伪造**（官方明文禁止 AI 头像/假名/假资历）；正确做法是让 byline 锚到 `/about/#who`，把 `/about/` 里已存在的真实背景（Amazon FBA / TikTok Shop / Temu，消费电子与家居）作为落点 |
| 49 | 每篇有 "How this was made" | **已做** | `ArticleLayout.astro` 内置 `<section class="disclosure">`，标题为 "How this was made"，并链到 `/about/`。**强度超过 Google 的 "consider" 建议**（为满足 EU AI Act 第 50 条） |
| 50 | About 页说明站点目的与受众 | **已做** | `/about/` 有 "What this site does" / "Who this is for" / "Who is behind this" / "How the analysis is produced" / "What this site is not" |
| 51 | 具名一手来源 + 检索日期 | **已做** | `/sources/` 记录 **195 个数字、119 个具名来源**，五要素（value/unit/period/source/retrieved）写入 content schema；`/sources/` 另设"我们读不到的东西"专节（透明度加分项） |
| 52 | 更正月志机制 | **已做（覆盖率低）** | 机制存在（`revisions` 字段 → "Corrections and updates" 段落 → `dateModified`），但 **只有 2/29 篇有 `revisions`**。机制正确，覆盖不足 |
| 53 | 每篇正文含 ≥5 个带来源的精确数字 | **需核实** | 需逐篇跑本地 QA gate（仓库里有 `qa-check`） |
| 54 | 未按"政策 × 品类 × 国家"批量铺页 | **已做（当前）** | 22 篇已发布 + 7 篇草稿，节奏克制。⚠️ **这是最需要长期守住的纪律**——官方 scaled content abuse 与 doorway abuse 条款正是针对这种膨胀 |
| 55 | `information_gain` 前置门槛未被绕过 | **需核实** | 字段存在于 `content.config.ts`（`custom-calculation` / `cross-source` / `own-data` / `primary-source`），但需确认 gate 真的强制要求它 |
| 56 | 没有为"显得新鲜"而改日期 | **已做** | `content.config.ts` 注释与 `[slug].astro` 逻辑明确：`dateModified` 只取 `revisions` 最后一条，**不取 `reviewBy`**。这与官方 "Are you changing the date of pages to make them seem fresh when the content has not substantially changed?" 完全对齐 ✅ |
| 57 | 没有为字数而写 | **已做** | content schema 无 word-count 字段；官方明确 "we don't [have a preferred word count]" |
| 58 | 正文未堆砌国家/港口/数字列表 | **需核实** | 需人工通读抽查。官方 keyword stuffing 例子直接点名 "lists of phone numbers without substantial added value" 与 "blocks of text that list cities and regions" |
| 59 | 正文来源是否用外链 | **待核实（取舍）** | 项目规范要求正文不放 URL、只用机构名。官方："using external links can help establish trustworthiness (for example, **citing your sources**)"。这是**有代价的取舍**，需项目自己决定是否在 Sources 段给出可点击的一手链接 |

### 7.5 一键体检脚本

```powershell
# 基础可抓取性 / 索引性体检
$base = 'https://landedmath.com'
"robots.txt        : " + (curl.exe -s "$base/robots.txt" | Out-String).Trim()
"sitemap URL 数    : " + ([regex]::Matches((curl.exe -s "$base/sitemap-0.xml" | Out-String),'<loc>')).Count
"lastmod 数        : " + ([regex]::Matches((curl.exe -s "$base/sitemap-0.xml" | Out-String),'<lastmod>')).Count
"首页状态          : " + (curl.exe -s -o NUL -w "%{http_code}" "$base/")
"404 状态          : " + (curl.exe -s -o NUL -w "%{http_code}" "$base/no-such-page-xyz/")
"http->https 状态  : " + (curl.exe -s -o NUL -w "%{http_code}" "http://landedmath.com/")
"www 状态(期望301) : " + (curl.exe -s -o NUL -w "%{http_code}" "https://www.landedmath.com/")
"HSTS 头           : " + ((curl.exe -sI "$base/" | Select-String -Pattern 'strict-transport' | Out-String).Trim() -replace '^$','<缺失>')
"max-image-preview : " + ((curl.exe -s "$base/" | Select-String -Pattern 'max-image-preview' | Out-String).Trim() -replace '^$','<缺失>')
"HTML 缓存头       : " + ((curl.exe -sI "$base/" | Select-String -Pattern 'cache-control' | Out-String).Trim())
"卡片结构化数据    : " + ((([regex]::Matches((curl.exe -s "$base/blog/eu-cbam-cost-per-tonne-chinese-steel-aluminium-2026/" | Out-String),'"@type"\s*:\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object -Unique) -join ', ')
```

---

## 8. 常见误区（Google 官方文档明确否定的说法）

| 误区 | Google 的原话 | 出处 |
|---|---|---|
| "用 robots.txt 就能不让页面被收录" | "it is **not** a mechanism for keeping a web page out of Google" / "a page's URL might still appear in search results" | [robots/intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro) |
| "提交 sitemap 就能保证收录" | "it **doesn't guarantee** that all the items in your sitemap will be crawled and indexed" | [sitemaps/overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) |
| "sitemap 里 priority / changefreq 有用" | "**Google ignores `<priority>` and `<changefreq>` values**" | [build-sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| "canonical 是命令，写了就一定生效" | "indicating a canonical preference is **a hint, not a rule**" / "Google may choose a different page as canonical than you do" | [canonicalization](https://developers.google.com/search/docs/crawling-indexing/canonicalization) |
| "对 canonical 页自己也要写 canonical 是多余" | "**Do** include a `rel="canonical"` link on the canonical page itself (**self-referential canonical**)" | [consolidate-duplicate-urls](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| "用 robots.txt 来收敛重复内容" | "**Don't** use the robots.txt file for canonicalization purposes" | 同上 |
| "E-E-A-T 是一个可以直接优化的排名因素" | "**While E-E-A-T itself isn't a specific ranking factor**" | [creating-helpful-content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| "页面体验是一个统一的排名信号" | "**There is no single signal.**" | [page-experience](https://developers.google.com/search/docs/appearance/page-experience) |
| "除了 CWV，SSL/移动端友好也直接提排名" | "Beyond Core Web Vitals, other page experience aspects **don't directly help your website rank higher**" | 同上 |
| "把 CWV 刷到满分就能排第一" | "getting good results … **doesn't guarantee** that your pages will rank at the top" / "trying to get a perfect score just for SEO reasons **may not be the best use of your time**" | 同上 |
| "内容越好排名越高，页面体验差也无所谓" | "Google Search always seeks to show the most relevant content, **even if the page experience is sub-par**"（反过来也成立：CWV 只在内容都好的查询里起作用） | 同上 |
| "结构化数据能保证出现富媒体结果" | "**Google does not guarantee** that your structured data will show up in search results, even if your page is marked up correctly according to the Rich Results Test" | [sd-policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) |
| "结构化数据出错会拉低网页排名" | "A structured data manual action means that a page **loses eligibility for appearance as a rich result; it doesn't affect how the page ranks in Google web search**" | 同上 |
| "做 sitelinks search box 能提升站点搜索框展示" | "The **sitelinks search box feature is no longer available** in Google Search results"（2024-11-29 移除文档并归档 `nositelinkssearchbox`） | [Search Central changelog](https://developers.google.com/search/blog)（原 sitelinks-searchbox URL 已重定向） |
| "AI 生成内容会被 Google 惩罚" | "**Appropriate use of AI or automation is not against our guidelines.**" / "**not all use of automation, including AI generation, is spam**" | [2023 blog](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content) |
| "用 AI 有排名加成" | "**Using AI doesn't give content any special gains. It's just content.**" | 同上 |
| "可以说内容是 AI 写的，并署 AI 的名" | "**Giving AI an author byline is probably not the best way**" | 同上 |
| "标注了来源就等于有原创价值" | "**Attribution or giving credit to other sources doesn't replace the need for original effort.**" | [creating-helpful-content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| "需要做 llms.txt 才能进 AI 搜索" | "**Google Search itself doesn't use them**" / "as **Google Search ignores them**" | [ai-optimization-guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) |
| "要把内容切成小块（chunking）方便 AI 理解" | "**There's no requirement** to break your content into tiny pieces for AI to better understand it" | 同上 |
| "要专门为 AI 重写内容 / 覆盖所有长尾变体" | "You **don't need** to write in a specific way just for generative AI search" | 同上 |
| "AI 搜索需要额外的结构化数据" | "**Structured data isn't required for generative AI search**, and there's no special schema.org markup you need to add" | 同上 |
| "AEO / GEO 是一门新学科" | "**optimizing for generative AI search is optimizing for the search experience, and thus still SEO**" | 同上 |
| "第三方工具能拿到 Google 内部排名数据" | "**No third-party tool has access to our internal ranking or AI systems.**" | [third-party-seo](https://developers.google.com/search/docs/fundamentals/third-party-seo) |
| "存在 Google 偏好的字数" | "Are you writing to a particular word count because you've heard or read that Google has a preferred word count? (**No, we don't.**)" | [creating-helpful-content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| "持续大量加新内容能让站点显得新鲜从而提排名" | "Are you adding a lot of new content or removing a lot of older content primarily because you believe it will help your search rankings …? (**No, it won't**)" | 同上 |
| "改一下发布日期就能显得新鲜" | 列为需要重新评估内容生产方式的**警告信号** | 同上 |
| "给搜索引擎和用户看不同内容没关系" | Cloaking，违反 spam policies | [spam-policies](https://developers.google.com/search/docs/essentials/spam-policies) |
| "交换友情链接、买链接是常规操作" | Link spam："Excessive link exchanges ('Link to me and I'll link to you')" / "Buying or selling links for ranking purposes" | 同上 |
| "折叠起来的内容算作弊" | "Accordion or tabbed content that toggle between hiding and showing additional content" **不违反**政策 | 同上 |
| "交钱能让 Google 爬得更勤 / 排得更高" | "Google doesn't accept payment to crawl a site more frequently, or rank it higher. **If anyone tells you otherwise, they're wrong.**" | [how-search-works](https://developers.google.com/search/docs/fundamentals/how-search-works) |
| "新站必须做 hreflang" | 前提是"If your site **contains content in different languages**"；纯英文单语站不需要 | [international](https://developers.google.com/search/docs/specialty/international) |
| "URL 里用下划线还是连字符无所谓" | "we recommend using **hyphens (`-`) instead of underscores (`_`)**" | [url-structure](https://developers.google.com/search/docs/crawling-indexing/url-structure) |
| "锚文本多塞关键词有帮助" | "resist the urge to cram every keyword … remember, **keyword stuffing is a violation of our spam policies**" | [links-crawlable](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) |
| "每个外链都该加 nofollow" | "Use `nofollow` **only when you don't trust the source**, and not for every external link on your site" | 同上 |
| "页面上的链接越少越好（或越多越好）" | "**There's no magical ideal number of links** a given page should contain" | 同上 |
| "搜索质量评估员的评分会直接决定我的排名" | "**Rater data is not used directly in our ranking algorithms**" / "their ratings don't directly influence ranking" | [creating-helpful-content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| "首页必须放 Organization 才能有知识面板" | Organization 无 required 字段；且 "**Google does not guarantee** that features that consume structured data will show up" | [organization](https://developers.google.com/search/docs/appearance/structured-data/organization) |

---

## 附录 A：本次实际抓取的官方页面清单

全部已下载全文到 `_research/gdocs/`（43 个文件），便于复核原文。

**Search Essentials / 政策类**
- https://developers.google.com/search/docs/essentials
- https://developers.google.com/search/docs/essentials/technical
- https://developers.google.com/search/docs/essentials/spam-policies

**内容质量 / E-E-A-T / AI**
- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/fundamentals/how-search-works
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/fundamentals/third-party-seo
- https://developers.google.com/search/docs/fundamentals/do-i-need-seo
- https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
- https://developers.google.com/search/docs/appearance/ai-features

**抓取与索引**
- https://developers.google.com/search/docs/crawling-indexing
- https://developers.google.com/search/docs/crawling-indexing/url-structure
- https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/robots/intro
- https://developers.google.com/search/docs/crawling-indexing/canonicalization
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata
- https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag

**搜索外观 / 结构化数据**
- https://developers.google.com/search/docs/appearance/page-experience
- https://developers.google.com/search/docs/appearance/core-web-vitals
- https://developers.google.com/search/docs/appearance/ranking-systems-guide
- https://developers.google.com/search/docs/appearance/publication-dates
- https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
- https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- https://developers.google.com/search/docs/appearance/structured-data/article
- https://developers.google.com/search/docs/appearance/structured-data/organization
- https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/google-discover
- https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials
- https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox → **已移除，现重定向至 Search Central 更新日志**

**国际化**
- https://developers.google.com/search/docs/specialty/international
- https://developers.google.com/search/docs/specialty/international/localized-versions

**Core Web Vitals（web.dev）**
- https://web.dev/articles/vitals
- https://web.dev/articles/lcp
- https://web.dev/articles/inp
- https://web.dev/articles/cls

## 附录 B：本次未能核实的事项（诚实声明）

1. **未取得实测 Core Web Vitals 字段数据。** PageSpeed Insights API 两次返回 HTTP 429（未使用 API key，共享出口 IP 限流）。因此第 6/7 节中所有 CWV 实测结论均标记为"需核实"，并给出了自测命令。**我没有用第三方数据填补这个空白。**
2. **未查阅 Search Quality Rater Guidelines PDF 正文。** 本次只读了 Google 在 `creating-helpful-content` 和 `using-gen-ai-content` 中**转述**的 QRG 内容（主内容四属性、4.6.5、4.6.6）。若需要 QRG 原文（例如 YMYL 的完整定义、Lowest Quality 的判定细则），需另行下载 PDF。
3. **未核实 Search Console 内部状态。** 站点验证状态、sitemap 提交状态、「核心网页指标」报告、「生成式 AI 功能」纳入设置，均无法从公开 URL 判断。
4. **未核实字体加载策略**（`src/styles/global.css` 的 `@font-face`）。
5. **未逐篇通读 22 篇文章正文**，因此"是否堆砌数字/国家列表"（第 58 项）标记为需核实。
6. **Discover 专门条款**（图片规格、`max-image-preview:large`）来自我额外抓取的官方页面 https://developers.google.com/search/docs/appearance/google-discover —— 该页**不在**本次任务的指定清单内，但属于 Google 官方文档，故一并引用并在此说明来源。
7. **关于"贸易政策/到岸成本属于 YMYL"** 是依据 Google 对 YMYL 的定义（"financial stability"）做出的**推断**，不是 Google 的声明，第 2.1 节已标注。

---

*本总结的所有结论均来自 Google 官方文档原文，每个实质性论断后都附了官方 URL。凡是我无法在官方文档中找到依据的内容，均已在附录 B 或正文中明确说明，未用第三方 SEO 观点填补。*
