#!/usr/bin/env python
"""
Generate the two-host podcast sample.

Purpose: let the operator judge the format by ear instead of by argument. One
60-second exchange, built from facts already verified and published in article
14 (EU steel tariff-rate quota), so nothing new needs sourcing.

Why two voices rather than one: edge-tts exposes 47 English voices across
en-US, en-GB, en-AU, en-CA, en-IE and en-IN, so a second host costs nothing to
render. An earlier note in this project dismissed the two-host format on the
grounds that a second voice doubled the cost. That reasoning was wrong: with
TTS the marginal voice is free, and the cost that does exist is script writing,
which is paid once either way.

Design choice worth recording: this is a REVERSE INTERVIEW, not a chat. One host
knows the material; the other asks the questions an importer would actually ask,
and is allowed to interrupt when a number arrives without its basis. A
free-form two-host chat, where neither host adds information and laughter fills
the gap, is deliberately not what this is.

Usage:
    python tools/podcast-sample.py [--a en-US-AndrewNeural] [--b en-GB-SoniaNeural]
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

OUT_DIR = Path("build/podcast")

# Each turn: (speaker, text). Speaker "A" is the analyst, "B" the questioner.
SCRIPT: list[tuple[str, str]] = [
    (
        "B",
        "Okay, so what actually changed for Chinese steel going into Europe?",
    ),
    (
        "A",
        "On the first of July, the EU doubled its out-of-quota duty from 25 percent to 50 percent.",
    ),
    (
        "B",
        "Fifty percent of what?",
    ),
    (
        "A",
        "Of the customs value. Every tonne. And the duty-free quota is only 18.35 million tonnes, split across 26 product categories.",
    ),
    (
        "B",
        "And China gets a share of that?",
    ),
    (
        "A",
        "In four categories out of 26. In hot-rolled coil, which is about a third of the whole quota, China has no named allocation at all.",
    ),
    (
        "B",
        "So what does that come to per tonne?",
    ),
    (
        "A",
        "At a CIF value of 500 euros, the duty is 250 euros a tonne. The CBAM carbon cost on the same tonne is 163. So the carbon charge is not the binding one.",
    ),
    (
        "B",
        "That is not what most people assume.",
    ),
    (
        "A",
        "No. It is the quota that decides it, not the emissions.",
    ),
]


def synthesize(text: str, voice: str, out: Path) -> None:
    """Render one turn. edge-tts needs its own event loop per call."""
    import edge_tts

    async def run() -> None:
        communicate = edge_tts.Communicate(text, voice, rate="+8%")
        await communicate.save(str(out))

    asyncio.run(run())


def silence(seconds: float, out: Path) -> Path:
    """A short gap, so the two hosts do not run into each other."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"anullsrc=r=24000:cl=mono",
            "-t", str(seconds), "-q:a", "9", str(out),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return out


def concat(parts: list[Path], out: Path) -> None:
    """Concat demuxer needs a list file; re-encode so timestamps stay sane."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        for p in parts:
            fh.write(f"file '{p.resolve().as_posix()}'\n")
        listing = Path(fh.name)
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", str(listing), "-c:a", "libmp3lame", "-b:a", "128k",
                str(out),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    finally:
        listing.unlink(missing_ok=True)


def duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", default="en-US-AndrewNeural", help="analyst voice")
    ap.add_argument("--b", default="en-GB-SoniaNeural", help="questioner voice")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            print(f"missing {tool} on PATH", file=sys.stderr)
            return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work = OUT_DIR / "_turns"
    work.mkdir(exist_ok=True)

    print(f"analyst    : {args.a}")
    print(f"questioner : {args.b}")
    print(f"turns      : {len(SCRIPT)}")
    print()

    parts: list[Path] = []
    for i, (speaker, text) in enumerate(SCRIPT):
        voice = args.a if speaker == "A" else args.b
        turn = work / f"{i:02d}-{speaker}.mp3"
        print(f"  [{speaker}] {text[:70]}{'...' if len(text) > 70 else ''}")
        synthesize(text, voice, turn)
        parts.append(turn)
        # A beat between speakers reads as a conversation; none reads as a list.
        gap = silence(0.35, work / f"{i:02d}-gap.mp3")
        parts.append(gap)

    out = OUT_DIR / "sample-two-host.mp3"
    concat(parts, out)

    words = sum(len(t.split()) for _, t in SCRIPT)
    secs = duration(out)
    print()
    print(f"wrote      : {out}")
    print(f"duration   : {secs:.1f} s")
    print(f"script     : {words} words  ({words / (secs / 60):.0f} words/min)")
    print()
    print("Listen before deciding anything else. If the two voices sound like one")
    print("machine talking to itself, change --b first; the accent mix is the")
    print("cheapest lever. If the format itself does not hold attention, the")
    print("problem is the format and no voice will fix it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
