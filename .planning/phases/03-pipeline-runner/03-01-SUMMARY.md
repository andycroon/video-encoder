---
phase: 03-pipeline-runner
plan: "01"
subsystem: testing
tags: [python, pytest, pipeline, scenedetect, ffmpeg, vmaf, tdd, x264]

# Dependency graph
requires:
  - phase: 02-sqlite-state-layer
    provides: db.py async API (create_job, update_chunk, append_job_log, etc.)
  - phase: 01-subprocess-foundation
    provides: run_ffmpeg(), FfmpegProcess, escape_vmaf_path(), ffmpeg.py
provides:
  - pipeline.py skeleton with PipelineError, DEFAULT_CONFIG, run_pipeline stub, and 13 private helper stubs (all raise NotImplementedError)
  - 14 RED test stubs in tests/test_pipeline.py covering every pipeline step
  - scenedetect[opencv] added to project dependencies
affects:
  - 03-02 (FFV1 encode + scene detection implementation — implements test_ffv1_encode, test_scene_detect, test_zero_scenes_error)
  - 03-03 (chunking + audio + x264 + VMAF implementation)
  - 03-04 (concat + mux + cleanup + full pipeline integration)

# Tech tracking
tech-stack:
  added:
    - scenedetect[opencv]>=0.6.7,<0.7
  patterns:
    - TDD RED-first: all 14 test stubs exist and fail before any implementation begins
    - NotImplementedError stubs: every helper raises NotImplementedError — no accidentally permissive stub
    - lavfi synthetic sources: ffmpeg lavfi testsrc2 and sine used for hermetic integration tests (no test fixtures on disk)
    - pytest.mark.timeout(120): all pipeline tests time-bounded to prevent CI hang

key-files:
  created:
    - src/encoder/pipeline.py
    - tests/test_pipeline.py
  modified:
    - pyproject.toml

key-decisions:
  - "scenedetect[opencv]>=0.6.7,<0.7 placed in [project] dependencies (not dev) — runtime dependency for Phase 3 pipeline code"
  - "All private helper stubs raise NotImplementedError immediately — no stub is accidentally permissive at RED stage"
  - "Tests call actual stubs (which raise NotImplementedError) rather than using pytest.fail() — cleaner error messages and verifies import chain works end-to-end"
  - "lavfi sources used for all synthetic video/audio in tests — no on-disk fixture files needed, hermetic"
  - "DEFAULT_CONFIG uses string values for x264_params (not int) to preserve exact ffmpeg flag format (e.g. '12000K', '-loop')"

patterns-established:
  - "RED-first scaffold: create all test stubs before any implementation so test contracts drive plans 02-04"
  - "lavfi integration pattern: ffmpeg -f lavfi -i testsrc2=... for video, sine=... for audio — used across all pipeline tests"
  - "Timeout decoration: @pytest.mark.timeout(120) on all tests that invoke real ffmpeg"

requirements-completed:
  - PIPE-01
  - PIPE-02
  - PIPE-03
  - PIPE-04
  - PIPE-05
  - PIPE-06
  - PIPE-07
  - PIPE-08
  - PIPE-09
  - CONF-01
  - CONF-02
  - CONF-03
  - CONF-04

# Metrics
duration: 6min
completed: 2026-03-07
---

# Phase 3 Plan 01: Pipeline Scaffold and Test Stubs Summary

**14 RED test stubs covering all pipeline steps + pipeline.py skeleton with PipelineError, DEFAULT_CONFIG, and 13 NotImplementedError stubs — scenedetect[opencv] added as runtime dependency**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-07T22:14:25Z
- **Completed:** 2026-03-07T22:20:55Z
- **Tasks:** 1 (TDD RED phase — single scaffold commit)
- **Files modified:** 3

## Accomplishments

- Added `scenedetect[opencv]>=0.6.7,<0.7` to pyproject.toml and installed it — `from scenedetect import detect, ContentDetector` imports cleanly
- Created `src/encoder/pipeline.py` with `PipelineError`, `DEFAULT_CONFIG` (all original PowerShell defaults), `run_pipeline` stub, and 13 private helper stubs all raising `NotImplementedError`
- Created `tests/test_pipeline.py` with exactly 14 RED test stubs — pytest collects all 14, exits FAILED (not ERROR), confirming import chain and test contracts are wired correctly

## Task Commits

Each task was committed atomically:

1. **Task 1: RED-state scaffold (pyproject.toml + pipeline.py + tests)** - `86d1751` (test)

**Plan metadata:** (docs commit follows)

_Note: TDD RED phase — single commit covers all three files as one atomic scaffold unit_

## Files Created/Modified

- `pyproject.toml` - Added scenedetect[opencv]>=0.6.7,<0.7 to [project] dependencies
- `src/encoder/pipeline.py` - Pipeline skeleton: PipelineError, DEFAULT_CONFIG, run_pipeline stub, 13 private helper stubs
- `tests/test_pipeline.py` - 14 RED test stubs with lavfi synthetic sources and pytest.mark.timeout(120)

## Decisions Made

- Tests call actual stubs (which raise `NotImplementedError`) rather than using `pytest.fail()` — this verifies the full import chain works and produces cleaner failure messages that name the function that needs implementing.
- `DEFAULT_CONFIG` x264_params values are strings (not ints/floats) to preserve exact ffmpeg format (e.g., `"12000K"`, `"-loop"`, `"0.50"`). Plans 02-04 can format these directly into `-x264-params` strings without type conversion.
- `test_audio_codec_dispatch` tests "aac", "flac", and "copy" codecs. The "eac3" codec is excluded from this test because it requires a Plex Transcoder EAE path that is not available in the test environment — it will be tested via integration tests in a later phase.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 14 test contracts are defined — Plans 02, 03, 04 have clear test targets
- `pipeline.py` imports cleanly from `encoder.pipeline`; Phase 4 (Web API) can import `run_pipeline` once implemented
- scenedetect is installed and importable — ready for Plan 02 implementation
- VMAF model at `assets/vmaf_v0.6.1.json` confirmed present — ready for Plan 03 VMAF scoring implementation

---
*Phase: 03-pipeline-runner*
*Completed: 2026-03-07*
