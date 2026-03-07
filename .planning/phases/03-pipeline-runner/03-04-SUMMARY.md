---
phase: 03-pipeline-runner
plan: "04"
subsystem: pipeline
tags: [python, asyncio, ffmpeg, x264, vmaf, sqlite, aiosqlite]

# Dependency graph
requires:
  - phase: 03-03
    provides: _encode_chunk_with_vmaf, _ffv1_encode, _detect_scenes, _split_chunks, _transcode_audio, all private helpers
  - phase: 02-sqlite-state-layer
    provides: create_job, update_job_status, create_step, update_step, create_chunk, update_chunk, append_job_log, recover_stale_jobs
provides:
  - run_pipeline: full 10-step async orchestrator (FFV1 -> scenedetect -> chunks -> audio -> x264+VMAF -> concat -> mux -> cleanup)
  - _write_concat_list: ffmpeg concat demuxer manifest writer
  - _concat_chunks: sync ffmpeg concat demuxer runner
  - _mux_video_audio: sync ffmpeg mux (video+audio -> .mkv)
  - _cleanup: removes chunks/, encoded/, intermediate/ subdirs + loose temp files
  - CLI entry point: python -m encoder.pipeline with argparse, SIGINT cancel handler, init_db+recover_stale_jobs at startup
  - README Phase 3 section: full config parameter reference, CLI usage, cancel behavior, Python API
affects:
  - 04-web-api: imports run_pipeline, wraps with asyncio task management, sets cancel_event from HTTP endpoint
  - 05-react-ui: reads chunks.vmaf_score/crf_used from DB for per-chunk display

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "run_pipeline: async orchestrator calling sync helpers directly (acceptable for single-job CLI)"
    - "cancel_event: threading.Event polled between every pipeline step; PipelineError(status=CANCELLED) triggers DB update + cleanup"
    - "finally block in run_pipeline: _cleanup always called regardless of success/failure/cancel"
    - "SIGINT handler sets cancel_event; pipeline detects it at next _check_cancel() call"
    - "CLI: init_db + recover_stale_jobs before create_job; ensures DB schema exists and stale jobs are reset"

key-files:
  created: []
  modified:
    - src/encoder/pipeline.py
    - README.md

key-decisions:
  - "_concat_chunks and _mux_video_audio implemented as sync functions — test contract calls them without await; consistent with _encode_chunk_with_vmaf pattern from Plan 03"
  - "run_pipeline calls sync helpers directly (no run_in_executor) — acceptable for single-job CLI; Phase 4 can wrap in executor if needed for concurrent jobs"
  - "CLI _cli() function: SIGINT handler sets cancel_event; asyncio.run() runs _main() which calls init_db/recover_stale_jobs/create_job/run_pipeline in sequence"

patterns-established:
  - "Cancel propagation: threading.Event -> _check_cancel() raises PipelineError(status=CANCELLED) -> run_pipeline catches and sets DB status CANCELLED -> finally _cleanup()"
  - "DB step tracking: create_step before each step, update_step DONE after; enables Phase 4 SSE progress streaming"
  - "Per-chunk DB tracking: create_chunk before encode, update_chunk(status=DONE, crf_used, vmaf_score, iterations) after; enables Phase 5 per-chunk UI display"

requirements-completed: [PIPE-08, PIPE-09]

# Metrics
duration: 5min
completed: 2026-03-07
---

# Phase 03 Plan 04: Pipeline Concat, Mux, Cleanup, Orchestrator, and CLI Summary

**Full 10-step run_pipeline orchestrator with DB step/chunk tracking, cancel polling, _cleanup in finally, and python -m encoder.pipeline CLI — 25 tests green**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-07T22:35:00Z
- **Completed:** 2026-03-07T22:39:02Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Implemented _write_concat_list, _concat_chunks, _mux_video_audio, _cleanup — all 4 helpers working and tested
- Implemented run_pipeline async orchestrator with full DB step/chunk tracking, cancel_event polling between every step, and _cleanup in finally block
- CLI entry point: SIGINT sets cancel_event, init_db + recover_stale_jobs + create_job at startup, then run_pipeline; --help shows all 5 required arguments
- README updated with Phase 3 section covering config JSON schema, VMAF/CRF bounds, audio codec options, x264_params reference, cancel behavior, Python API

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement _write_concat_list, _concat_chunks, _mux_video_audio, _cleanup** - `ce4cebe` (feat)
2. **Task 2: Implement run_pipeline orchestrator, CLI __main__, and README update** - `55c3b2c` (feat)

## Files Created/Modified

- `C:/VibeCoding/video-encoder/src/encoder/pipeline.py` - Added 4 private helpers + full run_pipeline orchestrator + updated _cli with proper SIGINT/init_db/recover_stale_jobs/create_job flow; imported time and db functions
- `C:/VibeCoding/video-encoder/README.md` - Added Phase 3 section with CLI usage, config schema, pipeline steps, cancel behavior, Python API

## Decisions Made

- `_concat_chunks` and `_mux_video_audio` implemented as sync functions — the test suite calls them without `await`, consistent with `_encode_chunk_with_vmaf` sync pattern from Plan 03. The plan's `<action>` suggested async but tests govern.
- `run_pipeline` calls sync helpers directly without `run_in_executor` — acceptable for a single-job CLI; Phase 4 can add executor wrapping if concurrent job execution is needed.
- DB imports added at module top-level (not lazily inside run_pipeline) — cleaner and consistent with project patterns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] _concat_chunks and _mux_video_audio implemented as sync (not async)**
- **Found during:** Task 1 (verifying test contract)
- **Issue:** Plan `<action>` specified async implementations, but `test_concat_mux` calls them without `await` as sync functions. Making them async would cause tests to receive coroutine objects instead of running them.
- **Fix:** Implemented as sync functions, consistent with other sync helpers in this module.
- **Files modified:** src/encoder/pipeline.py
- **Verification:** test_concat_mux PASSED
- **Committed in:** ce4cebe (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test contract over plan action text)
**Impact on plan:** No scope change. Test contract is the authoritative specification; sync implementation is correct.

## Issues Encountered

None - plan executed cleanly. The `create_chunk` DB call signature differs slightly from plan pseudocode (no `source_path` arg) — matched actual DB API signature from db.py.

## Next Phase Readiness

- Phase 3 pipeline CLI complete: all 14 pipeline tests pass, all 25 total tests pass
- run_pipeline ready for Phase 4 import — accepts cancel_event (threading.Event), returns after cleanup, sets job status in DB
- DB tracking complete: steps table updated per step, chunks table updated per chunk with crf_used/vmaf_score/iterations
- Phase 4 can wrap run_pipeline in asyncio.create_task, pass its own cancel_event via threading.Event or wrapper

---
*Phase: 03-pipeline-runner*
*Completed: 2026-03-07*
