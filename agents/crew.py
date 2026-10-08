"""
agents/crew.py — CrewAI 主编排（11 角色单向数据流）

CrewAI 解决"怎么排"：把 11 个角色按依赖串成流水线。
STORM 解决"研究得多深"：嵌在 Agent 3/4/5 三个关键节点。

任一任务失败 → 中断下游，保存日志，不污染产物（PROJECT_SPEC §五 故障兜底）。
"""
from __future__ import annotations
import os
from pathlib import Path
from typing import Optional

import yaml
from dotenv import load_dotenv

try:
    from crewai import Agent, Task, Crew, Process, LLM
    CREWAI_AVAILABLE = True
except ImportError:
    CREWAI_AVAILABLE = False
    print("[crew] crewai not installed yet. Run: pip install -r agents/requirements.txt")

from storm.perspective import build_perspective_prompts, merge_perspectives
from storm.parallel_research import parallel_research
from storm.conversation import simulate_conversation, must_have_sections

# 加载 .env
load_dotenv(Path(__file__).parent / ".env")

CONFIG_DIR = Path(__file__).parent / "config"
OUTPUT_DIR = Path(__file__).parent / "output"


def _build_llm(role: str) -> "LLM":
    """
    按角色返回 LLM 实例。写稿/质检分离（PROJECT_SPEC §1 原则 1）。
    豆包 ARK 是 OpenAI 兼容端点，CrewAI 的 LLM 直接支持。
    """
    api_key = os.environ.get("ARK_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
    model = os.environ.get("WRITER_MODEL", "doubao-pro-32k")
    if role in ("fact_checker", "neutrality_auditor", "polish_editor", "deployer"):
        model = os.environ.get("AUDITOR_MODEL", "doubao-pro-128k")
    return LLM(
        model=f"openai/{model}",
        api_key=api_key,
        base_url=base_url,
    )


def _load_yaml(name: str) -> dict:
    with open(CONFIG_DIR / name, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_agents() -> dict:
    """从 agents.yaml 实例化 11 个 Agent。写稿/质检分离：不同角色用不同 LLM。"""
    if not CREWAI_AVAILABLE:
        return {}
    cfg = _load_yaml("agents.yaml")
    agents = {}
    for key, spec in cfg.items():
        agents[key] = Agent(
            role=spec["role"],
            goal=spec["goal"],
            backstory=spec["backstory"],
            verbose=spec.get("verbose", True),
            allow_delegation=spec.get("allow_delegation", False),
            llm=_build_llm(key),
        )
    return agents


def build_tasks(agents: dict) -> list:
    """从 tasks.yaml 实例化 10 个任务（翻译任务三期才启用）。"""
    if not CREWAI_AVAILABLE:
        return []
    cfg = _load_yaml("tasks.yaml")
    tasks = []
    for key, spec in cfg.items():
        agent_key = spec["agent"]
        if agent_key not in agents:
            continue
        tasks.append(Task(
            description=spec["description"],
            expected_output=spec["expected_output"],
            agent=agents[agent_key],
        ))
    return tasks


def run_pipeline(topic: str, dry_run: bool = True) -> Optional[dict]:
    """
    跑一轮完整流水线。
    dry_run=True 时不真调 LLM，只走 STORM 方法模块，验证骨架可导入。
    """
    OUTPUT_DIR.mkdir(exist_ok=True)

    # ── Agent 3: STORM Perspective-Guided ──
    perspective_prompts = build_perspective_prompts(topic)
    print(f"[agent3] {len(perspective_prompts)} perspectives ready for: {topic}")

    # ── Agent 4: STORM Parallel Research ──
    import asyncio
    research = asyncio.run(parallel_research(topic))
    print(f"[agent4] {len(research.hits)} hits, gain: {research.information_gain}")

    # ── Agent 5: STORM Simulating a Conversation ──
    counters = simulate_conversation("<!-- draft placeholder -->")
    print(f"[agent5] {len(counters)} counter-arguments generated; required sections: {must_have_sections()}")

    if dry_run or not CREWAI_AVAILABLE:
        return {
            "topic": topic,
            "perspectives": len(perspective_prompts),
            "research_hits": len(research.hits),
            "counter_arguments": len(counters),
            "mode": "dry-run",
        }

    # 真跑 CrewAI
    agents = build_agents()
    tasks = build_tasks(agents)
    crew = Crew(
        agents=list(agents.values()),
        tasks=tasks,
        process=Process.sequential,   # 单向数据流，串行
        verbose=True,
    )
    result = crew.kickoff(inputs={"topic": topic})
    return {"topic": topic, "result": str(result), "mode": "live"}


if __name__ == "__main__":
    import sys
    topic = sys.argv[1] if len(sys.argv) > 1 else "malaysia export policy 2026"
    out = run_pipeline(topic, dry_run=True)
    print(out)
