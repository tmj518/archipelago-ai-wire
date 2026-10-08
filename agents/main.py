"""
agents/main.py — 本地入口

用法：
  cd agents
  python main.py "malaysia export policy 2026"        # dry-run，验证骨架
  CREWAI_LIVE=1 python main.py "..."                   # 真跑 CrewAI（需先 pip install）
"""
from __future__ import annotations
import os
import sys
from crew import run_pipeline


if __name__ == "__main__":
    topic = sys.argv[1] if len(sys.argv) > 1 else "malaysia export policy 2026"
    dry = os.environ.get("CREWAI_LIVE") != "1"
    result = run_pipeline(topic, dry_run=dry)
    print("\n=== pipeline result ===")
    print(result)
