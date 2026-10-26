# 集成配置指南：Notion · 飞书 · YouTube

> 建立日期：2026-10-03
> 前置条件：Python 3.13.16 ✅ · ffmpeg 9.0.2 ✅ · yt-dlp ✅ · n8n ✅（见 README §3.5）

---

## 零、为什么这三项我做不完

前四项（Python / ffmpeg / yt-dlp / n8n）是**软件**，我能下载安装并验证。

这三项是**账号授权**——它们全部需要：

1. 用**你的账号**登录第三方控制台
2. 创建应用 / 集成
3. **点击同意授权**（OAuth 弹窗，必须人工点）

Agent 拿不到这些，**也不应该拿到**：一旦把长期令牌写进代码或仓库，等于把账号交出去。

**我能做的**：把代码、配置和调用路径全部准备好，你只管填凭据。
**你要做的**：下面每一步里标了 **【你来做】** 的动作。

**⚠️ 安全红线（三条）**：凭据只放 `.env`（已 gitignore）；**永远不要**贴进聊天或提交进仓库；如果误贴了，立刻去控制台**吊销重建**——不要只是删除消息。

---

## 一、Notion

**用途**：选题库 / 内容日历 / GSC 数据回流看板。n8n 有官方 Notion 节点，配好后可以"新文章发布 → 自动写入数据库"。

### 步骤

1. **【你来做】** 打开 <https://www.notion.so/my-integrations> → **New integration**
   - Name：`Landed Math Automation`
   - Type：**Internal**
   - Capabilities：勾 `Read content`、`Insert content`、`Update content`
2. **【你来做】** 复制 **Internal Integration Secret**（`ntn_` 开头）
3. **【你来做】** 在 Notion 里**建一个数据库**（比如"选题池"），列建议：
   | 列名 | 类型 | 用途 |
   | --- | --- | --- |
   | Title | Title | 标题 |
   | Status | Select | Idea / Drafting / Gated / Published |
   | Silo | Select | 五个栏目 |
   | Target Keyword | Text | 目标词 |
   | Impressions | Number | GSC 曝光（回流用） |
   | Published | Date | 发布日期 |
4. **【你来做】** **关键一步**：打开该数据库页面 → 右上 `···` → **Connections** → 添加刚才那个集成
   > ⚠️ 不做这步，API 会返回 404——集成默认对任何页面都没有权限。这是 Notion 集成最常见的失败原因。
5. **【你来做】** 复制数据库 ID：数据库页面的 URL 形如
   `notion.so/<workspace>/<32位十六进制>?v=...`
   那 **32 位十六进制**就是 database_id
6. **【你来做】** 把这两项写进 `%LOCALAPPDATA%\Programs\n8n\.env`：
   ```
   NOTION_API_KEY=ntn_xxxxxxxxxxxx
   NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### 验证

```powershell
curl.exe -sS -X POST "https://api.notion.com/v1/databases/$env:NOTION_DATABASE_ID/query" `
  -H "Authorization: Bearer $env:NOTION_API_KEY" `
  -H "Notion-Version: 2022-06-28" `
  -H "Content-Type: application/json" -d '{\"page_size\":1}'
```
返回 JSON（不是 404）就通了。

---

## 二、飞书（Feishu / Lark）

**用途**：通知与状态同步。n8n 有飞书节点，可做到"文章过闸门 → 推送群消息"、"GSC 周报 → 推送"。

### 步骤（自建应用）

1. **【你来做】** 打开 <https://open.feishu.cn/app> → **创建企业自建应用**
   - 名称：`Landed Math Bot`
2. **【你来做】** 在「凭证与基础信息」里复制 **App ID** 和 **App Secret**
3. **【你来做】** 「权限管理」里开通：
   - `im:message`（发消息）
   - `im:message:send_as_bot`
   - （如需读群消息再加 `im:chat`）
4. **【你来做】** 「版本管理与发布」→ 创建版本 → **申请发布**（企业自建应用需管理员审核）
5. **【你来做】** 在飞书里**建一个群**（比如"Landed Math 运营"）→ 群设置 → **添加机器人** → 选刚创建的应用
6. **【你来做】** 拿 **chat_id**：群里发一条消息，然后
   ```
   GET https://open.feishu.cn/open-apis/im/v1/chats
   Authorization: Bearer <tenant_access_token>
   ```
   或直接用群设置里的群链接找
7. **【你来做】** 写进 `n8n\.env`：
   ```
   FEISHU_APP_ID=cli_xxxxxxxxxxxx
   FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   FEISHU_CHAT_ID=oc_xxxxxxxxxxxx
   ```

### 关于"飞书客户端"

飞书有 Windows 桌面客户端（<https://www.feishu.cn/download>）。**但机器人通知不需要装客户端**——服务端 API 就够了。装客户端只是为了你自己方便看消息。

### 验证

```powershell
# 1) 取 tenant_access_token
curl.exe -sS -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" `
  -H "Content-Type: application/json" `
  -d '{\"app_id\":\"cli_xxx\",\"app_secret\":\"xxx\"}'
# 2) 用返回的 token 发消息
curl.exe -sS -X POST "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id" `
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" `
  -d '{\"receive_id\":\"oc_xxx\",\"msg_type\":\"text\",\"content\":\"{\\\"text\\\":\\\"Landed Math 测试\\\"}\"}'
```

---

## 三、YouTube

**用途**：上传 `tools/make-video.py` 生成的视频，拿到 video id 回写文章。

### 现实说明（重要）

**没有"YouTube 客户端"可以自动上传。** YouTube 没有官方桌面上传程序，上传只有两条路：

| 方式 | 自动化 | 说明 |
| --- | --- | --- |
| **浏览器手动上传** | ❌ | 最简单，零配置。适合 Y1 的 3-5 条验证期 |
| **YouTube Data API v3** | ✅ | 需要 Google Cloud 项目 + OAuth + 配额。适合 Y2 正式启动后 |

**我的建议：Y1 用手动上传。** 理由：Y1 只做 3-5 条验证，搭建 OAuth 的时间成本高于收益。等确认视频产线可跑、决定 Y2 正式启动时，再建 API。

### 路线 A：手动上传（Y1 推荐）

1. **【你来做】** YouTube Studio → 上传 `build\video\<slug>.mp4`
2. **【你来做】** 标题建议直接复用文章标题；描述里放 `landedmath.com` 和文章 URL
3. **【你来做】** 拿到 video id（URL 里 `watch?v=` 后面那 11 位）
4. **【告诉我】** 我把它写进文章 frontmatter：
   ```yaml
   youtube_id: "dQw4w9WgXcQ"
   videoTitle: "..."
   videoDuration: "PT1M52S"
   ```
   → 自动渲染播放器 + `VideoObject` 结构化数据

### 路线 B：YouTube Data API v3（Y2 用）

1. **【你来做】** <https://console.cloud.google.com/> → 新建项目 `landed-math`
2. **【你来做】** 启用 **YouTube Data API v3**
3. **【你来做】** 「OAuth 同意屏幕」→ External → 填应用名/支持邮箱 → 加测试用户（你自己的 Google 账号）
4. **【你来做】** 「凭据」→ 创建 **OAuth 客户端 ID** → 类型选 **桌面应用**
5. **【你来做】** 下载 JSON，存为 `%LOCALAPPDATA%\Programs\n8n\youtube-oauth.json`
   > ⚠️ **此文件绝不能进仓库**。它等同账号密码。
6. **【告诉我】** 我写一个上传脚本（首次运行会弹浏览器让你点同意，之后令牌缓存到本地）

### 配额现实

YouTube Data API 默认配额 **10,000 单位/天**，而**一次视频上传消耗 1,600 单位**。
→ **每天最多约 6 条**。对每天 1 条完全够用，但要记得这个上限。

---

## 四、n8n 怎么把它们串起来

n8n **2.42.1 已装好并验证可启动**，位置 `%LOCALAPPDATA%\Programs\n8n\`（1619 MB，含 1891 个包）。

**启动**：

```powershell
pwsh -File tools\start-n8n.ps1
```

脚本会设好 Node PATH、`N8N_USER_FOLDER`、`N8N_SECURE_COOKIE=false`，并在存在 `n8n\.env` 时自动加载凭据。打开 <http://localhost:5678>。

### ⚠️ 安装时踩的两个坑（已解决，但换机器会重现）

**坑 1：pnpm 默认不跑构建脚本 → n8n 起不来**

pnpm 11 装完会写一个 `pnpm-workspace.yaml`，里面的值是**占位符**：

```yaml
allowBuilds:
  sqlite3: set this to true or false     # ← 字面就是这句话
```

不改成 `true`，sqlite3 的原生模块就不会编译，n8n 报：

```
DriverPackageNotInstalledError: SQLite package has not been found installed
```

**坑 2：sqlite3@5.1.7 在 Node 24 上根本没有预编译包**

- 5.1.7 用老的 `node-pre-gyp`（**绑定 Node ABI**）→ Node 24（ABI 137）没有对应二进制 → 退回源码编译
- 本机**没有任何 MSVC 工具链**（`Microsoft Visual Studio`、`Windows Kits` 均不存在）→ 编译必失败
- 6.x 改用 **NAPI**（`prebuild-install -r napi`，`napi_versions 3/6`）→ **NAPI 二进制跨 Node 版本通用**，所以有 Node 24 的包

**解法**：在 `pnpm-workspace.yaml` 加 override 提到 6.x

```yaml
overrides:
  sqlite3: ^6.0.1
```

**坑 3：GitHub Releases 下载超时**（这台机器的老问题）

即使换成 6.0.1，`prebuild-install` 从 GitHub Releases 拉包**仍然超时**：

```
prebuild-install warn install Request timed out
```

**解法**：用 curl（带断点续传）手动下到 `prebuild-install` 优先查找的本地目录，它就会跳过网络：

```powershell
$sq = "$env:LOCALAPPDATA\Programs\n8n\node_modules\.pnpm\sqlite3@6.0.1\node_modules\sqlite3\prebuilds"
New-Item -ItemType Directory -Force -Path $sq | Out-Null
curl.exe -4 -L -C - --max-time 180 --retry 3 -o "$sq\sqlite3-v6.0.1-napi-v6-win32-x64.tar.gz" `
  "https://github.com/TryGhost/node-sqlite3/releases/download/v6.0.1/sqlite3-v6.0.1-napi-v6-win32-x64.tar.gz"
# 然后重跑 prebuild-install
cd "$env:LOCALAPPDATA\Programs\n8n\node_modules\.pnpm\sqlite3@6.0.1\node_modules\sqlite3"
node "$env:LOCALAPPDATA\Programs\n8n\node_modules\.pnpm\prebuild-install@7.1.3\node_modules\prebuild-install\bin.js" -r napi
```

> 校验提示：GitHub Release 的 `HEAD` 请求拿不到 `content-length`（会 302 到 `objects.githubusercontent.com`），所以**别用大小判断是否下完**——检查 gzip 魔数 `1F 8B` 更可靠。

### 已知限制

| 限制 | 影响 | 说明 |
| --- | --- | --- |
| `isolated-vm` 未编译 | Code 节点的沙箱 `enabled=false` | 同样无预编译包 + 无编译器。**功能可用**，但 Code 节点跑在主进程而非隔离 VM |
| 无 MSVC 工具链 | 任何需要源码编译的 npm 包都会失败 | 装 VS Build Tools 可解决（约 5 GB），目前判断不值得 |
| 无独立 Node/npm | n8n 依赖 DSH 运行时的 `node.exe` | 只能用 `pnpm`。DSH 运行时若被清理，n8n 需重装 |

### 配好凭据后可以做的三条工作流

| 工作流 | 触发 | 动作 |
| --- | --- | --- |
| **发布通知** | 文件监听 / 定时 | 检测到新文章 → 飞书群推消息 |
| **GSC 周报** | 每周一 | 拉 GSC 数据 → Notion 写库 → 飞书推送（对应规范 §8 的回流机制） |
| **视频上传** | 每天 | 调 make-video.py → YouTube API 上传 → 回写 frontmatter → 飞书通知 |

**但请注意**：这三条现在**都还是手工更划算**。n8n 的价值在"要连 3 个以上 SaaS 且步骤固定"时。建议：

- **Y1 先别急着建工作流**——你的量（每天 1 篇）用现成脚本更可控
- **等产量提到每天 2 篇、或开始多语种时再上 n8n**

---

## 五、现在的状态与下一步

| 项 | 状态 |
| --- | --- |
| Python 3.13.16 + 10 个库 | ✅ 已装并验证 |
| ffmpeg 9.0.2（含 libx264） | ✅ 已装并验证 |
| yt-dlp | ✅ 已装 |
| n8n | ✅ 安装中/已装，未启动 |
| 视频生成脚本 | ✅ 已跑通，产出 1 分 52 秒视频 |
| 文章视频组件 | ✅ 已上线（`youtube_id` → 播放器 + VideoObject） |
| **Notion 凭据** | ⏳ **等你建集成 + 建库 + 连授权** |
| **飞书凭据** | ⏳ **等你建应用 + 加机器人** |
| **YouTube** | ⏳ **Y1 建议手动上传第一条** |

**最快的下一步**：手动上传那条已经生成好的视频，把 11 位 id 发我，我回写进 [eu-per-item-customs-charge-2026](/blog/eu-per-item-customs-charge-2026/) 并验证线上渲染。
