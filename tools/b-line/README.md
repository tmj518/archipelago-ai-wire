# B线

B线为 Astro/Cloudflare Pages 网站生成英文一人公司案例。它的模型 Reviewer 是自动化筛查，不是人工 3R 签核，也不能仅凭自我声明证明事实为真。

## 流程

1. 从配置的 Hacker News / Lobsters feed 获取当天素材；若选用案例池条目，还会抓取该条目的来源页面。
2. Writer 只依据抓取到的材料生成文章。缺少最低结构要求时拒绝，不以警告方式放行。
3. Reviewer 至少使用不同 provider 或同 provider 的不同 model；同 provider/model 即使 credential 不同也不算独立。身份缺失/unknown、调用失败、JSON 无效或拒绝时不写文章。
4. 商业关键数字（营收、用户、价格、利润、日期等）必须有 `cases.json` 条目里显式登记的 `primarySources`，该来源需实际抓取，Reviewer 返回的精确 quote 还必须匹配归档原文。HN/Lobsters feed 只作发现来源，不支持这些关键数字。当前案例池没有经过本轮逐项标注验证的 `primarySources`；涉及关键数字的稿件因此会 fail closed，需人工维护来源注册后才可能通过。
5. Reviewer 不判定 3R 安全。共用的 `THREE_R` 规则命中后，B 线以 `REVIEW_HUMAN_REQUIRED` 失败并隔离，不进入 Publish。现有 `qa-check` 仍要求有完整 reviewer/date 的人工签核块；A 自动 Writer 被禁止自写 `human_review` 字段。
6. 发布前执行 `tools/validate-article.mjs --changed`、`tools/qa-check.mjs <article>`、Astro 构建和 `tools/gate.mjs --fresh`。推送后工作流草稿调用本地校验脚本检查准确 canonical article、Sitemap index/child、RSS 条目；该网络步骤尚未在 Actions 验证，也不核验 Cloudflare deployment SHA。

## 运行结果定义

- `QUIET`：当日已有文章，或生成器有证据表明当前没有足够素材。不会创建发布提交。
- `PUBLISHED`：仅在必要审核与质量闸门通过、文章提交推送成功、线上 URL 返回 HTTP 200 后成立。
- `FAILED_*`：研究、Reviewer、格式、质量闸门、构建、提交或上线验证环节失败；工作流应失败并由告警流程监听。

审核通过只表示当前规则与所给摘录通过，不证明摘录上下文无误、来源具有权威性或全部文章事实已核实。需要人工复核或缺少归档证据时，B 线不自动发布。`PUBLISHED`、真实 Actions、线上 Site/Sitemap/RSS 与 Cloudflare SHA 的闭环仍需独立云端验收。
