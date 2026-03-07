---
phase: 03-pipeline-runner
plan: "03"
subsystem: pipeline
tags: [x264, vmaf, crf-loop, oscillation-guard, libvmaf]
dependency_graph:
  requires:
    - 03-02 (pipeline steps 1-4, ffmpeg wrapper, run_ffmpeg)
  provides:
    - _x264_params_str (pure function, serializes x264_params dict)
    - _encode_chunk_x264 (per-chunk libx264 encode)
    - _vmaf_score (VMAF scoring via libvmaf filter)
    - _encode_chunk_with_vmaf (CRF feedback loop with oscillation guard)
    - _check_cancel (cancel_event polling helper)
  affects:
    - 03-04 (concat, mux, cleanup — builds on CRF loop output)
tech_stack:
  added: []
  patterns:
    - libvmaf filter with setpts+format=yuv420p on both inputs
    - Built-in vmaf_v0.6.1 model via version= syntax (avoids Windows path colon escaping)
    - CRF oscillation guard using visited_crfs set (not just iteration cap)
    - log_path in single quotes in lavfi filter string for Windows path safety
key_files:
  modified:
    - src/encoder/pipeline.py
decisions:
  - "Use model='version=vmaf_v0.6.1' instead of model='path=...' — Windows drive-letter colon breaks lavfi filter parsing even with escape_vmaf_path; built-in version string is unambiguous"
  - "log_path wrapped in single quotes in filter string — prevents colon in Windows temp path from being parsed as lavfi option separator"
  - "_encode_chunk_with_vmaf is synchronous (not async) — tests call it directly without await; DB update calls deferred to Plan 04 when full async context is available"
  - "_vmaf_score accepts (encoded_path, reference_path) positional args matching test contract; FFMPEG constant used internally"
metrics:
  duration: ~4 min
  completed: "2026-03-07T22:33:50Z"
  tasks_completed: 2
  files_modified: 1
---

# Phase 03 Plan 03: x264 Encode + VMAF CRF Loop Summary

One-liner: Per-chunk x264 encode with libvmaf scoring and oscillation-guarded CRF feedback loop that adjusts quality until VMAF lands in target range.

## What Was Built

Implemented pipeline steps 5-7 in `src/encoder/pipeline.py`:

**_x264_params_str(params: dict) -> str**
Pure function that serializes the x264_params dict to colon-separated `key=value` string for ffmpeg's `-x264-params` flag. Empty dict returns empty string.

**_encode_chunk_x264(chunk_path, output_path, crf, config, *, is_first=True)**
Encodes a single FFV1 chunk to x264 at the given CRF using the x264_params from config. Builds the ffmpeg command with `-c:v libx264 -crf {crf} -x264-params {params_str} -an`, drains the FfmpegProcess iterator, and wraps FfmpegError as PipelineError.

**_vmaf_score(encoded_path, reference_path) -> float**
Scores an encoded chunk against its FFV1 source using libvmaf. Uses the filter graph:
```
[0:v]setpts=PTS-STARTPTS,format=yuv420p[dist];
[1:v]setpts=PTS-STARTPTS,format=yuv420p[ref];
[dist][ref]libvmaf=model='version=vmaf_v0.6.1':log_fmt=json:log_path='...':n_threads=4
```
Writes JSON log to a tempfile (always deleted in finally), parses pooled_metrics.vmaf.mean, with fallback to frames average then stderr regex.

**_encode_chunk_with_vmaf(chunk_path, encoded_path, config, cancel_event=None, chunk_label='chunk') -> tuple[int, float, int]**
CRF feedback loop that:
1. Polls cancel_event at start of each iteration
2. Encodes chunk at current CRF
3. Scores VMAF; breaks if score in [vmaf_min, vmaf_max]
4. Checks visited_crfs set — breaks on revisit (oscillation guard)
5. Adds CRF to visited_crfs, adjusts ±1 based on score vs target
6. Breaks at CRF bounds (crf_min/crf_max)
7. Returns (final_crf, final_vmaf, iterations) where iterations = len(visited_crfs) + 1

**_check_cancel(cancel_event)**
Raises PipelineError(status="CANCELLED") if cancel_event is set (or if cancel_event is None, does nothing).

## Tests Results

11 PASSED, 3 FAILED (Plan 04 scope):
- test_x264_params_str: GREEN
- test_x264_encode: GREEN
- test_vmaf_score: GREEN
- test_crf_feedback_loop: GREEN
- test_crf_oscillation_guard: GREEN
- test_concat_mux: still RED (Plan 04)
- test_cleanup_on_success: still RED (Plan 04)
- test_cleanup_on_cancel: still RED (Plan 04)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] VMAF model path syntax fails on Windows with model='path=...'**
- **Found during:** Task 2 (test_vmaf_score)
- **Issue:** `model='path=C\:/path/vmaf.json'` parsed incorrectly — libvmaf reports "could not parse model config" even with escape_vmaf_path applied. Windows drive-letter colon breaks the lavfi filter parser inside single-quoted values.
- **Fix:** Switched to `model='version=vmaf_v0.6.1'` — the ffmpeg build has the model compiled in (confirmed from `-h filter=libvmaf` output showing default "version=vmaf_v0.6.1"). No path needed.
- **Files modified:** src/encoder/pipeline.py
- **Commits:** 4ad4a0c

**2. [Rule 1 - Bug] log_path colon breaks lavfi option parsing**
- **Found during:** Task 2 (test_vmaf_score, first attempt)
- **Issue:** `log_path=C\:/Users/.../tmpXXX.json:n_threads=4` — the colon after the drive letter was treated as an option separator, yielding "No option name near '/Users/...'".
- **Fix:** Wrapped log_path value in single quotes: `log_path='{escaped_log}'`.
- **Files modified:** src/encoder/pipeline.py
- **Commits:** 4ad4a0c

**3. [Rule 1 - Bug] _encode_chunk_with_vmaf implemented as sync (not async)**
- **Found during:** Task 2 (reviewing test contract)
- **Issue:** Tests call `_encode_chunk_with_vmaf(chunk, encoded, config)` without await. Plan described it as async but the test harness doesn't use asyncio.
- **Fix:** Implemented as synchronous function matching the test contract. DB update calls (append_job_log, update_chunk) are omitted from the loop body per plan spec that says they're for "db_path, job_id, chunk_id" params — these params are absent from the test-facing signature.
- **Files modified:** src/encoder/pipeline.py
- **Commits:** 4ad4a0c

## Decisions Made

- **model='version=vmaf_v0.6.1' over model='path=...':** Windows colon-in-path breaks lavfi parsing. Built-in version string is unambiguous and works with this ffmpeg build.
- **log_path in single quotes:** Prevents Windows drive-letter colon from being parsed as lavfi option separator.
- **_encode_chunk_with_vmaf as sync:** Test contract requires synchronous call; async DB integration is deferred to run_pipeline orchestrator in Plan 04.

## Self-Check: PASSED

- src/encoder/pipeline.py: FOUND
- Commit 9001abe (Task 1): FOUND
- Commit 4ad4a0c (Task 2): FOUND
- 11 tests GREEN, 3 still RED (Plan 04 scope): CONFIRMED
