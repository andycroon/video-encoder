# Phase 1: Subprocess Foundation - Research

**Researched:** 2026-03-07
**Domain:** Python subprocess / ffmpeg cross-platform execution (Windows + Linux)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Progress interface:**
- Sync generator — wrapper yields progress dicts, caller iterates with `for event in run_ffmpeg(...)`
- Each event is a parsed dict: `{frame, fps, time_seconds, bitrate, speed, raw_line}`
- After iteration completes, caller can also access captured full stderr (for VMAF score parsing in Phase 3, error detail, logging)
- Progress events are only `frame=` lines; other stderr lines are captured silently and returned at end

**Package structure:**
- `src/encoder/` package with standard src-layout
- Phase 1 module: `src/encoder/ffmpeg.py` (named after what it wraps, not the mechanism)
- Public API example: `from encoder.ffmpeg import run_ffmpeg, escape_vmaf_path`
- Tests at root: `tests/test_ffmpeg.py`
- Future modules slot in: `src/encoder/db.py`, `src/encoder/pipeline.py`, `src/encoder/api.py`

**Test strategy:**
- Integration tests with real ffmpeg (no mocking)
- Test input: ffmpeg lavfi synthetic sources (`-f lavfi -i testsrc`) — no binary assets in repo
- Short duration (3 seconds) to keep tests fast
- Cancellation test: start a 60-second lavfi encode, cancel after 1 second, assert process exits cleanly and Python continues
- Tests verify cross-platform behavior — must pass on both Windows and Linux

### Claude's Discretion

- Exact error exception class name and fields
- pyproject.toml / requirements.txt structure and pinned versions
- ThreadPoolExecutor pool size and lifecycle
- Exact progress regex pattern
- How stderr buffering is handled to avoid deadlock (never use communicate())

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-10 | System runs cross-platform (Windows and Linux) with no OS-specific dependencies | Windows subprocess constraints (CREATE_NEW_PROCESS_GROUP, ThreadPoolExecutor), VMAF path escaping, cancellation pattern — all documented below |
</phase_requirements>

---

## Summary

Phase 1 establishes the Python subprocess foundation for running ffmpeg on both Windows and Linux. The core challenge is that Windows has deep restrictions on how subprocesses interact with pipe I/O and how processes can be gracefully terminated. These cannot be worked around at higher levels — they must be solved here before any pipeline logic depends on them.

The project memory documents five Windows-specific pitfalls (C1–C5). This phase resolves C1–C4 directly. The architecture decision to use a sync generator (not async) sidesteps the asyncio SelectorEventLoop/ProactorEventLoop problem entirely — no event loop is involved. The wrapper uses `subprocess.Popen` directly with threading for concurrent stderr drain, avoiding deadlock without `communicate()`.

The VMAF path escaping issue is a separate concern: ffmpeg's libvmaf filter requires drive-letter colons to be triple-escaped (`C\\:/path`) in filter strings on Windows. A utility function must produce this deterministically.

**Primary recommendation:** Use `subprocess.Popen` + `threading.Thread` for stderr drain + `CREATE_NEW_PROCESS_GROUP` on Windows. The sync generator design is correct and avoids all asyncio platform complications.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `subprocess` (stdlib) | Python 3.9+ | Launch and manage ffmpeg processes | Built-in, no dependency, full platform support |
| `threading` (stdlib) | Python 3.9+ | Drain stderr in background thread to prevent pipe deadlock | Built-in, proven pattern for concurrent pipe drain |
| `re` (stdlib) | Python 3.9+ | Parse ffmpeg progress lines from stderr | Built-in, sufficient for the regex needed |
| `pytest` | >=8.0,<9 | Test runner for integration tests | Standard Python test runner; src-layout friendly |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest-timeout` | >=2.3 | Per-test timeout to bound cancellation tests | Cancellation test could hang if cancel logic is broken |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled stderr threading | `ffmpeg-progress-yield` (PyPI) | The PyPI library mixes stdout/stderr and lacks explicit Windows deadlock handling; hand-rolling gives full control over the captured-stderr return contract |
| `threading.Thread` for drain | `asyncio` subprocess | asyncio SelectorEventLoop on Windows cannot run subprocesses; ProactorEventLoop works but async design leaks into caller API; sync generator avoids this entirely |
| `subprocess.Popen` direct | `asyncio.create_subprocess_exec` | asyncio approach is correct for Phase 4 (web API); Phase 1 foundation stays sync to prove correctness independently |

**Installation:**

```bash
pip install pytest pytest-timeout
```

---

## Architecture Patterns

### Recommended Project Structure

```
video-encoder/
├── src/
│   └── encoder/
│       ├── __init__.py
│       └── ffmpeg.py          # run_ffmpeg, escape_vmaf_path, FfmpegError
├── tests/
│   └── test_ffmpeg.py         # integration tests, real ffmpeg, lavfi
├── assets/
│   └── vmaf_v0.6.1.json       # (already present)
├── pyproject.toml
└── README.md
```

### Pattern 1: Sync Generator with Background Stderr Drain

**What:** `run_ffmpeg()` yields parsed progress dicts in real time by reading stderr in a background thread that feeds a `queue.Queue`. The generator dequeues items and yields them. After the generator is exhausted, all captured stderr is available on the object/return.

**When to use:** Any time a caller needs line-by-line progress with no asyncio requirement.

**The deadlock problem this solves:** If you read stderr line-by-line in the main thread and ffmpeg writes more than ~64KB to stderr before you read it, the OS pipe buffer fills up and ffmpeg blocks. The background drain thread reads continuously, keeping the buffer clear.

**Example:**

```python
# Source: Python docs + established pattern
import subprocess
import threading
import queue
import os
import sys

def run_ffmpeg(cmd: list[str]):
    """
    Sync generator. Yields progress dicts for each 'frame=' line.
    Raises FfmpegError on non-zero exit.
    After exhaustion, all stderr captured in generator's .stderr attribute.
    """
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=creation_flags,
    )

    stderr_lines: list[str] = []
    line_queue: queue.Queue = queue.Queue()

    def _drain():
        for raw in proc.stderr:
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            stderr_lines.append(line)
            if line.startswith("frame="):
                line_queue.put(line)
        line_queue.put(None)  # sentinel

    drain_thread = threading.Thread(target=_drain, daemon=True)
    drain_thread.start()

    while True:
        item = line_queue.get()
        if item is None:
            break
        yield _parse_progress(item)

    drain_thread.join()
    proc.wait()

    if proc.returncode != 0:
        raise FfmpegError(returncode=proc.returncode, stderr="\n".join(stderr_lines))
```

**Note on `proc.stderr` iteration:** Iterating `proc.stderr` (a binary file object) reads line by line. ffmpeg writes progress with `\r` (carriage return) not `\n`. On Windows, opening the pipe in binary mode and stripping `\r` manually is required. Do not use `text=True` on Popen — binary mode is more predictable across platforms.

**ffmpeg progress separator:** ffmpeg uses `\r` to overwrite the progress line on terminals. When piped to Python, each `\r`-delimited chunk is a "line". The drain thread should split on `\r` OR use `stderr=subprocess.PIPE` and read in chunks, splitting on `\r`.

**Revised drain approach for `\r`-terminated progress:**

```python
def _drain():
    buf = b""
    while True:
        chunk = proc.stderr.read(512)
        if not chunk:
            break
        buf += chunk
        # ffmpeg uses \r to overwrite progress lines
        parts = buf.split(b"\r")
        buf = parts[-1]
        for part in parts[:-1]:
            line = part.decode("utf-8", errors="replace").strip()
            if line:
                stderr_lines.append(line)
                if "frame=" in line:
                    line_queue.put(line)
    # flush remaining
    if buf.strip():
        line = buf.decode("utf-8", errors="replace").strip()
        stderr_lines.append(line)
    line_queue.put(None)
```

### Pattern 2: Graceful Cancellation

**What:** To cancel an ffmpeg process without killing the Python parent on Windows, write `q\n` to ffmpeg stdin (ffmpeg's built-in quit signal), wait briefly, then fall back to `terminate()`.

**Why `CREATE_NEW_PROCESS_GROUP` matters:** On Windows, `Ctrl+C` (SIGINT) propagates to the entire console process group. Without a new process group, killing ffmpeg kills Python too. With `CREATE_NEW_PROCESS_GROUP`, ffmpeg is in its own group and `terminate()` is isolated.

**Example:**

```python
def cancel(proc: subprocess.Popen, wait_seconds: float = 3.0) -> None:
    """Gracefully cancel an ffmpeg process."""
    try:
        proc.stdin.write(b"q\n")
        proc.stdin.flush()
        proc.stdin.close()
    except OSError:
        pass  # stdin may already be closed

    try:
        proc.wait(timeout=wait_seconds)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            proc.kill()
```

**Important:** `proc.stdin` must be `subprocess.PIPE` for this to work. The wrapper always opens stdin as PIPE.

### Pattern 3: VMAF Path Escaping

**What:** ffmpeg's `-lavfi libvmaf=model_path=...` filter string requires Windows drive-letter colons to be escaped with a backslash, which itself must be escaped in the Python string. Result: `C:\\:/path/to/model.json` in the filter string.

**Verification source:** Streaming Learning Center official tutorial + Netflix VMAF GitHub docs confirm the escaping requirement. Multiple sources agree.

**Note on newer ffmpeg syntax:** As of ffmpeg builds from late 2023 onward, the `model_path=` option is deprecated in favor of `model='path=...'`. Both forms should be supported. The escaping requirement applies to the path value in both forms.

**Example:**

```python
import sys
import pathlib

def escape_vmaf_path(path: str | pathlib.Path) -> str:
    """
    Return a filter-string-safe VMAF model path.

    On Windows: converts backslashes to forward slashes, then escapes
    the drive-letter colon with a backslash so ffmpeg's filter parser
    does not treat it as an option separator.

    Example:
        Input:  C:\\Users\\foo\\assets\\vmaf_v0.6.1.json
        Output: C\\:/Users/foo/assets/vmaf_v0.6.1.json

    On Linux: returns the path unchanged (no colons in normal paths).
    """
    p = str(path).replace("\\", "/")
    if sys.platform == "win32" and len(p) >= 2 and p[1] == ":":
        # Escape the colon: "C:" -> "C\\:"
        p = p[0] + "\\:" + p[2:]
    return p
```

**Usage in filter string:**

```python
vmaf_model = escape_vmaf_path("C:/ffmpeg/assets/vmaf_v0.6.1.json")
filter_str = f"libvmaf=model_path={vmaf_model}:log_fmt=json:log_path={log_path}"
```

### Pattern 4: Progress Line Regex

**What:** ffmpeg writes progress to stderr in lines like:
`frame=  123 fps= 45 q=28.0 size=    512kB time=00:00:05.12 bitrate= 820.0kbits/s speed=1.5x`

**Key detail:** Fields are separated by spaces (not fixed-width). The `frame=` may have leading spaces after the `=`. The `time=` field is `HH:MM:SS.ss` format.

**Example:**

```python
import re

_PROGRESS_RE = re.compile(
    r"frame=\s*(?P<frame>\d+)"
    r".*?fps=\s*(?P<fps>[\d.]+)"
    r".*?time=(?P<time>\d{2}:\d{2}:\d{2}\.\d+)"
    r".*?bitrate=\s*(?P<bitrate>[\d.]+)"
    r".*?speed=\s*(?P<speed>[\d.]+)x",
    re.IGNORECASE,
)

def _parse_progress(line: str) -> dict:
    m = _PROGRESS_RE.search(line)
    if not m:
        return {"raw_line": line}
    h, mn, s = m.group("time").split(":")
    time_seconds = int(h) * 3600 + int(mn) * 60 + float(s)
    return {
        "frame": int(m.group("frame")),
        "fps": float(m.group("fps")),
        "time_seconds": time_seconds,
        "bitrate": float(m.group("bitrate")),
        "speed": float(m.group("speed")),
        "raw_line": line,
    }
```

### Pattern 5: Typed Error

**What:** Non-zero ffmpeg exit should raise a descriptive exception that includes returncode and the full captured stderr so callers can log or display it.

**Example:**

```python
class FfmpegError(Exception):
    """Raised when ffmpeg exits with a non-zero return code."""
    def __init__(self, returncode: int, stderr: str) -> None:
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(
            f"ffmpeg exited with code {returncode}.\nStderr:\n{stderr}"
        )
```

### Anti-Patterns to Avoid

- **Using `communicate()` when you need real-time progress:** `communicate()` buffers everything and returns only after the process exits — no streaming possible. The design decision (locked) is to never use `communicate()`.
- **Reading stdout and stderr sequentially in the same thread:** Causes deadlock when one pipe fills. Always drain stderr in a background thread.
- **Using `text=True` on Popen with ffmpeg:** ffmpeg's progress uses `\r` not `\n`; Python's text mode line iteration splits on `\n` only on some platforms, causing lines not to be yielded until the next `\n` which may never come during a progress update.
- **Calling `os.kill(pid, signal.CTRL_C_EVENT)` on Windows without a new process group:** Sends Ctrl+C to the entire console group, killing the Python parent process.
- **Using `asyncio.create_subprocess_exec` in a `SelectorEventLoop`:** SelectorEventLoop (the Windows default before Python 3.8) does not implement `subprocess_exec`. Even with `ProactorEventLoop` (default Python 3.8+), async subprocess introduces complexity not needed in this phase; the sync generator design is correct.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progress percentage calculation | Custom duration-parsing + progress math | `_parse_progress()` returning `time_seconds` (Phase 3 derives % from total duration) | Phase 1 only needs parsed fields; % is a Phase 3 concern when duration is known |
| Retry-on-failure subprocess | Custom retry wrapper | Phase 3 CRF feedback loop | Retry logic belongs with VMAF evaluation, not the subprocess wrapper |
| Async subprocess bridge | Thread-to-asyncio queue adapter | Phase 4 decides the SSE strategy | Phase 1 sync generator is consumed via `run_in_executor` by Phase 4; don't pre-optimize |

**Key insight:** The subprocess wrapper's only job is correct execution + progress streaming + graceful cancellation. All higher-level logic belongs in later phases.

---

## Common Pitfalls

### Pitfall C1: Pipe Deadlock

**What goes wrong:** ffmpeg fills the stderr pipe buffer (64KB on Windows), blocks waiting for the reader, Python is waiting for ffmpeg to exit — mutual deadlock, process hangs forever.

**Why it happens:** `proc.stderr.read()` or sequential `readline()` in the same thread as `proc.wait()` without concurrent drain.

**How to avoid:** Background thread drains stderr into a `queue.Queue` continuously while the main thread (generator) dequeues items.

**Warning signs:** Test hangs indefinitely rather than timing out with an ffmpeg error.

### Pitfall C2: asyncio SelectorEventLoop on Windows (AVOIDED BY DESIGN)

**What goes wrong:** `asyncio.create_subprocess_exec()` raises `NotImplementedError` on Windows when the event loop is `SelectorEventLoop`.

**Why it happens:** SelectorEventLoop does not implement `subprocess_exec()` on Windows. `ProactorEventLoop` is the default since Python 3.8 but FastAPI/uvicorn may switch loops.

**How to avoid:** Phase 1 uses sync `Popen` — no asyncio involved. Phase 4 wraps this in `run_in_executor`.

**Warning signs:** `NotImplementedError` or `AttributeError` on subprocess creation inside async context.

### Pitfall C3: Killing Python Parent on Windows Cancel

**What goes wrong:** `proc.terminate()` or `os.kill(pid, signal.CTRL_C_EVENT)` without `CREATE_NEW_PROCESS_GROUP` sends the signal to the entire Windows console process group, terminating the Python process.

**How to avoid:** Always use `creationflags=subprocess.CREATE_NEW_PROCESS_GROUP` on Windows. Use `stdin q\n` first, then `terminate()` as fallback — never `CTRL_C_EVENT` directly.

**Warning signs:** Python process terminates when cancellation is called; cancellation test never reaches its assertion.

### Pitfall C4: VMAF Path Colon Escaping

**What goes wrong:** On Windows, `libvmaf=model_path=C:/path/model.json` is parsed by ffmpeg's filter parser as `model_path=C` (stops at the first unescaped colon).

**How to avoid:** Use `escape_vmaf_path()` to produce `C\\:/path/model.json` before constructing filter strings. Validate the utility function has a unit test with a known Windows drive-letter path.

**Warning signs:** VMAF filter silently returns 0 or ffmpeg exits with filter parse error mentioning unexpected option after colon.

### Pitfall C5: VMAF Returns 0 Silently (OUT OF SCOPE — Phase 3)

**What goes wrong:** VMAF filter graph compares wrong streams (e.g., dist=ref) and returns score 0.0 without error.

**Why it happens:** `[0][1]` vs `[1][0]` input order in the VMAF filter graph. ffmpeg encodes the first input as distorted, second as reference.

**How to avoid:** Phase 3 concern. Document here so Phase 3 research includes verification.

**Warning signs:** VMAF scores cluster near 0 or 100 regardless of CRF.

### Pitfall: `\r`-Terminated Progress Lines

**What goes wrong:** ffmpeg writes progress as `\r`-separated updates (not `\n`). Standard Python line iteration on `proc.stderr` in text mode only yields on `\n` boundaries, so progress lines may not appear until end-of-stream.

**How to avoid:** Read stderr in binary mode, chunk-read, split on `\r` manually (see Pattern 1 revised drain).

**Warning signs:** No progress events yielded during encode; all lines appear at once after ffmpeg exits.

---

## Code Examples

Verified patterns from official sources and confirmed behavior:

### lavfi Synthetic Test Source (for integration tests)

```bash
# 3-second 640x480 test video encode to /dev/null (Linux) or NUL (Windows)
ffmpeg -f lavfi -i testsrc=duration=3:size=640x480:rate=24 \
       -c:v libx264 -preset ultrafast -f null -

# 60-second source for cancellation test (start, cancel after 1s)
ffmpeg -f lavfi -i testsrc=duration=60:size=640x480:rate=24 \
       -c:v libx264 -preset ultrafast output.mp4
```

In Python tests, use `/dev/null` on Linux and `NUL` on Windows, or a temp file:

```python
import sys, tempfile, os

NULL_DEVICE = "NUL" if sys.platform == "win32" else "/dev/null"
```

### pyproject.toml for src layout

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "encoder"
version = "0.1.0"
requires-python = ">=3.9"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

### pytest integration test structure

```python
# tests/test_ffmpeg.py
import sys
import pytest
from encoder.ffmpeg import run_ffmpeg, escape_vmaf_path, FfmpegError

FFMPEG = "C:/ffmpeg/ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"

@pytest.mark.timeout(30)
def test_progress_events_emitted():
    cmd = [FFMPEG, "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=24",
           "-c:v", "libx264", "-preset", "ultrafast", "-f", "null",
           "NUL" if sys.platform == "win32" else "/dev/null"]
    events = list(run_ffmpeg(cmd))
    assert len(events) > 0
    assert "frame" in events[0]

@pytest.mark.timeout(15)
def test_cancel_graceful():
    import threading, time
    cmd = [FFMPEG, "-f", "lavfi", "-i", "testsrc=duration=60:size=320x240:rate=24",
           "-c:v", "libx264", "-preset", "ultrafast", "-f", "null",
           "NUL" if sys.platform == "win32" else "/dev/null"]
    gen = run_ffmpeg(cmd)
    # get handle to the process through the generator's process reference
    # (design decision: generator exposes .proc or cancellation via separate call)
    ...  # exact mechanism is Claude's discretion — see Open Questions

def test_error_on_bad_command():
    with pytest.raises(FfmpegError) as exc_info:
        list(run_ffmpeg([FFMPEG, "-i", "nonexistent_file_xyz.mp4", "-f", "null", "-"]))
    assert exc_info.value.returncode != 0
    assert len(exc_info.value.stderr) > 0

def test_escape_vmaf_path_windows():
    result = escape_vmaf_path("C:/path/to/vmaf_v0.6.1.json")
    # On Windows: colon escaped; on Linux: unchanged
    if sys.platform == "win32":
        assert result == "C\\:/path/to/vmaf_v0.6.1.json"
    else:
        assert result == "C:/path/to/vmaf_v0.6.1.json"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `model_path=` option in libvmaf filter | `model='path=...'` syntax | Late 2023 (ffmpeg 6+) | Both still work but `model_path=` is deprecated; Phase 3 should use new syntax for future-proofing |
| asyncio SelectorEventLoop (Windows) | ProactorEventLoop default | Python 3.8 (2019) | No action needed — Phase 1 uses sync Popen, avoids the issue entirely |
| `communicate()` for subprocess output | Threading + queue drain | Established pattern | `communicate()` still exists but cannot stream; threading is required for progress |

**Deprecated/outdated:**
- `model_path=` in libvmaf: Works but deprecated as of ffmpeg 6+. Use `model='path=...'` in Phase 3.
- `subprocess.CREATE_NEW_CONSOLE`: An alternative to `CREATE_NEW_PROCESS_GROUP` but less appropriate — it opens a visible console window.

---

## Open Questions

1. **Cancellation API: how does the caller cancel a running generator?**
   - What we know: The generator holds the `Popen` object internally. The caller iterates `for event in run_ffmpeg(cmd)`.
   - What's unclear: If the caller wants to cancel mid-iteration (e.g., `break` out of the loop), the subprocess is orphaned unless there's an explicit cancel hook. Python generator `close()` triggers `GeneratorExit` which can be caught.
   - Recommendation: Either (a) expose the `Popen` object on a wrapper class (`gen.cancel()`), or (b) use a context manager (`with run_ffmpeg(cmd) as gen`) that cancels on `__exit__`. The test strategy mentions a cancellation test — the planner should pick the API shape. This is Claude's discretion.

2. **ffmpeg binary path resolution**
   - What we know: CLAUDE.md specifies `C:\ffmpeg\ffmpeg.exe` on Windows. Linux uses system ffmpeg.
   - What's unclear: Should `run_ffmpeg()` accept the full path or resolve it internally?
   - Recommendation: Accept the path as part of the `cmd` list (caller's responsibility). The wrapper does not do path resolution. A separate `find_ffmpeg()` helper can be added if needed, but is not required for Phase 1.

3. **`\r`-split vs `\n`-split for progress line detection**
   - What we know: ffmpeg writes `\r` between progress updates. When piped, the exact behavior depends on buffering mode.
   - What's unclear: Does ffmpeg flush after each `\r` write? Does Windows pipe buffering change the chunking?
   - Recommendation: The chunk-read + `\r`-split approach in Pattern 1 is the most robust. Verify by running a real 3-second encode and confirming progress events arrive mid-encode (not all at the end).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest >=8.0 |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` — Wave 0 creates this |
| Quick run command | `pytest tests/test_ffmpeg.py -x` |
| Full suite command | `pytest tests/ -v` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-10 | ffmpeg runs on Windows and Linux via wrapper | integration | `pytest tests/test_ffmpeg.py::test_progress_events_emitted -x` | Wave 0 |
| PIPE-10 | Graceful cancel without killing Python parent | integration | `pytest tests/test_ffmpeg.py::test_cancel_graceful -x` | Wave 0 |
| PIPE-10 | Non-zero exit raises typed FfmpegError with stderr | integration | `pytest tests/test_ffmpeg.py::test_error_on_bad_command -x` | Wave 0 |
| PIPE-10 | VMAF path escaping correct for Windows drive-letter paths | unit | `pytest tests/test_ffmpeg.py::test_escape_vmaf_path_windows -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pytest tests/test_ffmpeg.py -x`
- **Per wave merge:** `pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/__init__.py` — empty, marks tests as package
- [ ] `tests/test_ffmpeg.py` — all four tests above (covers PIPE-10)
- [ ] `src/encoder/__init__.py` — empty, marks package
- [ ] `pyproject.toml` — project config + pytest config + package discovery
- [ ] Framework install: `pip install pytest pytest-timeout`

---

## Sources

### Primary (HIGH confidence)

- Python docs `asyncio-platforms.html` — confirmed SelectorEventLoop does not support subprocesses on Windows; ProactorEventLoop is default since Python 3.8
- Python docs `subprocess.html` — `communicate()` deadlock warning, `CREATE_NEW_PROCESS_GROUP` semantics, `terminate()` behavior
- Streaming Learning Center — VMAF on Windows path escaping: `C\\:/path` pattern confirmed

### Secondary (MEDIUM confidence)

- Netflix VMAF GitHub `ffmpeg.md` — `model_path=` deprecation in favor of `model='path=...'` (searched, confirmed by VideoHelp forum corroboration)
- Multiple WebSearch sources agree on the `frame=...fps=...time=...bitrate=...speed=` progress line format

### Tertiary (LOW confidence)

- camratus.com blog — Windows graceful stop pattern using `CREATE_NEW_CONSOLE` + ctypes kernel approach (not recommended — project uses `CREATE_NEW_PROCESS_GROUP` + stdin `q\n` which is the cleaner approach confirmed by multiple sources)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all stdlib, pytest is universal
- Architecture (sync generator + threading drain): HIGH — directly derived from Python subprocess docs deadlock warnings
- Windows process group cancellation: HIGH — Python docs confirm `CREATE_NEW_PROCESS_GROUP` semantics
- VMAF path escaping: HIGH — multiple authoritative sources agree on `C\\:/path` pattern
- `\r`-split stderr reading: MEDIUM — behavior confirmed in multiple ffmpeg community sources but exact Windows pipe buffering behavior should be verified with a real encode test
- Pitfalls: HIGH — C1–C4 are well-documented, C5 deferred to Phase 3

**Research date:** 2026-03-07
**Valid until:** 2026-09-07 (stable stdlib patterns; VMAF syntax may evolve with ffmpeg releases)
