# Landed Math — 终极复盘与马来西亚迁移指南

> 归档日期：2026-10-20
> 代码基线：`3a48a0a`
> 站点：landedmath.com（191 页构建 · qa 22 条规则全清 · 首页 200）
> 用途：马来西亚新项目「群岛智讯」的架构模板

---

## 一、双引擎的理论与数据驱动现状

### 1.1 A 线（确定性保底）

**定位：** 从 directive 出发，经写作 → 质检 → 修订 → 发布，每一步都是独立进程 + 类型化 JSON 契约。

**最终配置：**

| 角色 | 模型 | 端点 |
|---|---|---|
| 写作者 | 豆包 **Doubao-Seed-2.1-pro** | `ep-20261019161601-9k6dn` |
| 审核者 | **DeepSeek-V4-Flash** | `ep-20251220173606-gzxdg` |

**★ 两个不同模型，同一份 Ark 凭据 —— 模型级独立，凭据共享。**

**跑通后的真实数据（2026-10-20）：**

```
verdict : PUBLISHED
耗时    : 592 秒
调用    : 2 次（1 研究 + 1 写作）
失败    : 0
花费    : $0.008
stream  : the endpoint answered as SSE, 1347 delta(s) joined
```

**★ 592 秒是 Pro 模型的正常代价 —— 它写一篇 1500 词的结构化长文需要 5–10 分钟。这不是故障，是特性。**

#### 物理清洗器：怎么解决"模型瞎编枚举值"

**问题：** 写作者把 `information_gain` 写成自由文本：

```
information_gain: "aggregate-to-transaction timing arithmetic"
information_gain: "process-timing arithmetic"
information_gain: "timing-risk arithmetic"
```

**★ 三次不同的自由文本，三次让整站构建失败（`InvalidContentEntryDataError`）—— 因为 Astro 的 schema 只认四个值。**

**解决：三道防线，缺一不可。**

```
① 草稿阶段（cloud-orchestrator，严格检查之前）
   把 information_gain / category / audience / priority 四个枚举字段
   若非合法值，直接覆盖为最近的合法值，并打印：
   enum repair : information_gain='process-timing arithmetic' -> 'custom-calculation'
   ★ 记录而不是静默掩盖，这样写作者的习惯仍然可见

② 闸门阶段（qa-check，2026-10-19 起生效）
   information_gain legal
   category legal
   ★ 带日期豁免：老文章按发布日放行，不误伤 38 篇存量

③ 强发阶段（agent-run 的 sanitizeFrontmatter）
   同四个字段 + publishDate + stakes + draft
   ★ 覆盖所有绕过闸门的路径
```

**★ 为什么必须是三道：**

```
① 让正常流程不浪费一次修订（691 秒 → 592 秒）
② 让异常在发布前被拦住（而不是构建时才发现）
③ 让"强制发布"这条逃生通道也不会把站点搞挂
```

**★ 核心教训：`qa-check` 只查"字段有没有声明"，不查"值合不合法"；只有 Astro 查值，而 Astro 在构建阶段 —— 太晚了。**

---

### 1.2 B 线（探索性上限）

**定位：** 一个模型 + 十个工具 + 一个循环，自己决定先做什么。

**最终配置：**

| 角色 | 模型 | 说明 |
|---|---|---|
| 写作者 | 豆包 **lite** | 便宜 11 倍（$0.0007 vs $0.008） |
| 审核者 | 无外部审核 | 靠 `check_draft` 自查 + 代码强制拦截 |

**★ 双引擎拆分：A 线用 Pro（一次写好），B 线用 lite（多次短调用）。**

```js
// agent-run.mjs 顶部，在任何调用之前
process.env.ARK_MODEL_WRITER = process.env.AGENT_WRITER_ENDPOINT
  ?? "ep-20251220175517-rjpsc";   // lite
```

**★ 理由：A 线的工作是"写出一篇成品"，B 线的工作是"探三个数据源 + 判断今天有没有题"。后者是很多次短调用 —— 一次实测 70 次 —— 用 Pro 的延迟去跑 70 次短调用是双倍的错。**

#### lite 模型为什么不交卷

**实测轨迹（2026-10-20）：**

```
turn 2 · get_gsc_blue_ocean
turn 2 · get_ga4_trending
turn 2 · get_latest_official_docs
turn 3 · read_file  data/directive.json
turn 4 · write_file  data/drafts/xxx.md
turn 5 · no tool call, asked to act
turn 6 · no tool call, asked to act
...
turn 10 · no tool call, asked to act
verdict : TURN-LIMIT  (10 calls, $0)
```

**★ 从第 5 轮起，它连续 7 轮不调用任何工具 —— 只是在"说话"。**

**★ 根因：lite 模型在长上下文里丧失工具调用能力。它前 4 轮把活干完了，但不知道"该交卷了"，也不会自发再调 `publish_draft`。**

#### 强发兜底是怎么工作的

**★ 关键设计：兜底在**循环外**，只问一个问题。**

```js
}  // ← 循环结束

if (published.size === 0) {
  const newest = newestDraft("data/drafts");
  let target = `src/content/blog/${newest}`;

  // 若目标已存在 → 加北京时间日期后缀，换一个未被占用的 URL
  if (existsSync(target)) {
    const stamp = beijingToday();
    target = `src/content/blog/${slug}-${stamp}.md`;
  }

  writeFileSync(target, sanitizeFrontmatter(body));
  published.add(slug);
  finished = { verdict: "PUBLISHED-WITHOUT-FINISH", ... };
}
```

**★ 为什么必须写在循环外：**

```
同样的逻辑曾经写在循环内、用 turn >= MAX_TURNS - 2 判断
★ 三次运行，日志里零痕迹，一次都没执行
★ 移到循环外，第一次就成了
★ 教训：兜底不要依赖状态判断，只依赖结果（发文了吗）
```

**★ 判决口径：**

| 判决 | 含义 | 卡片颜色 |
|---|---|---|
| `PUBLISHED` | 模型自己完成并交卷 | 绿 |
| `PUBLISHED-WITHOUT-FINISH` | 代码接管强发 | 绿 |
| `DUPLICATE-SUBJECT` | 主题已写过，按规矩不发 | 黄 |
| `NO-SUBJECT` | 今天没有合格主题 | 黄 |
| `TURN-LIMIT` / `WRITE-FAILED` / `REJECTED` | 真的失败 | 红 |

**★ 分开 `PUBLISHED` 与 `PUBLISHED-WITHOUT-FINISH` 是本项目最诚实的决定：前者说明模型行为对了，后者说明外壳对了但模型还没收敛。**

---

### 1.3 数据驱动闭环：哪里通了，哪里还在靠兜底

**三级漏斗：**

```
第一级  GSC 蓝海词      真实搜索需求
   ↓ 无数据
第二级  GA4 读者行为    有阅读量的栏目
   ↓ 无数据
第三级  官方文件兜底    部委今天发了什么
```

**诚实的现状：**

| 环节 | 状态 | 证据 |
|---|---|---|
| GSC 鉴权 | ✅ **通了** | `token: ok` / `query: ok - 5 query row(s)` |
| GSC 蓝海词输出 | ⚠️ **0 条** | 新站曝光不足，严格档要 1000 曝光 |
| GSC 驱动选题 | ❌ **未发生** | agent 每轮都落到第三级 |
| GA4 标签 | ✅ **通了** | `_ga` cookie 存在 + `collect` 请求发出 + 实时 1 用户 |
| GA4 驱动选题 | ❌ **未接线** | `get_ga4_trending` 读的是 Cloudflare 阅读数据，不是 GA4 API |
| 官方文件 | ✅ **每天有货** | 8 篇正文归档 |

**★ 一句话：管道全通了，但里面还没有足够的数据流。**

**★ 而 B 线今天的真实决策路径是：**

```
turn 2  get_gsc_blue_ocean      → 0 条（新站）
turn 2  get_ga4_trending        → 无数据（阅读量近 0）
turn 2  get_latest_official_docs → 命中
★ 三级降级按设计工作 —— 只是永远停在第三级
```

**★ 这不是失败，是新站的必经阶段。GSC 需要 1–3 个月积累曝光，蓝海词才会出现。**

---

## 二、换模型引发的 8 大"隐式假设"危机

**★ 背景：2026-10-19 之前，系统在 lite 模型下稳定运行 29 天、48 篇文章。10-19 换用 Doubao-Seed-2.1-pro 后，一天内暴露 8 个坑。**

**★ 其中 6 个坑在 lite 时代一直存在，只是被"平庸"绕开了。**

| # | 坑 | 表现 | 怎么填平的 |
|---|---|---|---|
| 1 | **超时无响应** | `ETIMEDOUT: fetch failed` —— 638 字符提示词 180 秒不回 | 超时 300s → 600s；确认是模型慢，不是端点坏 |
| 2 | **SSE 流式解析缺失** | `JSON.parse` 全崩，回复读成空 | 检测 `data:` 前缀 → 逐行解析 → 拼接 delta |
| 3 | **内心戏污染正文** | 2434 delta 里大部分是 `reasoning_content` | **只拼 `delta.content`**，reasoning 只计数（2434 → 1347） |
| 4 | **降级链假成功** | 一堆思考过程也算"非空" → 永不降级 | 判定改为"含 `---` 或 `# `"，即"看起来像文档" |
| 5 | **枚举值构建崩溃** | 自由文本 → Astro schema 失败 → **整站 404** | 三道防线（草稿 / 闸门 / 强发） |
| 6 | **抓取枯竭** | `articles: 6 followed` → 3 天发 5 篇后无题可写 | 每源 2→4 篇，信源 4→6（8 篇）；**提案前剔除仍未做** |
| 7 | **定时跳票** | 07:20 连续两天**完全没触发**，无痕迹 | 双 cron（07:20/09:20 + 20:20/21:20）+ 路线级幂等 |
| 8 | **强发误杀** | 强发覆盖昨天已发布文件 → 记成"今天已发" → agent 被护栏挡住一整天 | 强发不再覆盖；护栏加 `noNewPage` 跳过 |

**★ 最深的一条教训（#4）：**

```
"非空"不是"可用"。
一个先思考再回答的模型，返回的是一堵非空且无用的推理墙，
而降级链曾把它当成成功 —— 于是三次调用花在一个已经说了"我答不了"的端点上。
```

**★ 而最高工程哲学在 #5 与 #8 的交汇处：**

> **新模型不会适配你的隐含假设，它只会把它们全部点亮。**

---

## 三、自动化运维的护城河

### 3.1 降级链与健康记忆

```js
modelChain(role)   // 端点列表而不是单个值
  → ARK_MODEL_WRITER → DUBAO201628_ENDPOINT → dubaotuili12345 → ARK_MODEL

askChain(opts)     // 逐个试，"看起来像文档"才采用
  → 空回复记一笔
  → 连续空 2 次 → 下次直接跳过（熔断）
  → 恢复应答 → 自动解除熔断
```

**★ 意义：模型下架/换新变成"改一个 secret"，而不是"一次事故"。**

### 3.2 物理清洗器（三道）

见 §1.1。**核心：把"格式化事实"从模型手里拿回来，但记录下来，不静默掩盖。**

### 3.3 双 Cron 防跳票 + 路线级幂等

```yaml
- cron: '20 23 * * *'   # 07:20 北京  script
- cron: '20 1 * * *'    # 09:20 北京  script 备用
- cron: '20 12 * * *'   # 20:20 北京  agent
- cron: '20 13 * * *'   # 21:20 北京  agent 备用
```

```js
alreadyPublishedToday(route)
  ★ 按 route 隔离：脚本发过不代表 agent 发过
  ★ 尊重 noNewPage：强发不产生新页面，不算"已发"
  ★ 北京时间计算，不是切 ISO 字符串
```

### 3.4 每日幂等拦截

**★ 为什么必须按路线区分：**

```
不分路线 → 脚本一发，agent 永远跳过
        → 系统正常工作的每一天，B 线都被自己的护栏杀掉
```

### 3.5 重试循环与预算

| 护栏 | 值 | 作用 |
|---|---|---|
| 写作者重试 | 3 次（带 Fix 指令） | 给模型"错题本" |
| agent 轮数 | 10 | lite 从第 5 轮起失效，多余轮次纯浪费 |
| agent 美元上限 | $0.06 | 轮数看不见重试，美元看得见 |
| 单命令超时 | 120 秒 | 仓库工具都是秒级 |
| job 上限 | 20 分钟 | 一个卡住的运行应该便宜地死 |

### 3.6 后置闸门

```js
// 落盘后，用【已发布标准】再查一次（草稿豁免在真实路径上不生效）
if (qaCheck(target).failed) { rmSync(target); published = false; }
```

**★ 这一道是"站点被搞挂三次"之后的产物。原则：绕过闸门不等于绕过 schema。**

---

## 四、马来西亚新项目「群岛智讯」的迁移清单

### 4.1 直接复制（一行不改）

| 类别 | 文件 | 说明 |
|---|---|---|
| 模型层 | `lib-llm.mjs` **全文** | SSE 解析 + 只取 content + 降级链 + 健康记忆 + 超时 |
| 护栏 | `alreadyPublishedToday()` / 双 cron 模式 | 逻辑与市场无关 |
| 查重 | `duplicateScore()` + slug 存在判定 | 只需换台账 |
| 编排骨架 | `cloud-orchestrator.mjs` 主流程 | 改信源与提示词 |
| Agent 外壳 | `agent-run.mjs` 的循环、预算、兜底、工具权限 | 换工具实现 |
| 清洗器 | `sanitizeFrontmatter()` 三处 | 换枚举值 |
| 演练台 | `rehearse.mjs` / `rehearse-agent.mjs` **框架** | 场景重写 |
| 通知 | `notify-feishu.mjs` 三色卡片 | 加一类 verdict |
| 自检 | `check-workflow-yaml/shell` · `check-master-prompt` · `check-loads` | 通用 |
| 工具 | `reencode-gsc-key.mjs` · `probe-pro-endpoint.mjs` | 通用 |

### 4.2 必须重写

| 类别 | 原因 |
|---|---|
| `research.mjs` 的 `CANDIDATES` | 马来西亚官方源：MITI、Matrade、Royal Malaysian Customs、Bank Negara、MPOB、Bursa |
| 业务计算器（20+） | 关税结构、SST、AIFA、原产地规则完全不同 |
| `qa-check.mjs` 的规则集 | 栏目、读者段、禁用词（马来语/英语混排） |
| Schema 枚举 | category / audience / information_gain 不同 |
| `MASTER_PROMPT.md` + 写作者任务 | 受众从"中国进口商"变成"马来西亚出口商" |
| 站点 UI | 语言、货币、日期格式 |
| 账号配置 | GSC / GA4 / Cloudflare / Feishu 全部新建 |

### 4.3 新项目建议：**先只开 A 线**

**★ 理由（来自本项目的实测）：**

```
A 线第 1 天就通了
B 线花了 4 天才通，而且今天仍然靠日期后缀兜底

★ 30 天里 A 线一直在出文章，B 线的价值在"探索"
★ 而探索需要一个已经成立的基准
```

**建议节奏：**

```
第 1-4 周   只跑 A 线，目标"能发出 1 篇合格文章"
第 5-8 周   每天 1 篇，攒 30 篇
第 9 周起   再开 B 线，用来发现 A 线想不到的角度
```

**★ 而 B 线一开始就用 lite（便宜 11 倍），轮数锁 10 —— 因为它前 4 轮就把活干完了。**

### 4.4 迁移时最容易忘记的三件事

```
① 演练台必须跟着重写
   25 条场景是保险丝。只复制文件不改场景，等于没有保险丝。

② 幂等护栏的"日期"要按目标时区
   代码里写死 8*3600e3 要改成常量，否则跨时区会漏发或重发。

③ 强发路径的 frontmatter 清洗必须跟着新枚举重写
   这是本项目把站点搞挂过三次的地方。
```

---

## 五、遗留事项（老项目）

| # | 事项 | 影响 |
|---|---|---|
| 1 | **research 提案前按台账剔除文档** | B 线至今靠日期后缀，仍会产出近重复 |
| 2 | **列表页翻第二页** | 正文 8 篇（目标 20） |
| 3 | **Cloudflare Worker 外部触发** | GitHub cron 延迟 6 小时甚至整次跳过 |
| 4 | **GA4 Data API 接入** | `get_ga4_trending` 目前读 Cloudflare 数据，不是 GA4 |

**★ 第 1 条是唯一能让 B 线"不靠兜底发真新文章"的改动。一次只改这一处。**

---

## 六、一页纸速查

```
┌──────────────────────────────────────────────────────────────────┐
│ 架构一句话                                                       │
│   代码管边界，模型管内容。外壳确定性，内核概率性。               │
├──────────────────────────────────────────────────────────────────┤
│ 双引擎                                                           │
│   A 线 Pro（592s / $0.008 / 一次写好）                           │
│   B 线 lite（10 轮 / $0.0007 / 探路 + 兜底）                     │
├──────────────────────────────────────────────────────────────────┤
│ 六道锁                                                           │
│   双 cron · 路线幂等 · 美元上限 · 循环外交卷 · 降级链 · 三道清洗 │
├──────────────────────────────────────────────────────────────────┤
│ 八个坑（换模型才点亮）                                           │
│   超时 · SSE · 内心戏 · 假成功 · 枚举 · 抓取枯竭 · cron · 误杀   │
├──────────────────────────────────────────────────────────────────┤
│ 两条铁律                                                         │
│   风格问题不拦发布，事实问题必须拦住                             │
│   新模型不会适配你的隐含假设，它只会把它们全部点亮               │
└──────────────────────────────────────────────────────────────────┘
```

---

**归档完毕。老项目进入无人值守巡航。**
