---
phase: 01-subprocess-foundation
plan: "02"
subsystem: testing
tags: [python, subprocess, ffmpeg, threading, queue, windows, vmaf, tdd]

# Dependency graph
requires:
  - phase: 01-subprocess-foundation/01-01
    provides: "pyproject.toml src-layout, encoder package, four PIPE-10 test specs (RED state)"
provides:
  - "src/encoder/ffmpeg.py with run_ffmpeg, escape_vmaf_path, FfmpegError"
  - "FfmpegProcess: iterable with .cancel(), background stderr drain thread"
  - "All four PIPE-10 tests GREEN on Windows"
  - "ffmpeg installed at C:/ffmpeg/ffmpeg.exe"
affects: [01-03, 02-01, 03-01, 04-01, all subsequent phases that import encoder.ffmpeg]

# Tech tracking
tech-stack:
  added: [ffmpeg 8.0.1 (system binary at C:/ffmpeg/ffmpeg.exe)]
  patterns:
    - "sync generator pattern via FfmpegProcess __iter__/__next__ with queue.Queue"
    - "background threading.Thread for stderr drain (chunk-read + \\r-split)"
    - "subprocess.CREATE_NEW_PROCESS_GROUP on win32 for isolated process group"
    - "graceful cancel: write q\\n to stdin, wait 3s, terminate fallback, kill fallback"
    - "_cancelled flag to suppress FfmpegError on graceful exit"
    - "progress regex handles N/A values (bitrate=N/A in -f null encodes)"

key-files:
  created:
    - src/encoder/ffmpeg.py
  modified: []

key-decisions:
  - "Progress regex must handle N/A bitrate values — ffmpeg outputs 'bitrate=N/A' when encoding to null device; regex pattern extended to match N/A, bitrate stored as 0.0"
  - "ffmpeg installed to C:/ffmpeg/ matching CLAUDE.md spec — was not present on machine, downloaded from BtbN FFmpeg-Builds and copied to C:/ffmpeg/ffmpeg.exe"
  - "FfmpegProcess uses __iter__/__next__ protocol (not a generator function) so .cancel() method is accessible on the same object returned by run_ffmpeg()"

patterns-established:
  - "run_ffmpeg(cmd) returns FfmpegProcess — caller can do `gen = run_ffmpeg(cmd); next(gen); gen.cancel(); for _ in gen: pass`"
  - "escape_vmaf_path('C:/path') -> 'C\\\\:/path' on Windows, unchanged on Linux"
  - "FfmpegError.returncode is non-zero int; FfmpegError.stderr is full captured stderr string"
  - "All subsequent phases import via: from encoder.ffmpeg import run_ffmpeg, escape_vmaf_path, FfmpegError"

requirements-completed: [PIPE-10]

# Metrics
duration: 5min
completed: 2026-03-07
---

# Phase 1 Plan 02: ffmpeg.py — Cross-Platform Subprocess Wrapper Summary

**Sync subprocess wrapper over ffmpeg with background stderr drain thread, graceful cancel via stdin q\\n + CREATE_NEW_PROCESS_GROUP, FfmpegError on non-zero exit, and Windows VMAF path escaping — all four PIPE-10 tests GREEN**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-07T16:54:06Z
- **Completed:** 2026-03-07T17:00:02Z
- **Tasks:** 1 (TDD: GREEN + inline regex fix)
- **Files modified:** 1 (src/encoder/ffmpeg.py created)

## Accomplishments
- src/encoder/ffmpeg.py implementing all required exports: run_ffmpeg, escape_vmaf_path, FfmpegError
- FfmpegProcess class with full iterator protocol and .cancel() method on same object
- Background threading.Thread drains stderr via chunk-read + \\r-split (prevents pipe deadlock, C1)
- CREATE_NEW_PROCESS_GROUP on win32 ensures cancel() doesn't kill Python parent (C3)
- escape_vmaf_path() correctly escapes Windows drive-letter colon for ffmpeg filter strings (C4)
- ffmpeg binary installed at C:/ffmpeg/ffmpeg.exe (was not present on machine)
- All 4 pytest integration tests pass GREEN in 0.43s

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement src/encoder/ffmpeg.py (GREEN all four tests)** - `eaab6b8` (feat)

## Files Created/Modified
- `src/encoder/ffmpeg.py` — FfmpegProcess, run_ffmpeg, escape_vmaf_path, FfmpegError (312 lines)

## Decisions Made
- Used `__iter__`/`__next__` protocol rather than a generator function so the `.cancel()` method is accessible on the same object returned by `run_ffmpeg()` — a generator function would require a wrapper class anyway
- Extended progress regex to accept `N/A` for bitrate field — ffmpeg outputs `bitrate=N/A` when encoding to null device (`-f null NUL`), which is exactly what the integration tests use
- Stored `N/A` bitrate as `0.0` float to keep the progress dict type-consistent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ffmpeg not installed at C:/ffmpeg/ffmpeg.exe**
- **Found during:** Task 1 (running pytest tests/test_ffmpeg.py)
- **Issue:** Integration tests use real ffmpeg (no mocking per RESEARCH.md locked decision). CLAUDE.md specifies `C:\ffmpeg\ffmpeg.exe`. Binary was not present on this machine — all three subprocess tests failed with `FileNotFoundError: [WinError 2]`.
- **Fix:** Attempted `choco install ffmpeg` (failed with exit 1). Downloaded ffmpeg 8.0.1 from BtbN/FFmpeg-Builds (GitHub Releases) via `urllib.request`, extracted the zip, copied `ffmpeg.exe` to `C:/ffmpeg/ffmpeg.exe`. The ffmpeg binary is a system dependency, not a repo artifact.
- **Files modified:** None (system binary placement, not in repo)
- **Verification:** `C:/ffmpeg/ffmpeg.exe` present; tests pass
- **Committed in:** Not in repo (system binary)

**2. [Rule 1 - Bug] Progress regex did not match N/A bitrate values**
- **Found during:** Task 1 (test_progress_events_emitted failed on assertion `"frame" in event`)
- **Issue:** The progress regex required `[\d.]+` for bitrate, but ffmpeg outputs `bitrate=N/A` when encoding to `-f null NUL`. The regex failed to match, so `_parse_progress()` returned `{"raw_line": line}` without a `frame` key, failing the assertion.
- **Fix:** Extended regex to `(?P<bitrate>[\d.]+|N/A)` and added N/A handling in `_parse_progress()` (stored as `0.0`).
- **Files modified:** src/encoder/ffmpeg.py
- **Verification:** test_progress_events_emitted passes; all 4 tests GREEN
- **Committed in:** `eaab6b8` (part of Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking environment issue, 1 regex bug)
**Impact on plan:** Both fixes necessary for test suite to run at all. No scope creep — fixes address real ffmpeg behavior with null output device.

## Issues Encountered
- `choco install ffmpeg` failed (exit code 1) — fell back to direct download from BtbN FFmpeg-Builds GitHub Releases. ffmpeg is now at C:/ffmpeg/ffmpeg.exe as specified in CLAUDE.md.

## User Setup Required
None — ffmpeg was installed automatically to C:/ffmpeg/ffmpeg.exe during this plan's execution.

## Next Phase Readiness
- All subsequent phases can `from encoder.ffmpeg import run_ffmpeg, escape_vmaf_path, FfmpegError`
- Phase 1 (Subprocess Foundation) is now complete — both plans done, PIPE-10 satisfied
- Phase 2 (SQLite State Layer) can begin immediately
- Phase 3 note: VMAF filter graph stream order (C5 — VMAF returns 0 silently) still needs validation with real content before Phase 3 CRF feedback loop is built

---
*Phase: 01-subprocess-foundation*
*Completed: 2026-03-07*
