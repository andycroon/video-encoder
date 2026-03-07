---
phase: 01-subprocess-foundation
plan: "01"
subsystem: testing
tags: [python, pytest, setuptools, src-layout, tdd]

# Dependency graph
requires: []
provides:
  - pyproject.toml with src-layout package discovery and pytest config
  - encoder package importable via `from encoder.ffmpeg import ...`
  - four fully-written test specs for PIPE-10 (RED state — ffmpeg.py not yet implemented)
affects: [01-02, all subsequent phase-1 plans]

# Tech tracking
tech-stack:
  added: [pytest 8.4.2, pytest-timeout 2.4.0, setuptools 82.0.0]
  patterns: [src-layout package structure, TDD RED-GREEN-REFACTOR cycle, integration tests with real ffmpeg using lavfi synthetic sources]

key-files:
  created:
    - pyproject.toml
    - src/encoder/__init__.py
    - tests/__init__.py
    - tests/test_ffmpeg.py
    - .gitignore
  modified: []

key-decisions:
  - "Used setuptools.build_meta as build backend (not setuptools.backends.legacy:build) — legacy backend unavailable in editable install context with project-root prefix"
  - "Python environment uses C:\\Python313\\python.exe with Lib at C:\\Users\\owner\\AppData\\Local\\Programs\\Python\\Python313\\Lib — broken prefix causes pip to install packages into project root; added Lib/ and Scripts/ to .gitignore"
  - "gen.cancel() API contract established in tests — Plan 02 must expose .cancel() method on the object/generator returned by run_ffmpeg()"
  - "Cancellation is not an error — test_cancel_graceful asserts FfmpegError is NOT raised on cancel"

patterns-established:
  - "FFMPEG_BIN constant: C:/ffmpeg/ffmpeg.exe on win32, ffmpeg on other platforms"
  - "NULL_DEVICE constant: NUL on win32, /dev/null on other platforms"
  - "Progress events are dicts with at minimum 'frame' (int > 0) and sometimes 'fps' keys"
  - "FfmpegError has .returncode (int != 0) and .stderr (str, non-empty) attributes"

requirements-completed: [PIPE-10]

# Metrics
duration: 6min
completed: 2026-03-07
---

# Phase 1 Plan 01: Project Scaffold and PIPE-10 Test Specifications Summary

**src-layout Python package with pyproject.toml and four fully-written TDD RED tests covering run_ffmpeg progress streaming, graceful cancel, error handling, and Windows VMAF path escaping**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-07T16:44:54Z
- **Completed:** 2026-03-07T16:51:02Z
- **Tasks:** 2
- **Files modified:** 5 (pyproject.toml, src/encoder/__init__.py, tests/__init__.py, tests/test_ffmpeg.py, .gitignore)

## Accomplishments
- pyproject.toml with src-layout, pytest config (testpaths=["tests"], addopts="-v"), and dev extras (pytest 8.4.2, pytest-timeout 2.4.0)
- encoder package installable and importable via `pip install -e ".[dev]"` + `import encoder`
- Four fully-written PIPE-10 test specs in tests/test_ffmpeg.py (RED state — encoder.ffmpeg not yet created)
- .gitignore added to exclude project-root Python env artifacts (Lib/, Scripts/) caused by broken C:\Python313 prefix

## Task Commits

Each task was committed atomically:

1. **Task 1: Project scaffold (pyproject.toml + package markers)** - `9102380` (feat)
2. **Task 2: Write test specifications (RED state)** - `37e921c` (test)

## Files Created/Modified
- `pyproject.toml` — build system, package discovery, pytest config, dev dependencies
- `src/encoder/__init__.py` — package marker (empty)
- `tests/__init__.py` — package marker (empty)
- `tests/test_ffmpeg.py` — four fully-written test specs for PIPE-10
- `.gitignore` — excludes project-root Python env dirs, caches, and build artifacts

## Decisions Made
- Changed build backend from `setuptools.backends.legacy:build` to `setuptools.build_meta` — the legacy backend path is unavailable in the editable install pipeline on this machine (Rule 1 auto-fix: blocking issue during Task 1)
- Established `gen.cancel()` as the cancellation API contract — Plan 02 must expose this method on whatever object/generator `run_ffmpeg()` returns

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Switched build backend from legacy to build_meta**
- **Found during:** Task 1 (pip install -e .[dev])
- **Issue:** pyproject.toml specified `setuptools.backends.legacy:build` as build backend. `pip install -e` failed with `BackendUnavailable: Cannot import 'setuptools.backends.legacy'` — the backend path doesn't exist in the setuptools version available during build isolation.
- **Fix:** Changed build backend to `setuptools.build_meta` (the standard, stable backend that has been the default for years). Also explicitly added `wheel` to build requirements.
- **Files modified:** pyproject.toml
- **Verification:** `pip install -e ".[dev]"` succeeded; encoder importable; pytest 8.4.2 installed
- **Committed in:** `9102380` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking build issue)
**Impact on plan:** Build backend change is functionally equivalent — `setuptools.build_meta` is the canonical backend and the correct choice. No behavior difference.

## Issues Encountered
- `C:\Python313\python.exe` has a broken prefix — Python stdlib is at `C:\Users\owner\AppData\Local\Programs\Python\Python313\Lib` but the exe treats the working directory as its prefix. This causes pip to install packages into the project root (Lib/, Scripts/ directories). Worked around by using the project-root Scripts/pip3.exe and adding the directories to .gitignore. Plan 02 should use the same Python invocation pattern.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01-02 can proceed immediately: implement `src/encoder/ffmpeg.py` exposing `run_ffmpeg`, `escape_vmaf_path`, and `FfmpegError`
- Test API contract is fully defined: `run_ffmpeg(cmd)` returns an object with `.cancel()` method and is iterable; yields dicts with `frame` (int) and optionally `fps` keys; raises `FfmpegError` with `.returncode` and `.stderr` on non-zero exit
- Python invocation: `C:\Python313\python.exe -m pytest ...` works correctly

---
*Phase: 01-subprocess-foundation*
*Completed: 2026-03-07*
