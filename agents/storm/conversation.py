"""
STORM Simulating a Conversation (Agent 5: neutrality_auditor)

核心思想：不直接审稿，而是模拟一场多角色对话——
  - Critic（批评者）：这篇哪里在甩锅、哪里在夸大？
  - Skeptic（怀疑者）：你这个数字的反例是什么？
  - Regulator（监管者）：这句话会不会被解读成政治煽动？
  - Competitor（竞品视角）：免费来源会怎么反驳你？

对话中暴露的反论点，必须写进文章的 "What would make this wrong" 段。
这是护城河：免费来源不写反方，我们写。
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List


@dataclass
class Role:
    name: str
    stance: str


@dataclass
class CounterArgument:
    role: str
    challenge: str
    draft_response: str


ROLES: List[Role] = [
    Role("Critic", "Attacks overstatement and bias"),
    Role("Skeptic", "Asks for the counter-example to every number"),
    Role("Regulator", "Flags politically sensitive or煽情 language"),
    Role("Competitor", "Asks why this is better than a free news report"),
]


def simulate_conversation(article: str) -> List[CounterArgument]:
    """
    输入草稿，输出 4 个角色的反论点 + 草稿回应。
    真实实现里这里调 LLM；骨架阶段返回结构化提示，由调用方填。
    """
    out: List[CounterArgument] = []
    for r in ROLES:
        out.append(CounterArgument(
            role=r.name,
            challenge=(
                f"[{r.name}] {r.stance}. Identify the weakest sentence in the "
                "draft and the one number that could be wrong."
            ),
            draft_response="",  # 由 LLM 填：我们怎么回应这个反论点
        ))
    return out


def must_have_sections() -> List[str]:
    """
    反面论证 + 局限段必须存在（对应 qa-check 闸门）。
    审计员任务：如果文章缺这两段，直接 BLOCK。
    """
    return [
        "## What would make this wrong",
        "## Limits",
    ]


def banned_word_scan() -> List[str]:
    """对应 PROJECT_SPEC §4.5 的英文门禁，由审计员执行。"""
    return [
        "delve", "landscape", "in today's fast-paced world",
        "it's important to note", "when it comes to",
        # 模糊词（May 月份大写除外）
        " may ", " might ", " possibly ", " perhaps ", " could ",
        "reportedly", "allegedly",
    ]
