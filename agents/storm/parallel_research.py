"""
STORM-style parallel research (Agent 4: seo_researcher)

核心思想：不要一次只搜一个 query。并行发多个角度的搜索 query，
去重后对比 top-3 SERP，找"前三名都没覆盖的信息增量"——这是我们的护城河。

后端二选一：
  - 默认：duckduckgo-search（免费，无需 API key）
  - 可选：GPTResearcher（深度研究，需 OPENAI_API_KEY）
"""
from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
from typing import List


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str
    source_type: str = "web"   # web | official | competitor


@dataclass
class ResearchResult:
    keyword: str
    hits: List[SearchHit] = field(default_factory=list)
    information_gain: str = ""  # top-3 没覆盖的点


# 并行 query 模板：围绕一个目标词，从多个角度切
def parallel_queries(keyword: str) -> List[str]:
    return [
        keyword,
        f"{keyword} official announcement",
        f"{keyword} site:gov.my OR site:asean.org",
        f"{keyword} impact importer",
        f"{keyword} analysis 2026",
    ]


async def _search_one(query: str) -> List[SearchHit]:
    """单 query 搜索。默认用 duckduckgo；无网时返回空。"""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            raw = list(ddgs.text(query, max_results=5))
        return [
            SearchHit(
                title=r.get("title", ""),
                url=r.get("href", ""),
                snippet=r.get("body", ""),
                source_type="official" if any(
                    d in r.get("href", "") for d in ("gov.my", "asean.org", "mida.gov.my", "miti.gov.my")
                ) else "web",
            )
            for r in raw
        ]
    except Exception as e:
        print(f"[parallel_research] search failed for '{query}': {e}")
        return []


async def parallel_research(keyword: str) -> ResearchResult:
    """并行跑所有 query，去重，返回结果。"""
    queries = parallel_queries(keyword)
    results = await asyncio.gather(*[_search_one(q) for q in queries])
    seen = set()
    hits: List[SearchHit] = []
    for batch in results:
        for h in batch:
            if h.url not in seen:
                seen.add(h.url)
                hits.append(h)
    # 信息增量启发式：官方源 + 没有竞品覆盖的点
    official = [h for h in hits if h.source_type == "official"]
    info_gain = (
        f"Found {len(official)} official sources; "
        "information gain must be verified manually against SERP top-3."
    )
    return ResearchResult(keyword=keyword, hits=hits, information_gain=info_gain)


if __name__ == "__main__":
    r = asyncio.run(parallel_research("malaysia export policy 2026"))
    print(f"hits: {len(r.hits)}; gain: {r.information_gain}")
