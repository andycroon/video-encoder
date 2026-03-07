---
phase: 03-pipeline-runner
plan: "02"
subsystem: pipeline
tags: [python, pytest, pipeline, ffv1, scenedetect, ffmpeg, tdd, x264, audio]

# Dependency graph
requires:
  - phase: 03-pipeline-runner
    plan: "01"
    provides: pipeline.py skeleton with NotImplementedError stubs + 14 RED tests
  - phase: 01-subprocess-foundation
    provides: run_ffmpeg(), FfmpegProcess, FfmpegError
provides:
  - _ffv1_encode: sync function, FFV1 lossless encode via run_ffmpeg
  - _detect_scenes: sync function, PySceneDetect boundary detection, returns list[float]
  - _split_chunks: sync function, ffmpeg segment muxer, returns list[Path]
  - _transcode_audio: sync function, AUDIO_CODECS dispatch, writes to caller-provided path
  - AUDIO_CODECS: module-level dict mapping codec name to (flags, extension)
affects:
  - 03-03 (x264 encode + VMAF scoring implementation)
  - 03-04 (concat + mux + cleanup + full pipeline integration)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AUDIO_CODECS dispatch table: maps codec string to (["-c:a", codec], ext) tuple
    - run_ffmpeg drain loop: iterate FfmpegProcess to completion, wrap FfmpegError as PipelineError
    - Caller-provided output path: _transcode_audio writes to exact path passed in (no forced suffix)

key-files:
  created: []
  modified:
    - src/encoder/pipeline.py
    - tests/test_pipeline.py

key-decisions:
  - "_transcode_audio writes to caller-provided output_path directly — does not apply with_suffix; callers control output file naming"
  - "AUDIO_CODECS dispatch table stores (flags_list, extension) tuple at module level — Plans 03+ can reuse for pipeline audio step"
  - "test_make_video_with_cut helper fixed to use -filter_complex instead of inline lavfi filtergraph; ffmpeg lavfi demuxer cannot resolve output labels from complex graph inline in -i"

# Metrics
duration: 8min
completed: 2026-03-07
---

# Phase 3 Plan 02: FFV1 Encode, Scene Detection, Chunk Split, Audio Transcode Summary

**_ffv1_encode, _detect_scenes, _split_chunks, _transcode_audio implemented — 6 RED tests turned GREEN, 8 remaining stubs still raise NotImplementedError as expected**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-07T22:20:55Z
- **Completed:** 2026-03-07T22:28:53Z
- **Tasks:** 2 (TDD GREEN phase)
- **Files modified:** 2

## Accomplishments

- Implemented `_ffv1_encode`: runs FFV1 lossless encode via `run_ffmpeg`, wraps `FfmpegError` as `PipelineError` on failure
- Implemented `_detect_scenes`: calls PySceneDetect `detect()` synchronously, raises `PipelineError("No scenes detected in {path}")` on empty result, returns `list[float]` of boundary timestamps (skipping scenes[0] which starts at 0)
- Added `AUDIO_CODECS` dispatch table at module level: `{"eac3": (["-c:a", "eac3"], "eac3"), "aac": ..., "flac": ..., "copy": ...}`
- Implemented `_split_chunks`: uses ffmpeg segment muxer (`-f segment -segment_times`) for multi-scene, direct copy to `chunk000000.mov` for single-scene; raises `PipelineError` if no chunks produced
- Implemented `_transcode_audio`: drains `run_ffmpeg` for any supported codec; writes to caller-provided `output_path` exactly

## Task Commits

Each task was committed atomically:

1. **Task 1: _ffv1_encode + _detect_scenes GREEN** - `cf2368b` (feat)
2. **Task 2: _split_chunks + _transcode_audio GREEN** - `710fc3c` (feat)

## Files Created/Modified

- `src/encoder/pipeline.py` - Implemented _ffv1_encode, _detect_scenes, AUDIO_CODECS, _audio_cmd, _split_chunks, _transcode_audio
- `tests/test_pipeline.py` - Fixed _make_video_with_cut helper (Rule 1 bug fix)

## Decisions Made

- `_transcode_audio` writes to the exact `output_path` the caller provides — does not apply `with_suffix` to change extensions. This matches what `test_audio_codec_dispatch` expects (caller chooses the filename including extension).
- `AUDIO_CODECS` stores the extension hint alongside the flags list, so future callers that want auto-naming can use it, without forcing existing callers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed _make_video_with_cut test helper using invalid ffmpeg syntax**
- **Found during:** Task 1 (test_scene_detect RED)
- **Issue:** `_make_video_with_cut` placed a filtergraph with `[out]` label in `-i` using the lavfi demuxer. ffmpeg's lavfi demuxer cannot resolve output pad labels (`[v1][v2]concat...`) as a top-level graph — it needs `-filter_complex` with separate `-f lavfi` inputs.
- **Fix:** Changed to two separate `-f lavfi -i` inputs (testsrc2 + color=c=red) with `-filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[out]"` and `-map "[out]"`
- **Files modified:** `tests/test_pipeline.py`
- **Commit:** `cf2368b`

**2. [Rule 1 - Bug] _transcode_audio output path: do not forcibly change suffix**
- **Found during:** Task 2 (test_audio_codec_dispatch FAILED)
- **Issue:** Initial implementation used `output_path.with_suffix(f".{ext}")` which redirected `audio_aac.aac` to `audio_aac.m4a`, but the test asserts the file exists at the original path.
- **Fix:** Write to `output_path` directly; the extension dispatch table retains the ext hint for documentation/future use.
- **Files modified:** `src/encoder/pipeline.py`
- **Commit:** `710fc3c`

## Self-Check: PASSED

- `src/encoder/pipeline.py` - FOUND
- `tests/test_pipeline.py` - FOUND
- `03-02-SUMMARY.md` - FOUND
- commit `cf2368b` (Task 1) - FOUND
- commit `710fc3c` (Task 2) - FOUND
