# 回滚说明（v0.1.0-pre-distribution）

> **这份文件回答一个问题：线上出了问题，怎么退回去。**
>
> 它写给"出事时正在看这条消息的人"——**那个人很可能不是今天写这些代码的人，
> 也可能不是同一个月**。所以每一条都给出**可直接复制的命令**和**判断标准**，
> 而不是"参考 git 文档"。

---

## 一、先认出你在哪个版本

```bash
cd "C:\Users\tmj19\Desktop\出海官网更新工作流"

git log -1 --format="%h  %ad  %s" --date=short     # 现在在哪
git describe --tags                                 # 相对最近的 tag
git tag -l                                          # 有哪些 tag
```

**判断标准**：

```
输出里有 v0.1.0-pre-distribution   →  在发版点或其后
git describe 报 v0.1.0-pre-distribution-N-gXXXXXXX  →  在其后 N 个提交
git describe 报错 "No names found"  →  在此之前
```

**`v0.1.0-pre-distribution` 这个 tag 指向**：

```
提交      00622a4  （2026-10-12）
含义      "分发之前"——29 篇已发布，5 篇草稿保持 draft，22 个平台渲染器就绪，
           但【没有任何一条真实投递】。凭据一个都没有。
已发布    29 篇 · 127 个页面 · 123 个 URL
未做      邮件 / R2 / GSC / Stripe / Dev.to —— 全部等凭据
```

**★ 为什么 tag 打在 `00622a4`（本文档所在的那个提交）而不是内容提交 `907e67b`**：

```
tag 指向的那个提交，必须包含"怎么从这个 tag 回滚"的说明。
若打在 907e67b，checkout 到该 tag 的人【看不到这份文件】——
而出事时正是最需要它的时候。

所以：内容最后一次改动是 907e67b，tag 打在紧随其后、把这份说明纳入版本控制的 00622a4。
两者之间只差这一个文件，没有代码或内容变化。
```

---

## 二、三种回滚，按需要选

### A. 只撤掉线上（最快，不动仓库）

**Cloudflare Pages 有部署历史，回滚一个部署不需要碰 git。**

```
Cloudflare 面板 → Workers & Pages → china-cross-border-insider
  → Deployments → 找到要退回的那次 → ⋯ → Rollback to this deployment
```

**什么时候用这个**：**线上某个页面坏了，而你不确定是哪个提交造成的。**
**优点**：30 秒，不产生新提交，随时可以再 roll forward。

### B. 把整个仓库退到 tag（本地，不动线上）

```bash
cd "C:\Users\tmj19\Desktop\出海官网更新工作流"

git status --porcelain          # 必须为空；不空先处理，否则下面会失败
git switch --detach v0.1.0-pre-distribution
```

**看完之后回到主线**：

```bash
git switch main
```

**★ 这是只读的检查动作，`--detach` 不会丢东西。** 想真的把 `main` 退回去，用 C。

### C. 把 main 退回 tag（会用新提交撤销，不改写历史）

```bash
cd "C:\Users\tmj19\Desktop\出海官网更新工作流"

git switch main
git revert --no-commit v0.1.0-pre-distribution..HEAD   # 把 tag 之后的改动全部反做
git status                                             # 确认要撤的东西
git commit -m "revert: roll back to v0.1.0-pre-distribution"
git push origin main
```

**★ 为什么用 `revert` 而不是 `reset --hard`**：

```
reset --hard 会改写历史，而远端已经发布的提交被改写后，
下次 push 会被拒绝，或者需要 force push——那会抹掉别人的工作记录。
这个仓库只有一个人，但"只有一个人才更危险"：没有第二个人能发现你抹掉了什么。

revert 产出一个新提交，把改动反做。历史留着，出事的原因也留着。
```

**推送后 Cloudflare 会自动重新部署**，约 60–90 秒。

---

## 三、只回滚一篇文章或一个文件

**用不着整站回滚。** 单个文件退到某个提交：

```bash
cd "C:\Users\tmj19\Desktop\出海官网更新工作流"

git log --oneline -5 -- src/content/blog/<slug>.md     # 看它的改动史
git checkout <commit> -- src/content/blog/<slug>.md    # 退到那次的样子

node tools/qa-check.mjs src/content/blog/<slug>.md     # 过校验
node tools/gate.mjs                                    # 过七道闸门
git add -A && git commit -m "revert: <slug> to <commit>"
```

**★ 别跳过 `qa-check`。** 退回去的那一版**当时可能过闸门，但现在可能不过**——
因为闸门加过规则（2026-10-10 加了内链检查，10-11 加了字数档位判定）。

---

## 四、找出"线上这一页是哪个提交"的上游版本

```bash
cd "C:\Users\tmj19\Desktop\出海官网更新工作流"

# 线上某篇文章最后是被哪个提交改的
git log --oneline -3 -- src/content/blog/<slug>.md

# sitemap 里那个 lastmod 是从哪来的（内容派生的，不是构建时间）
node tools/sitemap-lastmod.mjs 2>/dev/null | head -1
```

**`/sources/` 页上有每篇文章的来源数、数字数与检索日**——**线上内容与仓库不一致时，
那是第一个该看的地方**（它在构建时从文章读，不会漂）。

---

## 五、这个 tag 不保证什么

**必须明说，否则回滚会给人错觉：**

| 不保证 | 说明 |
| --- | --- |
| **不保证自动化在跑** | `LandedMath-Daily` 计划任务**未注册**（2026-10-12 审计确认）。**没有定时任务，没有自动发布，也没有失败告警。** `run-daily.ps1` 有触发器才能跑 |
| **不保证能发出去** | 22 个平台里**只有 2 个有客户端（Dev.to / Buttondown），且都无凭据。** 3 个不需凭据的走文件导出。其余 17 个没有通路 |
| **不保证回滚后线上就对了** | Cloudflare 的 HTML 边缘缓存**未启用**（Cache Rule 未配），所以回滚后读者立刻看到新内容；但如果哪天启用了缓存，回滚后要记得清缓存 |
| **不保证 5 篇草稿能用** | 它们是 v0.1 骨架：0 个 figure、缺 5 个必需节，其中 2 篇的 source 字段写着 "placeholder figure, no real panel behind it"。**不要以为把 `draft` 改成 `false` 就能发。** |

---

## 六、出事时的最短路径

```
1. 线上坏了？
   → Cloudflare → Deployments → Rollback（30 秒，不碰 git）

2. 想知道根因？
   → git log --oneline -10
   → node tools/check-edge-cache.mjs      （缓存状态）
   → node tools/preflight.mjs             （环境与链路）

3. 要把仓库也退回去？
   → 上面第二节 C（revert，不改写历史）

4. 退完必须做的两件事：
   → node tools/gate.mjs        七道闸门
   → node tools/preflight.mjs   ALL CLEAR 才算完
```

**★ 回滚不是终点，闸门全绿才是。** 退回一版旧代码，而那一版当时是绿的、现在可能不绿——
**上面的第 4 步就是为了发现这件事。**

---

## 七、版本对照

| tag / 提交 | 日期 | 已发布 | 分发能力 | 备注 |
| --- | --- | --- | --- | --- |
| `951564b` 初始提交 | 2026-10-01 | 0 | 无 | Astro 7 骨架 |
| `907e67b` 内容末次改动 | 2026-10-12 | 29 | 0 条真实投递 | 29 篇 · 127 页 · 22 平台渲染器就绪 |
| **`v0.1.0-pre-distribution`** `00622a4` | **2026-10-12** | **29** | **0 条真实投递** | **上一行 + 本文档纳入版本控制；两者只差这一个文件** |

**下一个 tag 建议**：`v0.1.0-distribution` —— 条件是**至少一个平台有凭据并真实投递成功一次**。

---

*建档 2026-10-12。回滚流程改动时，改在明处。*
