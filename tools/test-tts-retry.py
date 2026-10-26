"""
Test the retry path in speak_with_timing by injecting failures.

Two things need proving, and neither can be shown by a run that happens to
succeed: that a transient failure is retried rather than fatal, and that a failed
attempt leaves no partial .mp3 behind for the next stage to mux into the video.

Run: python tools/test-tts-retry.py
"""
from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location("mv", Path(__file__).parent / "make-video.py")
mv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mv)


# --- a stand-in for the edge_tts exception family -----------------------------
class EdgeTTSException(Exception):
    pass


class NoAudioReceived(EdgeTTSException):
    pass


class FakeCommunicate:
    """Fails `fail_times` times with NoAudioReceived, then succeeds."""

    calls = 0
    fail_times = 2

    def __init__(self, text, voice, rate=None, boundary=None):
        self.text = text

    async def stream(self):
        type(self).calls += 1
        if type(self).calls <= type(self).fail_times:
            # Reproduce the real message, which blames the parameters and sends
            # the operator looking in the wrong place.
            raise NoAudioReceived(
                "No audio was received. Please verify that your parameters are correct."
            )
        yield {"type": "audio", "data": b"\x00" * 64}
        yield {"type": "WordBoundary", "text": "hello", "offset": 10000000, "duration": 5000000}


class AlwaysFail(FakeCommunicate):
    async def stream(self):
        type(self).calls += 1
        raise NoAudioReceived(
            "No audio was received. Please verify that your parameters are correct."
        )
        yield  # pragma: no cover - makes this an async generator


class SilentCommunicate(FakeCommunicate):
    """Emits no audio bytes at all — the empty-file case."""

    async def stream(self):
        type(self).calls += 1
        yield {"type": "WordBoundary", "text": "hello", "offset": 0, "duration": 1}


class BrokenCommunicate(FakeCommunicate):
    """Raises a non-transport error, which must NOT be retried."""

    async def stream(self):
        type(self).calls += 1
        raise TypeError("unexpected keyword argument 'boundry'")
        yield  # pragma: no cover


def install_fake(fake):
    """
    Inject through sys.modules, not by setting an attribute on the module under
    test.

    The first version set mv.edge_tts = fake and every case "passed" with zero
    calls, because _speak_once does `import edge_tts` inside the function — a
    function-local import resolves through sys.modules and never looks at a
    module attribute. The test was calling the real service and reporting
    success. Both edge_tts and edge_tts.exceptions have to be present now.
    """
    pkg = types.ModuleType("edge_tts")
    pkg.Communicate = fake
    exc_mod = types.ModuleType("edge_tts.exceptions")
    exc_mod.EdgeTTSException = EdgeTTSException
    exc_mod.NoAudioReceived = NoAudioReceived
    pkg.exceptions = exc_mod
    sys.modules["edge_tts"] = pkg
    sys.modules["edge_tts.exceptions"] = exc_mod


def run_case(name, fake, expect_ok, expect_calls=None, attempts=4):
    install_fake(fake)
    fake.calls = 0
    fake.fail_times = 2

    with TemporaryDirectory() as d:
        out = Path(d) / "scene.mp3"
        try:
            words = asyncio.run(
                mv.speak_with_timing("a short sentence", "en-US-AndrewNeural", "+12%", out, attempts)
            )
            ok, detail = True, f"{len(words)} word(s)"
        except Exception as exc:
            ok, detail = False, type(exc).__name__
            words = []

        leftovers = [p.name for p in Path(d).iterdir() if p.name.endswith(".part")]
        written = out.exists() and out.stat().st_size > 0
        called = fake.calls > 0

        problems = []
        if ok != expect_ok:
            problems.append(f"expected {'success' if expect_ok else 'failure'}")
        if leftovers:
            problems.append(f"left {leftovers}")
        if not called:
            problems.append("FAKE NEVER USED — case is meaningless")
        if expect_calls is not None and fake.calls != expect_calls:
            problems.append(f"expected {expect_calls} call(s), got {fake.calls}")

        verdict = "PASS" if not problems else "FAIL"
        print(f"{verdict}  {name}")
        print(f"      outcome     : {'succeeded' if ok else 'raised'} - {detail}")
        print(f"      service calls: {fake.calls}")
        if expect_ok:
            print(f"      mp3 written : {written}")
        print(f"      .part left  : {leftovers or 'none'}")
        if problems:
            print(f"      problem     : {'; '.join(problems)}")
        return verdict == "PASS"


results = []
results.append(run_case("retries a transient failure, then succeeds", FakeCommunicate, True, expect_calls=3))
results.append(run_case("gives up after the attempt limit", AlwaysFail, False, expect_calls=4))
results.append(run_case("treats an empty stream as a failure", SilentCommunicate, False, expect_calls=4))
results.append(
    run_case("does NOT retry a programming error (TypeError)", BrokenCommunicate, False, expect_calls=1)
)

print()
print(f"{sum(results)}/{len(results)} cases passed")
sys.exit(0 if all(results) else 1)
