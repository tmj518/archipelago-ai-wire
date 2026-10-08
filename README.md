# 单人全自动多国 AI 时政内容出海项目（一期：马来西亚站）

**定位**：中国境内单人全自动 AI 内容出海系统。把国别时政/经济/贸易/政策一手官方数字与文件，加工成中立、深度、可落地的政策深度解读，面向欧美平台卖家与一带一路/新兴市场进口商及政策决策者。

**阶段**：一期只做马来西亚英文独立站（后续复制到印尼、拉美西语、巴西葡语，四国独立域名）。

## 技术栈
- **Astro**（静态站点）+ **pnpm**（包管理）
- **Cloudflare Pages**（托管）+ **Cloudflare Workers**（会员/支付/权限）+ **Cloudflare KV**（轻量存储）
- **Stripe + PayPal**（付费订阅：月/年/终身）
- **Git + GitHub**（源码仓库，CI 触发 Pages 构建部署）

## 快速开始
```powershell
# 1. 安装依赖
pnpm install

# 2. 本地开发
pnpm dev

# 3. 构建（产物在 dist/，CF Pages 部署源）
pnpm build

# 4. 三道闸门 + preflight 总闸
node tools/preflight.mjs
```

## 目录架构
见 `PROJECT_SPEC.md` 第四章（对标融资新闻站 Rest of World 优化）。

## 关键文档
- `PROJECT_SPEC.md` — 项目规范（规则本体，豆包工作智能体读取）
- `docs/METHODOLOGY_v1.md` — 内容中立方法论
- `docs/对标_Rest_of_World.md` — 对标记录
- `docs/内容线_选题矩阵.md` — 已覆盖 vs 待做
- `进度日志.md` — 每轮工作记录

## 环境要求（已确认）
- node ≥ 22 ✅（实测 v22.23.2）
- git ≥ 2.4 ✅（实测 2.56.0）
- pnpm ✅（corepack 装，实测 12.10.1）
- wrangler ✅（npx 方式，实测 4.147.0；项目内建议作为 devDependency 锁定）
- gh CLI ✅（实测 2.102.0）
- SSH 密钥 `id_ed25519` ✅ 已存在
