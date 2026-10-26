# YouTube 上传 · 手把手（2026-10-03 定）

> **这份文件补的是《docs/integration/集成配置指南.md》第三节里"路线 B"的可执行版本。**
> 那份指南写的是"Y2 再做 API"；现在决定提前做，因为视频产线已经是熟的了。
>
> **为什么值得**：手动上传每条要开浏览器 + 复制三处元数据 + 手动回写 frontmatter。API 做完，**一条命令出视频 id**，而且 `youtube_id` 回写可以进脚本。

---

## 已经做好的（不需要你动手）

| 产物 | 说明 |
| --- | --- |
| `tools/youtube-upload.mjs` | 上传脚本。OAuth 一次性授权 → 上传 mp4 → 设封面 → 挂英文字幕 → 打印 11 位 id |
| `.gitignore` | 已加 OAuth 客户端与 token 的屏蔽规则（用 `git check-ignore` 验证过 8 条路径） |
| `build/video/eu-per-item-customs-charge-2026.mp4` | 第一条视频，**已渲染好**：1920×1080 H.264/AAC，1:45，3.3 MB |
| `…-thumb.png` | 封面 **1280×720**，正好是 YouTube 要求 |
| `…-youtube.txt` | 标题 / 简介 / 标签，脚本直接读它，不用你复制粘贴 |

**脚本已用 `--dry-run` 跑通**，元数据解析正确。缺文件时会明确报错而不是静默失败。

---

## 你需要动手的部分（只有这两步，约 10 分钟）

### 第一步：建一个专用频道（约 3 分钟）

在 YouTube 里新建频道，而不是改你现有的 `mingjie tang`——避免个人内容与 B2B 英文内容混在一起。

> ⚠️ **关键：用"品牌账号（Brand Account）"而不是"个人频道"。**
> 两者都能用，但品牌账号的优势是：**以后可以授权给第二个人管理，且频道名与你的 Google 账号名独立**。个人频道在"改名"和"移交"上都会受限。
> 截图里显示的是 `mingjie tang`，那是**个人频道**。品牌账号建出来默认名会是你选的名字。

**操作**：
1. 打开 <https://www.youtube.com/channel_switcher>（或点右上角头像 → 切换账号 → 新建频道）
2. 选 **"创建频道"→ 使用自定义名称**（这就是品牌账号）
3. 频道名填 **`Landed Math`**
4. 频道柄（handle）尽量抢 **`@landedmath`**（被占了就 `@landedmathhq` / `@landed-math`）

**建完填这几处**（文案我写好了，直接粘）：

**简介 / Description**：
```
China trade policy, converted into landed cost.

Independent analysis of Chinese trade policy, customs and supply chains,
converted into per-unit and per-container landed cost for sellers and
importers worldwide. Every figure is sourced and dated.

Not a customs broker, law firm or tax adviser.

https://landedmath.com
```

**链接**：`https://landedmath.com`

**头像**：用 `public/favicon.svg`（如果是方形 SVG 需要先导出成 PNG，YouTube 要 800×800）
**横幅**：可以先跳过，YouTube 会给默认图

> ⚠️ **品牌账号有一个坑**：如果以后要给"品牌账号"加管理员，对方的 Google 账号需要先能访问这个品牌账号。你自己的账号是所有者，不受影响。

### 第二步：Google Cloud 建 OAuth 客户端（约 5 分钟）

| # | 操作 | 注意 |
| --- | --- | --- |
| 1 | <https://console.cloud.google.com/> → 新建项目 `landed-math` | 项目名随便，只是容器 |
| 2 | 「API 和服务」→「库」→ 搜 **YouTube Data API v3** → 启用 | 不启用的话上传会 403 |
| 3 | 「OAuth 同意屏幕」→ 用户类型选 **外部（External）** | 选"内部"需要 Workspace，个人 Gmail 没有 |
| 4 | 填应用名 `Landed Math`、支持邮箱、开发者邮箱 | 不上架，所以填了就行 |
| 5 | **「测试用户」里加上你自己的 Gmail** | ⚠️ **漏了这步会在授权时被拒**，报"应用未验证" |
| 6 | 「凭据」→ 创建凭据 → **OAuth 客户端 ID** → 类型选 **桌面应用（Desktop app）** | ✅ 一定是桌面应用，不是 Web 应用——桌面应用才允许 `127.0.0.1` 回调 |
| 7 | 下载 JSON → 存为 `%LOCALAPPDATA%\Programs\n8n\youtube-oauth.json` | ⚠️ **这个文件等于账号密码，绝不能进仓库**（已 gitignore） |

**第 5 步是最容易漏的。** 同意屏幕处于"测试"状态时，只有加进测试用户的账号能授权。

---

## 然后跑这条命令

```powershell
node tools/youtube-upload.mjs eu-per-item-customs-charge-2026
```

**第一次运行**会：
1. 打印一个 Google 授权 URL
2. 你打开它、**用拥有新频道的那个账号**登录、点同意
3. 浏览器跳到 `127.0.0.1:8765`，脚本接住授权码
4. 上传 → 设封面 → 挂字幕 → 打印 id

**refresh token 会缓存到** `%LOCALAPPDATA%\Programs\n8n\youtube-token.json`，**以后每次运行不再需要浏览器**。

---

## 两个必须知道的限制

### 1. 视频会以 `private` 上传，而且可能需要你手动转公开

脚本**默认 `--privacy=private`**，这是故意的：API 上传是立刻生效的，第一次应该先在 Studio 里看一眼再公开。

> ⚠️ **实测提醒**：OAuth 应用处于"测试"状态且未验证时，**通过 API 上传的视频会被锁定为 private，API 也改不成 public**（`youtube.upload` 本身不是敏感 scope，但未验证应用的产物会被限制）。**所以流程是：API 上传 → 你在 Studio 里审核 → 手动点成公开。**
>
> 这一步**是否真的被锁，取决于 Google 当时的策略，我没有实测过**（没有凭据）。所以：**先跑一次，别假设它能自动公开。**

### 2. 配额

默认 **10,000 单位/天**，一次上传 **1,600 单位** → **每天最多约 6 条**。每天 1 条完全够。

---

## 拿到 id 之后

```yaml
youtube_id: "dQw4w9WgXcQ"     # 只要 11 位，不要整条 URL
videoTitle: "..."              # 可选，默认用文章标题
videoDuration: "PT1M45S"       # ISO 8601，喂给 VideoObject
```

组件会自动渲染 `youtube-nocookie` 播放器 + `VideoObject` 结构化数据。

**脚本会把这三行直接打印出来**，复制进 `src/content/blog/<slug>.md` 的 frontmatter 即可。

---

## 其他有用的命令

```powershell
# 只看元数据、不上传（改文案时用）
node tools/youtube-upload.mjs eu-per-item-customs-charge-2026 --dry-run

# 上传为不公开列出
node tools/youtube-upload.mjs <slug> --privacy=unlisted

# 跳过封面或字幕
node tools/youtube-upload.mjs <slug> --no-thumbnail --no-captions

# 重新生成某篇文章的视频（产物在 build/video/，已 gitignore）
python tools/make-video.py <slug>
```

---

## 第一条视频的现状（核对用）

```
文件      build/video/eu-per-item-customs-charge-2026.mp4
规格      h264 / aac · 1920×1080 · 30fps · 105.5 秒 · 3.5 MB
封面      1280×720 PNG
字幕      .srt（word-level 同步）
标题      The EU Now Charges by the Item, Not the Parcel — and Ten Euros Can Cost Fifteen
文章      src/content/blog/eu-per-item-customs-charge-2026.md
youtube_id  ❌ 仍为空 —— 上传后回填
```
