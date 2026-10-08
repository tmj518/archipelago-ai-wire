"""
STORM Perspective-Guided generation (Agent 3: localized_writer)

参考：Stanford STORM（Shao et al., 2024）的 perspective-guided question asking。
核心思想：文章不是从单一叙述者角度写，而是预先列出利益相关方视角，
每个视角生成一组问题，回答完所有视角的问题后再组织成文。

我们简化为 4 个固定视角（对应 §4.6.2 影响分级）：
  - Importer（进口商）
  - Exporter / Manufacturer（出口商/制造商）
  - Investor（投资人）
  - Regulator / Policy observer（监管/政策观察者，提供中立视角）
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List


@dataclass
class Perspective:
    name: str           # 视角名
    concern: str        # 该视角最关心什么
    questions: List[str] = field(default_factory=list)


# 固定视角池（马来西亚英文站一期）
PERSPECTIVES: List[Perspective] = [
    Perspective(
        name="Importer",
        concern="Landed cost, lead time, supply reliability, duty exposure",
        questions=[
            "How does this change my per-unit landed cost?",
            "Will my supplier's lead time get shorter or longer?",
            "Which HS codes does this policy touch?",
        ],
    ),
    Perspective(
        name="Exporter / Manufacturer",
        concern="Incentive eligibility, order book, capacity priority",
        questions=[
            "Can I apply for the incentive, and what is the timeline?",
            "Does this favor high-value contracts over general orders?",
            "What documentation does MIDA/MITI require?",
        ],
    ),
    Perspective(
        name="Investor",
        concern="Sector signal, capital allocation, risk of policy reversal",
        questions=[
            "Which listed firms or sub-sectors does this target?",
            "How permanent is this policy vs. an election-cycle move?",
            "What would make this thesis wrong?",
        ],
    ),
    Perspective(
        name="Regulator / Policy observer",
        concern="Stated goal, enforcement, cross-border spillover",
        questions=[
            "What is the official stated rationale, in the original text?",
            "How does this align with existing ASEAN/RCEP commitments?",
            "What is not yet quantified or enforced?",
        ],
    ),
]


def build_perspective_prompts(topic: str) -> List[dict]:
    """为每个视角生成写作提示。Agent 3 用这些提示分别起草，再合并。"""
    out = []
    for p in PERSPECTIVES:
        out.append({
            "perspective": p.name,
            "concern": p.concern,
            "topic": topic,
            "questions": p.questions,
            "instruction": (
                f"Write 150-250 words from the {p.name} perspective about: {topic}. "
                f"Address: {p.concern}. Use only confirmed facts labeled from the "
                "verified evidence chain. Mark any inference as 'Reasonable inference'."
            ),
        })
    return out


def merge_perspectives(drafts: List[dict]) -> str:
    """
    把 4 个视角的草稿合并成一篇文章骨架。
    合并规则（对应 v2.0 模板）：
      - ANSWER 从所有视角的共同结论提炼
      - 证据链按视角分组但不割裂
      - 影响分级直接用 4 个视角做段落
      - 反面论证用 Investor 视角的 "what would make this wrong"
      - 局限用 Regulator 视角的 "not yet quantified"
    """
    sections = [d["perspective"] for d in drafts]
    body = "\n\n".join(f"## {d['perspective']}\n{d['draft']}" for d in drafts)
    return f"<!-- merged from perspectives: {', '.join(sections)} -->\n\n{body}"
