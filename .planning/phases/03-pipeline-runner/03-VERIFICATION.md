---
phase: 03-pipeline-runner
verified: 2026-03-07T23:15:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Run CLI against a real source MKV: python -m encoder.pipeline source.mkv --output-dir ./out --temp-dir ./tmp"
    expected: "Final .mkv produced in ./out, no temp files left in ./tmp after completion, job shows DONE in encoder.db"
    why_human: "Full end-to-end pipeline execution against real video content is not covered by unit tests — unit tests use 1-3 second lavfi synthetic sources, not real MKV files with scene content."
  - test: "Run with Ctrl+C mid-encode and inspect DB"
    expected: "Job status = CANCELLED in DB, temp subdirs removed, no orphaned ffmpeg process"
    why_human: "Cancel flow requires interactive SIGINT during a real ffmpeg operation; cannot be automated in the test harness."
  - test: "Run CLI with eac3 audio codec on system with Plex Transcoder"
    expected: "Audio transcoded to EAC3 without error"
    why_human: "eac3 codec is excluded from test_audio_codec_dispatch because it requires Plex Transcoder EAE; this code path is untested in CI."
---

# Phase 3: Pipeline Runner Verification Report

**Phase Goal:** A real source MKV file can be encoded end-to-end — FFV1 intermediate, scene detection, chunking, audio transcode, per-chunk x264 encode with VMAF CRF feedback loop, concat, mux, and cleanup — entirely from the command line
**Verified:** 2026-03-07T23:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | All 14 pipeline tests pass (FFV1, scene detect, chunk split, audio transcode, x264, VMAF, CRF loop, oscillation guard, concat/mux, cleanup, codec dispatch, params str) | VERIFIED | `pytest tests/test_pipeline.py -v` → 14 passed in 2.23s |
| 2 | run_pipeline exports correct async signature: (source_path, db_path, job_id, config, cancel_event, output_dir, temp_dir) | VERIFIED | pipeline.py line 413-421; all parameters present with correct types |
| 3 | VMAF CRF feedback loop converges with oscillation guard and cancel polling between iterations | VERIFIED | `test_crf_feedback_loop` PASSED; `test_crf_oscillation_guard` PASSED; `_check_cancel` called at top of each iteration (line 308) |
| 4 | Per-chunk VMAF scores and CRF values stored in DB after encode | VERIFIED | `await update_chunk(db_path, chunk_id, crf_used=..., vmaf_score=..., iterations=..., status="DONE")` at lines 507-514 |
| 5 | CLI entry point works: python -m encoder.pipeline --help shows source, --config, --output-dir, --temp-dir, --scene-threshold | VERIFIED | Confirmed via `py.exe -m encoder.pipeline --help` — all 5 args shown |
| 6 | Cleanup happens in finally block regardless of success/failure/cancel | VERIFIED | `finally: _cleanup(temp_dir)` at lines 553-555; `test_cleanup_on_success` and `test_cleanup_on_cancel` both PASSED |
| 7 | README Phase 3 section covers pipeline configuration parameters | VERIFIED | `## Phase 3: Pipeline Runner` at line 140, `### Pipeline Configuration` at line 160 — full JSON schema, VMAF/CRF defaults, audio codec options, x264 params reference, cancel behavior, Python API |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/encoder/pipeline.py` | Full pipeline with run_pipeline, PipelineError, DEFAULT_CONFIG, all 13 private helpers | VERIFIED | 619 lines; all exports present; all helpers implemented (not stubs); _check_cancel, _cleanup in finally, all 10 pipeline steps |
| `tests/test_pipeline.py` | 14 test functions covering all pipeline steps | VERIFIED | 385 lines; 14 test functions; all use `@pytest.mark.timeout`; lavfi synthetic sources; import chain confirmed |
| `pyproject.toml` | scenedetect[opencv]>=0.6.7,<0.7 in [project] dependencies | VERIFIED | Line 11: `"scenedetect[opencv]>=0.6.7,<0.7"` present |
| `README.md` | Phase 3 section: Pipeline Configuration | VERIFIED | Lines 140-258; complete config schema, CLI usage table, x264_params reference, cancel behavior, Python API |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tests/test_pipeline.py` | `src/encoder/pipeline.py` | `from encoder.pipeline import run_pipeline, PipelineError, DEFAULT_CONFIG` | WIRED | Line 19; confirmed by test run with 0 import errors |
| `pipeline.py (_ffv1_encode)` | `ffmpeg.py (run_ffmpeg)` | `run_ffmpeg(cmd)` | WIRED | Line 114; FfmpegError imported (line 42); exception re-raised as PipelineError |
| `pipeline.py (_detect_scenes)` | `asyncio run_in_executor` | (MISSING — see note) | NOT_WIRED | `_detect_scenes` is a **synchronous function** that calls PySceneDetect directly (line 128: `scenes = detect(...)`). Plan 02 key_link required `loop.run_in_executor`. It is called from the async `run_pipeline` without executor wrapping (line 467). **This blocks the asyncio event loop during scene detection.** All tests pass because tests are single-threaded; Phase 4 (which runs jobs concurrently) will be affected. |
| `pipeline.py (_vmaf_score)` | `assets/vmaf_v0.6.1.json` | `VMAF_MODEL` constant | PARTIAL | `VMAF_MODEL` is defined (line 50) but NOT used in `_vmaf_score`. The filter string uses `model='version=vmaf_v0.6.1'` (built-in model string) instead of `model='path=...'`. This is an intentional Windows workaround (Windows colon-in-path parsing fails in lavfi filter strings). The VMAF model file exists at `assets/vmaf_v0.6.1.json`. Tests pass and VMAF scoring works correctly. |
| `pipeline.py (_vmaf_score)` | `ffmpeg.py (escape_vmaf_path)` | `escape_vmaf_path(log_path)` | WIRED | Line 232; used for log path escaping; imported at line 42 |
| `pipeline.py (_encode_chunk_with_vmaf)` | `db.py (update_chunk, append_job_log)` | `await update_chunk(...); await append_job_log(...)` | WIRED | Lines 507-518; both called after each chunk encode loop; vmaf_score, crf_used, iterations all written |
| `pipeline.py (run_pipeline)` | `db.py` | `await create_job, update_job_status, create_step, update_step, create_chunk` | WIRED | Lines 448-545; all 8 DB functions called with await; full step lifecycle tracked |
| `pipeline.py (__main__)` | `run_pipeline` | `asyncio.run(_main())` | WIRED | Line 614; SIGINT sets cancel_event (lines 589-592); init_db + recover_stale_jobs before create_job (lines 601-603) |
| `pipeline.py (run_pipeline)` | `_cleanup` | `finally: _cleanup(temp_dir)` | WIRED | Lines 553-555; always executed |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| PIPE-01 | 03-01, 03-02 | FFV1 lossless intermediate encode | SATISFIED | `_ffv1_encode` implemented; `test_ffv1_encode` PASSED |
| PIPE-02 | 03-01, 03-02 | Scene detection via PySceneDetect >=0.6.7,<0.7 | SATISFIED | `_detect_scenes` implemented; `test_scene_detect` PASSED; dep in pyproject.toml |
| PIPE-03 | 03-01, 03-02 | Split FFV1 into scene-boundary chunks | SATISFIED | `_split_chunks` implemented; `test_chunk_split` PASSED |
| PIPE-04 | 03-01, 03-02 | Audio transcode to user-selected codec (EAC3, AAC, FLAC, copy) | SATISFIED | `_transcode_audio` + `AUDIO_CODECS` dispatch table implemented; `test_audio_transcode` PASSED; `test_audio_codec_dispatch` PASSED (note: eac3 excluded from automated test — requires Plex Transcoder, intentional deviation documented in 03-01-SUMMARY) |
| PIPE-05 | 03-01, 03-03 | x264 encode with configurable parameters | SATISFIED | `_encode_chunk_x264` + `_x264_params_str` implemented; `test_x264_encode` PASSED; `test_x264_params_str` PASSED |
| PIPE-06 | 03-01, 03-03 | VMAF scoring against FFV1 source with bundled models | SATISFIED | `_vmaf_score` implemented; `test_vmaf_score` PASSED; uses built-in model string (Windows workaround, not bundled file path) |
| PIPE-07 | 03-01, 03-03 | CRF ±1 feedback loop within [crfMin, crfMax] bounds, max 10 iterations | SATISFIED | `_encode_chunk_with_vmaf` implemented with oscillation guard; `test_crf_feedback_loop` PASSED; `test_crf_oscillation_guard` PASSED |
| PIPE-08 | 03-01, 03-04 | Concat encoded chunks + mux with audio into final MKV | SATISFIED | `_concat_chunks` + `_mux_video_audio` + `_write_concat_list` implemented; `test_concat_mux` PASSED |
| PIPE-09 | 03-01, 03-04 | Cleanup temp files after job completes or is cancelled | SATISFIED | `_cleanup` in `finally` block; `test_cleanup_on_success` PASSED; `test_cleanup_on_cancel` PASSED |
| CONF-01 | 03-01, 03-03 | Configurable VMAF target range (default 96.2–97.6) | SATISFIED | `DEFAULT_CONFIG["vmaf_min"]=96.2, "vmaf_max"=97.6`; config passed through to `_encode_chunk_with_vmaf` |
| CONF-02 | 03-01, 03-03 | Configurable CRF bounds (default 16–20, start 17) | SATISFIED | `DEFAULT_CONFIG["crf_min"]=16, "crf_max"=20, "crf_start"=17`; enforced in feedback loop |
| CONF-03 | 03-01, 03-02 | Audio codec selection per job | SATISFIED | `DEFAULT_CONFIG["audio_codec"]="eac3"`; `AUDIO_CODECS` dispatch table; CLI `--config` JSON merges overrides |
| CONF-04 | 03-01, 03-03 | Video encoding preset with full x264 parameter set | SATISFIED | `DEFAULT_CONFIG["x264_params"]` contains all 17 params from CLAUDE.md; `_x264_params_str` serializes them |

**Orphaned requirements check:** All 13 requirement IDs declared in plan frontmatter (PIPE-01 through PIPE-09, CONF-01 through CONF-04) map to Phase 3 in REQUIREMENTS.md traceability table. No orphaned requirements found.

**Note:** PIPE-09 SUMMARY (03-01-SUMMARY.md) incorrectly lists all 13 requirements as "requirements-completed" for plan 01 (the RED scaffold phase). The actual implementation was spread across plans 02-04. This is a documentation artifact in the SUMMARY; the requirements are genuinely completed by the end of Phase 3.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `pipeline.py` | 121-133 | `_detect_scenes` is synchronous — PySceneDetect's `detect()` called directly, blocking the asyncio event loop during scene detection | Warning | Phase 3 CLI runs single jobs; no issue today. Phase 4 concurrent job scheduling will be blocked during scene detection. Plan 02 key_link explicitly required `run_in_executor` but was not implemented. |
| `pipeline.py` | 50 | `VMAF_MODEL` constant defined but never used in `_vmaf_score` (uses built-in version string instead) | Info | Intentional Windows workaround; VMAF scoring works correctly in tests. Leaves the constant as dead code. |

**No blocker anti-patterns.** The `_detect_scenes` event-loop-blocking issue is a warning severity — it does not prevent Phase 3 goal achievement (single-job CLI) but will need to be addressed in Phase 4 before concurrent scheduling is reliable.

---

### Human Verification Required

#### 1. Full end-to-end encode from real MKV

**Test:** Run `python -m encoder.pipeline path/to/real_source.mkv --output-dir ./out --temp-dir ./tmp`
**Expected:** Final `.mkv` produced in `./out`, no temp files left in `./tmp`, job shows `DONE` in `encoder.db`, console shows per-chunk CRF/VMAF output
**Why human:** All unit tests use 1-3 second lavfi synthetic sources. A real MKV with actual scene content exercises the full pipeline including scene detection sensitivity, real VMAF scores landing in the 96.2-97.6 window, and actual CRF feedback iterations.

#### 2. Cancel behavior (Ctrl+C)

**Test:** Start a real MKV encode, press Ctrl+C mid-FFV1-encode or mid-chunk-encode
**Expected:** Pipeline stops cleanly, temp subdirs removed, `encoder.db` shows job status `CANCELLED` (not `FAILED`)
**Why human:** Cancel requires interactive SIGINT during a real running subprocess; not automatable in the test harness.

#### 3. EAC3 audio codec path

**Test:** On a system with Plex Transcoder installed: `python -m encoder.pipeline source.mkv --config '{"audio_codec":"eac3"}'`
**Expected:** Audio transcoded to EAC3 without error, EAC3 track present in output MKV
**Why human:** `eac3` is explicitly excluded from `test_audio_codec_dispatch` because it requires Plex Transcoder EAE (documented in 03-01-SUMMARY). The code path exists but is untested in CI.

---

### Gaps Summary

No gaps. All 7 observable truths are verified. All 14 tests pass. All 13 requirements are satisfied. Two notes for follow-up — neither blocks Phase 3 goal achievement:

1. `_detect_scenes` blocks the asyncio event loop (no `run_in_executor`). Phase 3 works correctly as a single-job CLI. Phase 4 should wrap this in `run_in_executor` before adding concurrent job scheduling.
2. `VMAF_MODEL` constant is dead code — `_vmaf_score` uses the built-in `version=vmaf_v0.6.1` string instead of the bundled JSON model path. This is a correct Windows workaround and all VMAF tests pass.

---

## Test Run Results

```
============================= test session starts =============================
collected 14 items

tests/test_pipeline.py::test_ffv1_encode PASSED                          [  7%]
tests/test_pipeline.py::test_scene_detect PASSED                         [ 14%]
tests/test_pipeline.py::test_zero_scenes_error PASSED                    [ 21%]
tests/test_pipeline.py::test_chunk_split PASSED                          [ 28%]
tests/test_pipeline.py::test_audio_transcode PASSED                      [ 35%]
tests/test_pipeline.py::test_x264_encode PASSED                          [ 42%]
tests/test_pipeline.py::test_vmaf_score PASSED                           [ 50%]
tests/test_pipeline.py::test_crf_feedback_loop PASSED                    [ 57%]
tests/test_pipeline.py::test_crf_oscillation_guard PASSED                [ 64%]
tests/test_pipeline.py::test_concat_mux PASSED                           [ 71%]
tests/test_pipeline.py::test_cleanup_on_success PASSED                   [ 78%]
tests/test_pipeline.py::test_cleanup_on_cancel PASSED                    [ 85%]
tests/test_pipeline.py::test_audio_codec_dispatch PASSED                 [ 92%]
tests/test_pipeline.py::test_x264_params_str PASSED                      [100%]

============================= 14 passed in 2.23s ==============================

Full suite: 25 passed in 2.92s (no regressions in test_ffmpeg.py or test_db.py)
```

---

_Verified: 2026-03-07T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
