# agents/ — CrewAI + STORM 11 智能体流水线

> **CrewAI 解决"怎么排"，STORM 解决"研究得多深"。两个都要。**

## 目录

```
agents/
├── config/
│   ├── agents.yaml      # 11 个角色定义（goal/backstory）
│   └── tasks.yaml       # 10 个任务（单向数据流，翻译任务三期启用）
├── storm/               # STORM 方法（研究深度）
│   ├── perspective.py       # Agent 3：视角生成（4 利益相关方）
│   ├── parallel_research.py# Agent 4：并行搜索（多 query 并行 + 信息增量）
│   └── conversation.py      # Agent 5：模拟对话（反面论证 + 局限）
├── crew.py              # CrewAI 主编排（11 角色串行）
├── main.py              # 本地入口
├── output/              # 产出（草稿/日志）
└── requirements.txt
```

## 11 角色对应关系

| # | 角色 | STORM 方法 | 输出 |
|---|---|---|---|
| 1 | topic_scout | — | 候选选题 JSON |
| 2 | fact_checker | — | 双源核验 |
| 3 | localized_writer | **Perspective-Guided** | 1500-2500 词英文稿 |
| 4 | seo_researcher | **Parallel Research** | SEO 字段 + 信息增量 |
| 5 | neutrality_auditor | **Simulating a Conversation** | 反论点 + 审计报告 |
| 6 | polish_editor | — | 母语级润色 |
| 7 | multimodal_producer | — | 播客稿 + YouTube 脚本 |
| 8 | localized_translator | — | 三期西/葡语改写 |
| 9 | static_builder | — | src/content/posts/*.md |
| 10 | deployer | — | 闸门 + git + CF Pages |
| 11 | data_optimizer | — | GSC 回流，选题权重 |

## 快速开始

```bash
cd agents
pip install -r requirements.txt

# dry-run：不调 LLM，只验证 STORM 方法模块能跑
python main.py "malaysia export policy 2026"

# 真跑 CrewAI（需配 OPENAI_API_KEY / DASHSCOPE_API_KEY）
CREWAI_LIVE=1 python main.py "malaysia export policy 2026"
```

## 故障兜底

任一 Agent 校验不通过 → 中断当前任务，保存日志到 `output/`，不继续向下流转。
写稿智能体与质检智能体必须分离（不同 LLM 实例），见 PROJECT_SPEC §1 原则 1。

## 与 Astro 工程的衔接

Agent 9（static_builder）产出 `src/content/posts/<slug>.md`，Agent 10（deployer）跑：
```
node tools/qa-check.mjs <file>
node tools/reviewer-check.mjs --all
node tools/preflight.mjs --build
git add / commit / push
```
闸门全绿才允许推送 Cloudflare Pages。
