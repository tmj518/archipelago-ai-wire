# 两条线：A线与 B线

Written down so the question "which line does what, and when" has one answer.

## 定时

| 线 | cron (UTC) | 马来西亚时间 | 次数/天 |
|---|---|---|---|
| **A线** | `0 18 * * *` | 02:00 | 1（主） |
| **A线** | `0 */3 * * *` | 08:00 / 11:00 / 14:00 / 17:00 / 20:00 / 23:00 | 8（临时，2026-11-02 为验证无人值守加的） |
| **B线** | `0 3 * * *` | 11:00 | 1（主） |
| **B线** | `*/20 * * * *` | 每 20 分钟 | 72（临时，为了今天之内看到一次真实触发） |

两条线的"主"cron 各一次：A线 02:00，B线 11:00。其余都是为验证加的兜底，验证完应删。

## 两个理论

**A线 — 管道（pipeline）**

一个有日期的世界事件，追溯它到马来西亚的传导路径：贸易、价格、就业、资本。每一步可检查：
每个数字要有原文出处，事实/推断/未知分开，11 道闸门过后才发布。**慢，但可审计。**

**B线 — 单步（one shot）**

一个人、一个产品、一份可查的收入记录。抓素材 → 一次模型调用 → 写 → 发。**没有闸门，没有
reviewer，没有 claim。** 快，但不审计——这是刻意的，因为它的目的是每天有一篇，而 A线的标准
用在它身上会让它一篇都发不出来。

## 完全独立的部分

| 项 | A线 | B线 |
|---|---|---|
| workflow | `content-daily.yml` | `b-line.yml` |
| cron | 18:00 UTC 主 | 03:00 UTC 主 |
| 选题 | 19 个新闻源 + research.mjs | 案例池 `data/b-line/cases.json` + HN/Lobsters |
| 写作 | `cloud-executor.mjs`，六段结构 | `b-line/generate.mjs`，一次调用 |
| 审核 | reviewer + 11 道闸门 | 无 |
| 配额 | `MAX_ARTICLES_PER_DAY`（2/天） | 每天 1 篇（自检 publishDate） |
| 产出栏目 | world / malaysia-impact / economy / tech-ai / work-education-family / business | **success-cases** |
| 记录 | 飞书四张表 | 仓库内 cases.json + 文章 |

## 不独立的地方（必须说清楚）

1. **同一个仓库、同一个站点、同一次部署。** 一次 `git push` 同时影响两边的页面。
2. **构建是全站的。** B线 一篇文章的 frontmatter 坏了，A线 的页面也会部署失败——
   2026-11-07 和 11-08 各发生过一次（描述字段里的 `$`，缺 `information_gain`）。
3. **闸门曾经检查所有文章。** B线 的文章没有 figures、没有内链、没有 reviewer 报告，
   于是每发一篇，A线 的 CI 就红一次。已改为跳过 `category: success-cases` 的文章。

## 一句话

**内容与选题完全独立，发布管道共用。** 一个仓库一个站点，这是架构，不是疏忽；能分开的是
"谁来判断"和"什么时候发"，不能分开的是"构建成不成功"。
