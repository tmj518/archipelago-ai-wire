#!/usr/bin/env python3
"""
Turn an article into an English short video.

Pipeline, and why each part is free of credentials:

  1. Read the article and take the narration from its own text (AI Summary,
     the hook, the data point). Nothing is invented — the script is the
     article, shortened, so the video cannot drift from the published claims.
  2. Narration via edge-tts. Microsoft's neural voices, no API key.
  3. Slides via Pillow at 1920x1080. Text only, so there is no stock imagery
     and no licence question.
  4. Assemble with ffmpeg: the slides of a scene share that scene's audio.

The invariant that matters:

    the slides of a scene are a PARTITION of what that scene says

An earlier version truncated the slide text and the narration separately
(`sentences(point, 300)` for the slide, `sentences(point, 400)` for the
voice), so on one scene the viewer heard 346 characters and saw 132 — 38%
coverage. Slides are now paginated from the spoken text itself, which makes
visual coverage 100% by construction rather than by tuning two numbers.

Output: build/video/<slug>.mp4 plus per-scene audio and slides, which are
cheap to re-render when a figure changes.

Usage:
    python tools/make-video.py <slug> [--voice en-US-AndrewNeural] [--dry-run]
    python tools/make-video.py <slug> --coverage      # report slide/voice parity
"""

from __future__ import annotations

import argparse
import asyncio
import random
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG = ROOT / "src" / "content" / "blog"
OUT = ROOT / "build" / "video"

W, H = 1920, 1080
BG = (255, 255, 255)
INK = (26, 26, 26)
MUTED = (110, 110, 110)
NAVY = (16, 42, 67)
RED = (200, 40, 40)

# How much text one slide holds at the body font size. Chosen so a full slide
# still breathes; raise it and slides start to look like documents.
SLIDE_CHARS = 210
MAX_SECONDS_PER_SCENE = 45

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]


def load_font(size: int):
    from PIL import ImageFont

    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def parse_frontmatter(text: str) -> dict:
    """Minimal YAML reader for the handful of scalar fields we need."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    fm: dict[str, str] = {}
    for line in m.group(1).splitlines():
        km = re.match(r'^([a-z_]+):\s*"?(.*?)"?\s*$', line)
        if km:
            fm[km.group(1)] = km.group(2)
    return fm


def body_of(text: str) -> str:
    return re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)


def strip_md(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    s = re.sub(r"[*_`>#]", "", s)
    s = re.sub(r"^\s*\|.*$", " ", s, flags=re.M)
    s = re.sub(r"^\s*[-•]\s*", "", s, flags=re.M)
    return re.sub(r"\s+", " ", s).strip()


def section(body: str, heading: str) -> str:
    m = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)", body, re.S | re.M)
    return strip_md(m.group(1)) if m else ""


def clamp_sentences(text: str, limit: int) -> str:
    """Whole sentences up to a character budget, so the voice never cuts mid-thought."""
    parts = re.split(r"(?<=[.!?])\s+", text)
    out, total = [], 0
    for p in parts:
        if total + len(p) > limit and out:
            break
        out.append(p)
        total += len(p)
    return " ".join(out)


def paginate(text: str, max_chars: int = SLIDE_CHARS) -> list[str]:
    """
    Split text into slide-sized chunks on sentence boundaries.

    Words are never broken, and a single over-long sentence becomes its own
    chunk rather than being dropped — dropping is what created the coverage
    gap this replaced.
    """
    pieces = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    cur = ""
    for p in pieces:
        if not p:
            continue
        if cur and len(cur) + len(p) + 1 > max_chars:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        chunks.append(cur)
    return chunks or [text.strip()]


def read_fm(slug: str) -> dict:
    path = BLOG / f"{slug}.md"
    if not path.exists():
        sys.exit(f"article not found: {path}")
    return parse_frontmatter(path.read_text(encoding="utf-8"))


def fm_title(scenes: list[dict]) -> str:
    """The article title, which the first scene already carries."""
    return scenes[0]["heading"] if scenes else ""


def build_scenes(slug: str) -> list[dict]:
    path = BLOG / f"{slug}.md"
    if not path.exists():
        sys.exit(f"article not found: {path}")

    raw = path.read_text(encoding="utf-8")
    fm = parse_frontmatter(raw)
    body = body_of(raw)

    title = fm.get("title", slug)
    site = "Landed Math"

    def scene(kind: str, heading: str, speak: str, slides: list[str] | None = None) -> dict:
        speak = speak.strip()
        return {
            "kind": kind,
            "heading": heading,
            "speak": speak,
            "slides": slides if slides is not None else paginate(speak, SLIDE_CHARS),
        }

    scenes: list[dict] = [scene("title", title, title, [title])]

    summary = section(body, "AI Summary")
    if summary:
        scenes.append(scene("body", "The short version", clamp_sentences(summary, 330)))

    happened = section(body, "What happened")
    if happened:
        scenes.append(scene("body", "What happened", clamp_sentences(happened, 400)))

    # The markdown table from "So what". The table is the slide; the narration
    # reads the same rows, so the numbers are both heard and seen.
    so_what = re.search(r"^##\s+So what\s*$(.*?)(?=^##\s|\Z)", body, re.S | re.M)
    if so_what:
        rows = [r for r in so_what.group(1).splitlines() if r.strip().startswith("|")]
        rows = [r for r in rows if not re.match(r"^\|[\s\-:|]+\|$", r.strip())][:5]
        if len(rows) >= 2:
            table = []
            for r in rows:
                cells = []
                for c in r.strip().strip("|").split("|"):
                    c = c.strip()
                    emph = c.startswith("**") and c.endswith("**")
                    cells.append({"text": strip_md(c), "emph": emph})
                table.append(cells)
            spoken = "Here are the numbers. " + ". ".join(
                ", ".join(c["text"] for c in cells) for cells in table[1:]
            )
            scenes.append({"kind": "table", "heading": "The numbers",
                           "table": table, "speak": spoken, "slides": []})

    point = section(body, "The point")
    if point:
        scenes.append(scene("body", "The point", clamp_sentences(point, 420)))

    scenes.append(
        scene(
            "outro",
            site,
            f"That was {title}, from {site}. "
            "Full article with every source at landedmath dot com.",
            # The end card carries the title, because the narration names it.
            # Leaving the title off the card is what kept this scene at 47%
            # coverage: the viewer heard a title they never saw.
            [f"{title}\nlandedmath.com\nIndependent analysis of China cross-border trade"],
        )
    )
    return scenes


def wrap(draw, text: str, font, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_slide(scene: dict, chunk: str, index: int, total: int, sub: str, out_path: Path) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    pad = 130

    d.rectangle([pad, pad - 34, pad + 96, pad - 26], fill=RED)

    if scene["kind"] == "title":
        f_kick, f_head = load_font(38), load_font(92)
        d.text((pad, pad - 100), "LANDED MATH", font=f_kick, fill=MUTED)
        y = 330
        for ln in wrap(d, chunk, f_head, W - 2 * pad)[:5]:
            d.text((pad, y), ln, font=f_head, fill=NAVY)
            y += 112
    elif scene["kind"] == "table":
        f_head, f_cell = load_font(56), load_font(40)
        d.text((pad, 200), scene["heading"], font=f_head, fill=NAVY)
        table = scene["table"]
        cols = len(table[0])
        col_w = (W - 2 * pad) // cols
        y = 360
        for ri, row in enumerate(table):
            if ri == 0:
                d.rectangle([pad - 10, y - 12, W - pad + 10, y + 56], fill=(242, 244, 247))
            for ci, cell in enumerate(row[:cols]):
                txt = " ".join(wrap(d, cell["text"], f_cell, col_w - 30)[:2])
                fill = NAVY if ri == 0 else (RED if cell["emph"] else INK)
                d.text((pad + ci * col_w, y), txt, font=f_cell, fill=fill)
            y += 84 if y < 800 else 0
    elif scene["kind"] == "outro":
        f_kick, f_head, f_sub = load_font(38), load_font(56), load_font(36)
        lines = chunk.split("\n")
        d.text((pad, pad - 100), "LANDED MATH", font=f_kick, fill=MUTED)
        # The title wraps; an unwrapped 80pt title runs off a 1920px canvas.
        y = 330
        for ln in wrap(d, lines[0], f_head, W - 2 * pad):
            if y > 700:
                break
            d.text((pad, y), ln, font=f_head, fill=NAVY)
            y += 74
        y += 30
        if len(lines) > 1:
            d.text((pad, y), lines[1], font=f_head, fill=RED)
            y += 74
        if len(lines) > 2:
            d.text((pad, y), lines[2], font=f_sub, fill=MUTED)
    else:
        f_head, f_body = load_font(52), load_font(42)
        d.text((pad, 200), scene["heading"], font=f_head, fill=NAVY)
        y = 330
        for ln in wrap(d, chunk, f_body, W - 2 * pad):
            if y > 900:
                break
            d.text((pad, y), ln, font=f_body, fill=INK)
            y += 62

    f_foot = load_font(26)
    d.text((pad, H - 110), "landedmath.com", font=f_foot, fill=MUTED)
    counter = f"{index}/{total}" + (f"  {sub}" if sub else "")
    d.text((W - pad - d.textlength(counter, font=f_foot), H - 110), counter,
           font=f_foot, fill=MUTED)

    img.save(out_path, "PNG")


class EmptyAudioStream(Exception):
    """
    The stream completed without producing any audio bytes.

    Raised as a distinct type so the retry wrapper can treat it as retryable. An
    empty stream is a service hiccup — the connection is made and then closes
    without data — not a mistake in the caller's arguments, and not a valid
    result. Left as a plain RuntimeError it would not be retried, and a zero-byte
    .mp3 would reach ffmpeg on the next stage.

    A test caught this: the retry list was originally the edge-tts exception
    family plus OSError, and the empty-stream case fell outside it and failed
    after a single attempt.
    """


async def _speak_once(
    text: str, voice: str, rate: str, audio_path: Path
) -> list[dict]:
    """One synthesis attempt, writing to `audio_path` only if it completes."""
    import edge_tts

    communicate = edge_tts.Communicate(
        text, voice, rate=rate, boundary="WordBoundary"
    )
    words: list[dict] = []
    # Write to a temporary file and rename on success. Writing straight to the
    # destination meant a failed attempt left a truncated .mp3 behind, which the
    # next stage would happily mux into the video.
    tmp = audio_path.with_suffix(audio_path.suffix + ".part")
    try:
        with open(tmp, "wb") as fh:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    fh.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    words.append(
                        {
                            "text": chunk["text"],
                            "start": chunk["offset"] / 10_000_000,
                            "dur": chunk["duration"] / 10_000_000,
                        }
                    )
        if tmp.stat().st_size == 0:
            raise EmptyAudioStream("stream produced no audio bytes")
        tmp.replace(audio_path)
    finally:
        tmp.unlink(missing_ok=True)
    return words


async def speak_with_timing(
    text: str, voice: str, rate: str, audio_path: Path, attempts: int = 4
) -> list[dict]:
    """
    Synthesise the narration and return word-level timings.

    edge-tts emits boundary events alongside the audio with `offset` and
    `duration` in 100-nanosecond ticks, which gives synced captions without a
    forced-alignment pass. The catch is the default: `boundary` defaults to
    SentenceBoundary, so a first attempt that did not pass it explicitly got
    one event per sentence and produced zero captions. WordBoundary has to be
    asked for.

    Retries on failure, because the failure is usually transient. Calling this
    several times in quick succession — which is exactly what happens when six
    scenes are synthesised back to back, and again when several articles are
    rendered in one sitting — intermittently raises NoAudioReceived. That
    exception says "Please verify that your parameters are correct", which sends
    you looking at the voice name and the rate when the real cause is that the
    service declined to answer. Rendering all fourteen articles in one run
    produced two such failures out of fourteen, and both succeeded on a retry
    seconds later.

    So: back off and retry, and report what actually happened if all attempts
    fail. The backoff is jittered because the trigger is a rate limit, and
    identical delays would re-collide.

    Only transport failures are retried. The first version caught bare Exception,
    and a test that injected a broken stand-in raised TypeError — which was then
    retried three times with backoff. A TypeError means the code is wrong, not
    the network; retrying it just delays the error and hides the bug. So the
    catch list is the edge-tts exception family plus OSError, and anything else
    propagates on the first attempt.
    """
    import edge_tts.exceptions as tts_errors

    retryable = (
        tts_errors.EdgeTTSException,
        EmptyAudioStream,
        OSError,
        asyncio.TimeoutError,
    )

    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await _speak_once(text, voice, rate, audio_path)
        except retryable as exc:
            last = exc
            if attempt == attempts:
                break
            delay = (2 ** (attempt - 1)) * 1.5 + random.uniform(0, 1.0)
            label = text[:60].replace("\n", " ")
            print(
                f"      tts attempt {attempt}/{attempts} failed "
                f"({type(exc).__name__}); retrying in {delay:.1f}s — \"{label}...\""
            )
            await asyncio.sleep(delay)

    raise RuntimeError(
        f"TTS failed after {attempts} attempts on \"{text[:60]}...\". "
        f"Last error: {type(last).__name__}: {last}. "
        "This is usually the service rate-limiting rather than a bad voice or "
        "rate parameter — wait a minute and re-run before changing any argument."
    ) from last



def interpolate_words(text: str, duration: float) -> list[dict]:
    """
    Fallback when the service returns no word boundaries.

    Spreads the measured audio duration across the words in proportion to
    their length. The interval is real and the ordering is real; only the
    positions inside it are estimated, and caption timing tolerance is well
    inside the error that introduces.
    """
    words = text.split()
    if not words or duration <= 0:
        return []
    weights = [max(1, len(w)) for w in words]
    total = sum(weights)
    out, cursor = [], 0.0
    for w, weight in zip(words, weights):
        span = duration * weight / total
        out.append({"text": w, "start": cursor, "dur": span})
        cursor += span
    return out


def group_words(words: list[dict], max_chars: int = 46, max_gap: float = 0.7) -> list[dict]:
    """
    Group word timings into caption phrases.

    Three constraints. A caption past ~46 characters is hard to read at speed.
    A caption spanning a long pause should have been two captions. And a
    sentence end always breaks, because without that the first draft rendered
    "... including above EUR 150 Both" — the start of the next sentence bolted
    onto the end of the previous one.
    """
    out: list[dict] = []
    cur: list[dict] = []
    for w in words:
        if cur:
            too_long = len(" ".join(x["text"] for x in cur)) + len(w["text"]) + 1 > max_chars
            gap = w["start"] - (cur[-1]["start"] + cur[-1]["dur"])
            ended = cur[-1]["text"].rstrip().endswith((".", "!", "?", ":", ";"))
            if too_long or gap > max_gap or ended:
                out.append(cur)
                cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return [
        {
            "text": " ".join(x["text"] for x in g),
            "start": g[0]["start"],
            "end": g[-1]["start"] + g[-1]["dur"],
        }
        for g in out
    ]


ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Segoe UI Semibold,46,&H00FFFFFF,&H000000FF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,120,120,72,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def write_ass(captions: list[dict], path: Path) -> None:
    """
    Write an ASS subtitle file.

    Escape braces because ASS treats {...} as an override block, and turn
    newlines into the explicit \\N break ASS expects.
    """
    lines = [ASS_HEADER]
    for c in captions:
        text = (
            c["text"]
            .replace("\\", "")
            .replace("{", "(")
            .replace("}", ")")
            .replace("\n", "\\N")
        )
        lines.append(
            f"Dialogue: 0,{ass_time(c['start'])},{ass_time(c['end'])},Caption,,0,0,0,,"
            f"{{\\fad(180,180)}}{text}\n"
        )
    path.write_text("".join(lines), encoding="utf-8")


def srt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms == 1000:
        s, ms = s + 1, 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(captions: list[dict], path: Path) -> None:
    """
    An SRT track for upload to YouTube.

    Preferred over burning in for this channel. YouTube indexes the track, it
    is toggleable, and — the reason that decided it — the slides already carry
    text, so burned-in captions put two different sentences on screen at once.
    """
    blocks = []
    for i, c in enumerate(captions, 1):
        blocks.append(
            f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text'].strip()}\n"
        )
    path.write_text("\n".join(blocks), encoding="utf-8")


def audio_seconds(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 6.0
    r = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 6.0


def make_thumbnail(title: str, callout: str, path: Path) -> None:
    """
    YouTube thumbnail at 1280x720.

    The SOP this borrows from specifies 1080x1440, which is the 3:4 cover ratio
    for Douyin and WeChat Channels. YouTube's is 16:9, so the size is adapted
    rather than copied — a 3:4 upload gets letterboxed or cropped.

    High contrast and few words on purpose: a thumbnail is read at about 210px
    wide in a search result, where anything past a few words is illegible.
    """
    from PIL import Image, ImageDraw

    tw, th = 1280, 720
    img = Image.new("RGB", (tw, th), NAVY)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, tw, 14], fill=RED)
    pad = 72
    d.text((pad, pad), "LANDED MATH", font=load_font(30), fill=(150, 170, 190))

    f_title = load_font(64)
    y = 190
    for ln in wrap(d, title, f_title, tw - 2 * pad)[:4]:
        d.text((pad, y), ln, font=f_title, fill=(255, 255, 255))
        y += 82

    if callout:
        f_call = load_font(46)
        y = max(y + 24, 560)
        d.rectangle([pad - 16, y - 18, tw - pad + 16, y + 70], fill=RED)
        d.text((pad, y), " ".join(wrap(d, callout, f_call, tw - 2 * pad)[:1]),
               font=f_call, fill=(255, 255, 255))

    img.save(path, "PNG")


def write_metadata(slug: str, fm: dict, scenes: list[dict], duration: float, path: Path) -> None:
    """
    The rest of the delivery, so the upload step is copy-paste.

    Titles are kept under YouTube's 100-character limit and the description
    leads with the article URL, because the first two lines are what a viewer
    sees before expanding.
    """
    title = fm.get("title", slug)
    desc = fm.get("description", "")
    keyword = fm.get("target_keyword", "")
    tags = [t.strip().strip('"') for t in re.findall(r'"([^"]+)"', fm.get("tags", ""))]

    mins, secs = divmod(int(duration), 60)
    body = [
        f"# {title}",
        "",
        f"Full analysis with every source: https://landedmath.com/blog/{slug}/",
        "",
        desc,
        "",
        "Every figure in this video is a published official number, and the",
        "arithmetic is in the article. Corrections go on the article page.",
        "",
        f"Runtime: {mins}:{secs:02d}",
    ]
    if keyword:
        body += ["", f"Target query: {keyword}"]
    if tags:
        body += ["", "Tags: " + ", ".join(tags)]
    body += ["", "---", "Sources are named in the article's frontmatter; no URLs appear in the body."]
    path.write_text("\n".join(body) + "\n", encoding="utf-8")


def report_coverage(scenes: list[dict]) -> float:
    """Slide text as a share of spoken text. 100% is the design target."""
    tot_shown = tot_spoken = 0
    print(f'{"seg":<4}{"kind":<8}{"slides":>7}{"shown":>8}{"spoken":>8}{"cover":>8}')
    print("-" * 43)
    for i, s in enumerate(scenes, 1):
        if s["kind"] == "table":
            shown = sum(len(c["text"]) for row in s["table"] for c in row)
            n = 1
        else:
            shown = sum(len(x) for x in s["slides"])
            n = len(s["slides"])
        spoken = len(s["speak"])
        tot_shown += shown
        tot_spoken += spoken
        cover = shown / spoken * 100 if spoken else 100
        print(f'{i:<4}{s["kind"]:<8}{n:>7}{shown:>8}{spoken:>8}{cover:>7.0f}%')
    print("-" * 43)
    pct = tot_shown / tot_spoken * 100 if tot_spoken else 100
    print(f'{"":<12}{"":>7}{tot_shown:>8}{tot_spoken:>8}{pct:>7.0f}%')
    return pct


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "slugs",
        nargs="*",
        help="one or more article slugs, or use --all for every published article",
    )
    ap.add_argument("--voice", default="en-US-AndrewNeural")
    # +12% suits information-dense B2B narration: noticeably quicker without
    # turning into the +20% that a short-form news recap uses.
    ap.add_argument("--rate", default="+12%", help="edge-tts rate, e.g. +12%%")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--coverage", action="store_true", help="report parity and exit")
    ap.add_argument(
        "--all",
        action="store_true",
        help="render every published article (drafts are skipped)",
    )
    ap.add_argument(
        "--skip-done",
        action="store_true",
        help="with --all, skip slugs that already have a rendered mp4",
    )
    ap.add_argument(
        "--burn-captions",
        action="store_true",
        help="burn captions into the picture (for platforms with no track upload)",
    )
    args = ap.parse_args()

    slugs = list(args.slugs)
    if not slugs and not args.all:
        ap.error("give one or more slugs, or --all")
    if args.all:
        slugs = sorted(p.stem for p in BLOG.glob("*.md"))
        # A draft is not published, so there is nothing to publish a video for.
        slugs = [
            s for s in slugs
            if not re.search(r"^draft:\s*true", (BLOG / f"{s}.md").read_text(encoding="utf-8"), re.M)
        ]
        if args.skip_done:
            slugs = [s for s in slugs if not (OUT / f"{s}.mp4").exists()]
        print(f"batch: {len(slugs)} article(s)")

    failures: list[tuple[str, str]] = []
    for n, slug in enumerate(slugs, 1):
        if len(slugs) > 1:
            print(f"\n{'=' * 72}\n[{n}/{len(slugs)}] {slug}\n{'=' * 72}")
        try:
            render_one(slug, args)
        except Exception as exc:  # noqa: BLE001 - one bad article must not stop the batch
            failures.append((slug, f"{type(exc).__name__}: {exc}"))
            print(f"  FAILED: {type(exc).__name__}: {exc}")
        # A batch is exactly the pattern that trips the service rate limit, so
        # leave a gap between articles rather than between scenes only.
        if len(slugs) > 1 and n < len(slugs):
            time.sleep(5)

    if failures:
        print(f"\n{len(failures)} of {len(slugs)} failed:")
        for slug, err in failures:
            print(f"  {slug}: {err}")
        sys.exit(1)
    if len(slugs) > 1:
        print(f"\nall {len(slugs)} rendered")


def render_one(slug: str, args) -> None:
    """Render a single article's video, subtitles, thumbnail and metadata."""
    scenes = build_scenes(slug)

    if args.coverage:
        pct = report_coverage(scenes)
        print(f"\ncoverage {pct:.0f}%")
        return

    work = OUT / slug
    work.mkdir(parents=True, exist_ok=True)

    print(f"scenes: {len(scenes)}")
    total_slides = sum(max(1, len(s["slides"])) for s in scenes)
    print(f"slides: {total_slides}")
    report_coverage(scenes)

    # Render every slide up front so a failure happens before any ffmpeg work.
    # Narration is synthesised with word timings, which become the subtitles.
    captions: list[dict] = []
    cursor = 0.0
    for i, sc in enumerate(scenes, 1):
        if sc["kind"] == "table":
            render_slide(sc, "", i, len(scenes), "", work / f"{i:02d}-a.png")
        else:
            for j, chunk in enumerate(sc["slides"]):
                sub = f"{j + 1}/{len(sc['slides'])}" if len(sc["slides"]) > 1 else ""
                render_slide(sc, chunk, i, len(scenes), sub,
                             work / f"{i:02d}-{chr(97 + j)}.png")
        mp3 = work / f"{i:02d}.mp3"
        words = asyncio.run(
            speak_with_timing(sc["speak"], args.voice, args.rate, mp3)
        )
        if not words:
            # The service occasionally returns audio with no boundary events.
            words = interpolate_words(sc["speak"], audio_seconds(mp3))
            print(f"  scene {i}: no boundaries from the service, interpolated")
        for cap in group_words(words):
            captions.append(
                {"text": cap["text"], "start": cap["start"] + cursor, "end": cap["end"] + cursor}
            )
        cursor += audio_seconds(mp3) + 0.6
        print(f"  scene {i} [{sc['kind']}] rendered, {len(words)} words timed")

    ass_path = work / "captions.ass"
    write_ass(captions, ass_path)
    srt_path = OUT / f"{slug}.srt"
    write_srt(captions, srt_path)
    print(f"  captions: {len(captions)} cues -> {srt_path.name}"
          + (" (burned in)" if args.burn_captions else " (upload as a track)"))

    if args.dry_run:
        print("dry run: skipping ffmpeg")
        return
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not on PATH — install it or use --dry-run")

    parts = []
    for i, sc in enumerate(scenes, 1):
        mp3 = work / f"{i:02d}.mp3"
        dur = audio_seconds(mp3) + 0.6
        if sc["kind"] == "table":
            slides = [work / f"{i:02d}-a.png"]
        else:
            slides = [work / f"{i:02d}-{chr(97 + j)}.png" for j in range(len(sc["slides"]))]

        per = dur / len(slides)
        listing = work / f"{i:02d}-slides.txt"
        lines = []
        for p in slides:
            lines.append(f"file '{p.name}'")
            lines.append(f"duration {per:.3f}")
        # The concat demuxer ignores the final duration unless the last frame
        # is repeated, which would otherwise clip the last slide.
        lines.append(f"file '{slides[-1].name}'")
        listing.write_text("\n".join(lines) + "\n", encoding="utf-8")

        seg = work / f"{i:02d}.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "concat", "-safe", "0", "-i", str(listing),
             "-i", str(mp3),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
             "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30",
             "-c:a", "aac", "-b:a", "192k", "-shortest",
             str(seg)],
            check=True, cwd=work,
        )
        parts.append(seg)

    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    raw = work / "raw.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(listing), "-c", "copy", str(raw)],
        check=True,
    )

    # Second pass: normalise loudness, and optionally burn the captions.
    #
    # -16 LUFS with a -1.5 dBTP ceiling keeps the narration level with the rest
    # of the platform. Loudness normalisation is not optional; the burn-in is,
    # because the slides already carry text and YouTube takes an SRT track.
    final = OUT / f"{slug}.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw)]
    if args.burn_captions:
        cmd += ["-vf", "ass=captions.ass"]
    cmd += [
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        str(final),
    ]
    subprocess.run(cmd, check=True, cwd=work)

    # The delivery set: video, thumbnail, and the text an upload form asks for.
    thumb = OUT / f"{slug}-thumb.png"
    callout = ""
    for sc in scenes:
        if sc["kind"] == "table" and len(sc["table"]) > 1:
            row = sc["table"][1]
            callout = "  ".join(c["text"] for c in row[-2:])
            break
    make_thumbnail(fm_title(scenes), callout, thumb)
    meta = OUT / f"{slug}-youtube.txt"
    write_metadata(slug, parse_frontmatter((BLOG / f"{slug}.md").read_text(encoding="utf-8")),
                   scenes, cursor, meta)

    print(f"\nvideo     : {final}")
    print(f"thumbnail : {thumb}")
    print(f"metadata  : {meta}")
    print("Upload it, then set youtube_id in the article frontmatter.")


if __name__ == "__main__":
    main()
