---
phase: 3
slug: pipeline-runner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8.0 (already configured in pyproject.toml) |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` — already exists |
| **Quick run command** | `pytest tests/test_pipeline.py -x` |
| **Full suite command** | `pytest tests/ -v` |
| **Estimated runtime** | ~60 seconds (integration tests use synthetic lavfi sources) |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/test_pipeline.py -x`
- **After every plan wave:** Run `pytest tests/ -v`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-??-?? | 01 | 0 | PIPE-01..PIPE-09, CONF-01..CONF-04 | unit/integration | `pytest tests/test_pipeline.py -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-01 | integration | `pytest tests/test_pipeline.py::test_ffv1_encode -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-02 | integration | `pytest tests/test_pipeline.py::test_scene_detect -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-02 | unit | `pytest tests/test_pipeline.py::test_zero_scenes_error -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-03 | integration | `pytest tests/test_pipeline.py::test_chunk_split -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-04 | integration | `pytest tests/test_pipeline.py::test_audio_transcode -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-05 | integration | `pytest tests/test_pipeline.py::test_x264_encode -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-06 | integration | `pytest tests/test_pipeline.py::test_vmaf_score -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-07 | unit | `pytest tests/test_pipeline.py::test_crf_feedback_loop -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-07 | unit | `pytest tests/test_pipeline.py::test_crf_oscillation_guard -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-08 | integration | `pytest tests/test_pipeline.py::test_concat_mux -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-09 | integration | `pytest tests/test_pipeline.py::test_cleanup_on_success -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | PIPE-09 | integration | `pytest tests/test_pipeline.py::test_cleanup_on_cancel -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | CONF-01, CONF-02 | unit | `pytest tests/test_pipeline.py::test_crf_feedback_loop -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | CONF-03 | unit | `pytest tests/test_pipeline.py::test_audio_codec_dispatch -x` | Wave 0 | ⬜ pending |
| 3-??-?? | 01 | 1 | CONF-04 | unit | `pytest tests/test_pipeline.py::test_x264_params_str -x` | Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: Task IDs will be filled in by planner when PLAN.md files are created.*

---

## Wave 0 Requirements

- [ ] `tests/test_pipeline.py` — all test stubs (RED state initially): test_ffv1_encode, test_scene_detect, test_zero_scenes_error, test_chunk_split, test_audio_transcode, test_x264_encode, test_vmaf_score, test_crf_feedback_loop, test_crf_oscillation_guard, test_concat_mux, test_cleanup_on_success, test_cleanup_on_cancel, test_audio_codec_dispatch, test_x264_params_str
- [ ] `src/encoder/pipeline.py` — skeleton with `run_pipeline` raising `NotImplementedError`
- [ ] `assets/vmaf_v0.6.1.json` — already exists (confirmed in repo)
- [ ] `scenedetect[opencv]>=0.6.7,<0.7` added to `pyproject.toml` dependencies (if not already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EAC3 audio present and playable in final MKV | PIPE-04, CONF-03 | Requires installed ffmpeg with EAC3 encoder; skip in CI if unavailable | Run pipeline on 10s synthetic MKV with `audio_codec=eac3`; play final MKV and verify audio track |
| Terminal output format: per-step lines and per-chunk CRF/VMAF summary | PIPE-01..PIPE-08 | Visual/format check | Run pipeline; verify output matches `[FFV1] Encoding intermediate... done (Xs)` and `[Chunk N/M] CRF 17 -> VMAF 96.8 (pass)` patterns |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
