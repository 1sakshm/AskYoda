"""Capture a video of TinyFish's live browser for one attempt.

TinyFish's `streaming_url` redirects to a DevTools inspector page whose `wss=` parameter is the
browser page's DevTools websocket. The inspector takes several seconds to load, often longer than
a short run lasts, so we read the same screencast directly: connect to the websocket, start
`Page.startScreencast` (view only: we never send input) and keep every JPEG frame with its
timestamp. `encode()` then turns the frames into an H.264 MP4 (plays in every browser) with the
original timing, still stretches cut short.
"""

import asyncio
import base64
import json
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import websockets

FRAME_SIZE = {"maxWidth": 1280, "maxHeight": 720}
MAX_SECONDS = 240
# A still screen is held at most this long in the video; the time map records the cut.
MAX_STILL_SECONDS = 2.0


def devtools_socket(streaming_url: str) -> str | None:
    """The page's DevTools websocket behind a TinyFish streaming URL, or None."""
    with httpx.Client(follow_redirects=True, timeout=20) as client:
        final = str(client.get(streaming_url).url)
    wss = parse_qs(urlparse(final).query).get("wss", [None])[0]
    return f"wss://{wss}" if wss else None


@dataclass
class Capture:
    """Frames of one attempt, captured on a background thread until `stop()`."""

    streaming_url: str
    frames_dir: Path
    frames: list[tuple[float, Path]] = field(default_factory=list)
    error: str | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def start(self) -> "Capture":
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def stop(self, wait: float = 15.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(wait)

    def _run(self) -> None:
        try:
            asyncio.run(self._capture())
        except Exception as e:  # a failed capture must never break the recording
            self.error = f"{type(e).__name__}: {e}"

    async def _capture(self) -> None:
        socket = await asyncio.to_thread(devtools_socket, self.streaming_url)
        if not socket:
            self.error = "no DevTools websocket behind the streaming URL"
            return
        async with websockets.connect(socket, max_size=None, open_timeout=20) as ws:
            await ws.send(
                json.dumps(
                    {
                        "id": 1,
                        "method": "Page.startScreencast",
                        "params": {"format": "jpeg", "quality": 75, **FRAME_SIZE},
                    }
                )
            )
            loop = asyncio.get_running_loop()
            deadline = loop.time() + MAX_SECONDS
            while not self._stop.is_set() and loop.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except TimeoutError:
                    continue
                except websockets.ConnectionClosed:
                    break
                msg = json.loads(raw)
                if msg.get("method") != "Page.screencastFrame":
                    continue
                params = msg["params"]
                await ws.send(
                    json.dumps(
                        {
                            "id": 2,
                            "method": "Page.screencastFrameAck",
                            "params": {"sessionId": params["sessionId"]},
                        }
                    )
                )
                # Local wall clock, the same clock the API stamps its events with.
                ts = time.time()
                path = self.frames_dir / f"{len(self.frames):05d}.jpg"
                path.write_bytes(base64.b64decode(params["data"]))
                self.frames.append((ts, path))


def ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    winget = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    hits = sorted(winget.glob("Gyan.FFmpeg*/*/bin/ffmpeg.exe")) if winget.is_dir() else []
    return str(hits[-1]) if hits else None


def timeline(frames: list[tuple[float, Path]]) -> list[tuple[float, float]]:
    """(wall-clock time, video time) for every frame, with still stretches capped."""
    knots: list[tuple[float, float]] = []
    video_t = 0.0
    for i, (ts, _) in enumerate(frames):
        if i:
            video_t += min(ts - frames[i - 1][0], MAX_STILL_SECONDS)
        knots.append((ts, round(video_t, 3)))
    return knots


def encode(capture: Capture, out: Path, tail_seconds: float = 1.5) -> bool:
    """Write the frames as a 1280x720 H.264 MP4 plus `<out>.json` with the time map
    {"knots": [[unix_seconds, video_seconds], ...], "duration": s}. False if nothing to do."""
    exe = ffmpeg()
    if not exe or len(capture.frames) < 2:
        return False
    frames = sorted(capture.frames)
    knots = timeline(frames)
    lines: list[str] = []
    for i, (_, path) in enumerate(frames[:-1]):
        hold = max(knots[i + 1][1] - knots[i][1], 0.02)
        lines += [f"file '{path.as_posix()}'", f"duration {hold:.3f}"]
    last = frames[-1][1].as_posix()
    lines += [f"file '{last}'", f"duration {tail_seconds:.3f}", f"file '{last}'"]
    listing = capture.frames_dir / "frames.txt"
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        exe, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,"
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0b0a08,fps=24",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(out),
    ]  # fmt: skip
    subprocess.run(cmd, check=True)
    if not (out.is_file() and out.stat().st_size > 0):
        return False
    timing = {
        "knots": [[round(ts, 3), vt] for ts, vt in knots],
        "duration": round(knots[-1][1] + tail_seconds, 3),
    }
    out.with_suffix(".json").write_text(json.dumps(timing) + "\n", encoding="utf-8")
    return True
