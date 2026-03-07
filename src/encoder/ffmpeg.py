"""
ffmpeg.py — cross-platform ffmpeg subprocess wrapper.

Provides a sync generator interface over ffmpeg progress output, solving
Windows subprocess pitfalls C1–C4:
  C1: Pipe deadlock — avoided via background stderr drain thread
  C2: asyncio SelectorEventLoop — avoided by using sync Popen (no asyncio)
  C3: Cancel kills Python parent — avoided via CREATE_NEW_PROCESS_GROUP
  C4: VMAF path escaping — handled by escape_vmaf_path()

Public API:
  run_ffmpeg(cmd)       -> FfmpegProcess  (iterable, has .cancel())
  escape_vmaf_path(path) -> str
  FfmpegError           (Exception subclass with .returncode and .stderr)
"""

from __future__ import annotations

import queue
import re
import subprocess
import sys
import threading
import pathlib

# ---------------------------------------------------------------------------
# Progress line regex (Pattern 4 from RESEARCH.md)
# ffmpeg writes: frame=  123 fps= 45 q=28.0 size=    512kB time=00:00:05.12
#                bitrate= 820.0kbits/s speed=1.5x
# ---------------------------------------------------------------------------
_PROGRESS_RE = re.compile(
    r"frame=\s*(?P<frame>\d+)"
    r".*?fps=\s*(?P<fps>[\d.]+)"
    r".*?time=(?P<time>\d{2}:\d{2}:\d{2}\.\d+)"
    r".*?bitrate=\s*(?P<bitrate>[\d.]+|N/A)"
    r".*?speed=\s*(?P<speed>[\d.]+)x",
    re.IGNORECASE | re.DOTALL,
)

_SENTINEL = object()  # marks end of stderr drain queue


# ---------------------------------------------------------------------------
# FfmpegError
# ---------------------------------------------------------------------------

class FfmpegError(Exception):
    """Raised when ffmpeg exits with a non-zero return code."""

    def __init__(self, returncode: int, stderr: str) -> None:
        self.returncode = returncode
        self.stderr = stderr
        lines = stderr.splitlines()
        preview = "\n".join(lines[-20:]) if lines else "(empty)"
        super().__init__(
            f"ffmpeg exited with code {returncode}.\n"
            f"Stderr (last 20 lines):\n{preview}"
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_progress(line: str) -> dict:
    """Parse an ffmpeg progress stderr line into a dict.

    Returns a dict with keys: frame, fps, time_seconds, bitrate, speed,
    raw_line if the line matches the progress pattern.
    Falls back to {"raw_line": line} if it does not match.
    """
    m = _PROGRESS_RE.search(line)
    if not m:
        return {"raw_line": line}
    h, mn, s = m.group("time").split(":")
    time_seconds = int(h) * 3600 + int(mn) * 60 + float(s)
    bitrate_str = m.group("bitrate")
    bitrate = float(bitrate_str) if bitrate_str.upper() != "N/A" else 0.0
    return {
        "frame": int(m.group("frame")),
        "fps": float(m.group("fps")),
        "time_seconds": time_seconds,
        "bitrate": bitrate,
        "speed": float(m.group("speed")),
        "raw_line": line,
    }


def _make_drain_thread(
    proc: subprocess.Popen,
    stderr_lines: list,
    line_queue: queue.Queue,
) -> threading.Thread:
    """Create (but do not start) a background thread that drains proc.stderr.

    Uses chunk-read + \\r-split to handle ffmpeg's carriage-return progress
    updates. Never blocks the main thread.
    """

    def _drain() -> None:
        buf = b""
        while True:
            chunk = proc.stderr.read(512)
            if not chunk:
                break
            buf += chunk
            # ffmpeg uses \\r to overwrite progress lines in a terminal.
            # When piped, each \\r-delimited segment is one "line".
            parts = buf.split(b"\r")
            buf = parts[-1]  # keep incomplete trailing segment
            for part in parts[:-1]:
                line = part.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                stderr_lines.append(line)
                if "frame=" in line:
                    line_queue.put(line)
        # Flush the remaining buffer (may be a \\n-terminated final line)
        if buf.strip():
            line = buf.decode("utf-8", errors="replace").strip()
            stderr_lines.append(line)
        # Sentinel signals the generator that stderr is exhausted
        line_queue.put(_SENTINEL)

    return threading.Thread(target=_drain, daemon=True)


# ---------------------------------------------------------------------------
# FfmpegProcess — iterable wrapper around a single ffmpeg invocation
# ---------------------------------------------------------------------------

class FfmpegProcess:
    """Iterable ffmpeg process wrapper.

    Usage::

        gen = run_ffmpeg(cmd)
        for event in gen:
            print(event["frame"])

    Or with cancellation::

        gen = run_ffmpeg(cmd)
        first = next(gen)
        gen.cancel()
        for _ in gen:   # drain remaining events after cancel
            pass        # no FfmpegError raised on graceful cancel

    After full iteration, `gen.stderr_lines` contains all captured stderr.
    """

    def __init__(self, cmd: list) -> None:
        self._cmd = cmd
        self._proc: subprocess.Popen | None = None
        self._cancelled: bool = False
        self.stderr_lines: list[str] = []
        self._line_queue: queue.Queue = queue.Queue()
        self._drain_thread: threading.Thread | None = None
        self._started: bool = False

    # ------------------------------------------------------------------
    # Iterator protocol
    # ------------------------------------------------------------------

    def __iter__(self) -> FfmpegProcess:
        if not self._started:
            self._start()
        return self

    def __next__(self) -> dict:
        if not self._started:
            self._start()
        item = self._line_queue.get()
        if item is _SENTINEL:
            # Drain thread finished — wait for process exit
            if self._drain_thread is not None:
                self._drain_thread.join()
            if self._proc is not None:
                self._proc.wait()
            rc = self._proc.returncode if self._proc is not None else 0
            if rc != 0 and not self._cancelled:
                raise FfmpegError(
                    returncode=rc,
                    stderr="\n".join(self.stderr_lines),
                )
            raise StopIteration
        return _parse_progress(item)

    # ------------------------------------------------------------------
    # Internal startup
    # ------------------------------------------------------------------

    def _start(self) -> None:
        """Launch the ffmpeg subprocess and start the stderr drain thread."""
        self._started = True
        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP

        self._proc = subprocess.Popen(
            self._cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=creation_flags,
        )
        self._drain_thread = _make_drain_thread(
            self._proc, self.stderr_lines, self._line_queue
        )
        self._drain_thread.start()

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------

    def cancel(self) -> None:
        """Gracefully stop the ffmpeg process.

        Writes b"q\\n" to ffmpeg stdin (ffmpeg's built-in quit signal),
        waits up to 3 seconds for the process to exit, then falls back
        to terminate() and kill().

        Does NOT raise FfmpegError — cancellation is not an error.
        """
        if self._proc is None:
            # Not started yet — nothing to cancel
            return

        self._cancelled = True

        # Send ffmpeg's built-in quit command via stdin
        try:
            self._proc.stdin.write(b"q\n")
            self._proc.stdin.flush()
            self._proc.stdin.close()
        except OSError:
            pass  # stdin may already be closed or process may have exited

        # Wait for graceful exit
        try:
            self._proc.wait(timeout=3.0)
        except subprocess.TimeoutExpired:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self._proc.kill()


# ---------------------------------------------------------------------------
# Public factory function
# ---------------------------------------------------------------------------

def run_ffmpeg(cmd: list[str]) -> FfmpegProcess:
    """Run an ffmpeg command and return an iterable FfmpegProcess.

    The returned object is a sync iterator yielding progress dicts for each
    ``frame=`` line emitted by ffmpeg on stderr.

    Progress dict keys:
        frame (int), fps (float), time_seconds (float),
        bitrate (float), speed (float), raw_line (str)

    On non-zero exit, raises FfmpegError with .returncode and .stderr.
    Call .cancel() to abort gracefully without raising FfmpegError.

    Args:
        cmd: Full command list, e.g.
             ["C:/ffmpeg/ffmpeg.exe", "-i", "input.mkv", "-c:v", "libx264",
              "-f", "null", "NUL"]

    Returns:
        FfmpegProcess — iterable with .cancel() method.

    Raises:
        FfmpegError: If ffmpeg exits with non-zero returncode (and not
                     cancelled via .cancel()).
    """
    return FfmpegProcess(cmd)


# ---------------------------------------------------------------------------
# VMAF path escaping
# ---------------------------------------------------------------------------

def escape_vmaf_path(path: str | pathlib.Path) -> str:
    """Return a filter-string-safe VMAF model path.

    Converts backslashes to forward slashes, then on Windows escapes the
    drive-letter colon so ffmpeg's filter parser does not treat it as an
    option separator.

    Examples::

        # Windows
        escape_vmaf_path("C:/path/vmaf.json")   -> "C\\\\:/path/vmaf.json"
        escape_vmaf_path("C:\\\\path\\\\vmaf.json") -> "C\\\\:/path/vmaf.json"

        # Linux/Mac
        escape_vmaf_path("/mnt/data/vmaf.json") -> "/mnt/data/vmaf.json"

    Args:
        path: File path as str or pathlib.Path.

    Returns:
        Escaped path string safe for use in ffmpeg filter strings.
    """
    p = str(path).replace("\\", "/")
    if sys.platform == "win32" and len(p) >= 2 and p[1] == ":":
        # Escape drive-letter colon: "C:" -> "C\\:"
        p = p[0] + "\\:" + p[2:]
    return p
