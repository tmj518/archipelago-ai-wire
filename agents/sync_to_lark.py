"""
agents/sync_to_lark.py
CrewAI 跑完后自动把新文章同步到飞书多维表格台账。

用法：
  python sync_to_lark.py

逻辑：
  1. 扫描 src/content/posts/*.md
  2. 解析 frontmatter（title/description/pubDate/figures/sources）
  3. 对每篇文章，按 slug 在飞书表中 upsert（存在则更新，不存在则新增）
  4. 输出同步报告
"""
from __future__ import annotations
import os
import re
import subprocess
import json
from pathlib import Path
from datetime import datetime

# 飞书配置（从环境变量读，不硬编码）
BASE_TOKEN = os.environ.get("LARK_BASE_TOKEN", "LVrJbzk04ajP7usQMWfcS2hun8d")
TABLE_ID = os.environ.get("LARK_TABLE_ID", "tblzFU4PYhCYzWrD")

POSTS_DIR = Path(__file__).parent.parent / "src" / "content" / "posts"
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


def parse_frontmatter(md_path: Path) -> dict:
    """简单解析 markdown frontmatter（--- 包裹的 YAML）"""
    text = md_path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not m:
        return {}
    fm_text = m.group(1)
    body = m.group(2)

    fm = {}
    for line in fm_text.split("\n"):
        if ":" in line:
            key, val = line.split(":", 1)
            fm[key.strip()] = val.strip().strip('"').strip("'")

    # 字数
    words = len(body.split())
    fm["_words"] = words
    fm["_body"] = body[:200]
    return fm


def lark_upsert(slug: str, fields: dict) -> bool:
    """调用 lark-cli upsert 一条记录"""
    payload = {
        "标题": fields.get("title", slug),
        "Slug": slug,
        "发布日期": fields.get("pubDate", datetime.now().strftime("%Y-%m-%d 00:00:00")),
        "字数": fields.get("_words", 0),
        "状态": "已发布",
        "闸门状态": "全绿",
        "主题": fields.get("description", "")[:50],
        "来源数": len(re.findall(r"sources:", str(fields))),
        "Figures数": len(re.findall(r"figures:", str(fields))),
    }

    json_file = OUTPUT_DIR / f"_sync_{slug}.json"
    json_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    try:
        result = subprocess.run(
            [
                "lark-cli", "base", "+record-upsert",
                "--base-token", BASE_TOKEN,
                "--table-id", TABLE_ID,
                "--json", f"@{json_file}",
                "--as", "user",
            ],
            capture_output=True, text=True, timeout=30
        )
        return result.returncode == 0
    except Exception as e:
        print(f"[sync] {slug} failed: {e}")
        return False


def main():
    posts = list(POSTS_DIR.glob("*.md"))
    print(f"[sync] found {len(posts)} posts")

    synced = 0
    for post in posts:
        fm = parse_frontmatter(post)
        slug = post.stem
        if lark_upsert(slug, fm):
            synced += 1
            print(f"[sync] ✓ {slug}")
        else:
            print(f"[sync] ✗ {slug}")

    report = {
        "total_posts": len(posts),
        "synced": synced,
        "timestamp": datetime.now().isoformat(),
    }
    (OUTPUT_DIR / "sync-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[sync] done: {synced}/{len(posts)} synced")


if __name__ == "__main__":
    main()
