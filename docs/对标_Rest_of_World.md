# 对标记录：Rest of World（融资新闻站）

> 对标对象：Rest of World（https://restofworld.org）
> 对标日期：2026-10-08（浏览器实测导航/链接结构）
> 融资背景：非营利新闻机构，获基金会资助（Luminate、Ford Foundation、Henry Luce Foundation 等），专注非洲/拉美/亚洲新兴市场的科技与商业深度报道。与「深耕东南亚/拉美蓝海」定位高度吻合。

## 一、实测信息架构（浏览器抓取）

### 1.1 文章 URL 模式
```
/2026/{slug}/        # 年份打头，语义化（如 /2026/google-meta-red-sea-subsea-cables-houthi-yemen/）
```
- 结论：避免 /articles/ 扁平堆积，按年份分区利于 E-E-A-T 与长尾。

### 1.2 主题系列 Series
```
/series/{slug}/      # tech-giants / innovation / ev-revolution / q-and-a / ideas / features / labor / global-dispatch-newsletter
```
- 栏目按「主题议题」组织，非传统频道。

### 1.3 专题合集 Collection
```
/collection/{slug}/  # the-ai-race / the-india-story / the-global-push-to-rein-in-big-tech / features
```
- 跨系列打包的专题，用于热点战役（如大选、预算季）。

### 1.4 地区层 Region（长尾 SEO 引擎）
```
/region/{slug}/      # south-asia / china / africa / latin-america / asia / eastern-europe / middle-east-north-africa
```
- **这是全站最值得借鉴的一层**：地区聚合页抓取海量长尾关键词，天然适配「国别独立站」。

### 1.5 作者 Author
```
/author/{slug}/      # 按作者聚合
```
### 1.6 数据图表 Charts
```
/charts/{year}/{slug}/   # 数据可视化页（差异化、可链接资产）
```
### 1.7 信任/商业页
```
/about/  /about/privacy-policy/  /about/contact-us/
/platforms/  /newsletters/global/  /donate/
```
### 1.8 其他
```
/feed/series/{slug}    # 系列级 RSS
/latest/               # 最新列表
```
导航结构：Home / About / Latest / Newsletter / Series / Collections（扁平主导航）。

## 二、借鉴结论（已并入 PROJECT_SPEC 第四章）

1. **用「主题系列 + 地区层」双轴组织内容**，替代单一 /articles/ 堆积。
   - 保留项目文档固定目录（/articles/ /topics/ /countries/ /brief/ /podcast/）。
   - **新增 /series/ 与 /region/ 两层**做 SEO 长尾（对标 /series/ + /region/）。
2. **文章 URL 按年份打头**（`/2026/{slug}/`），避免扁平化 E-E-A-T 稀释。
3. **数据可视化资产**（对标 /charts/）作为差异化与可链接来源。
4. **信任页齐全**：methodology / sources / privacy / refund（对标 about / privacy / contact）。
5. **作者页**：用机构署名（如 "Landed Math Desk"）规避 AI 欺骗风险（依据谷歌 SEO：禁止伪造个人作者）。

## 三、差异点（我方相对 RoW 的定位差异）
- RoW 是非营利 + 基金会赞助 + 免费阅读；我方是**付费会员订阅（月/年/终身）+ 零广告**。
- RoW 靠广告/赞助覆盖成本；我方靠 Stripe/PayPal 会员收入。
- 故我方必须补：/subscribe/ 会员购买、/account/ 会员中心、/brief/ 付费简报、robots 禁抓付费页。
