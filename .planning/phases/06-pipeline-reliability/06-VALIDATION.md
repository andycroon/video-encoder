---
phase: 6
slug: pipeline-reliability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (existing, confirmed in tests/) |
| **Config file** | none — invoked directly |
| **Quick run command** | `pytest tests/test_pipeline.py -x -q` |
| **Full suite command** | `pytest tests/ -x -q` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/test_pipeline.py -x -q`
- **After every plan wave:** Run `pytest tests/ -x -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | PIPE-V2-03 | unit | `pytest tests/test_pipeline.py::test_crf_oscillation_best_selection -x` | W0 (Plan 01 Task 1 creates) | pending |
| 06-01-02 | 01 | 1 | PIPE-V2-03 | unit | `pytest tests/test_pipeline.py::test_crf_oscillation_reencodes_winner -x` | W0 (Plan 01 Task 1 creates) | pending |
| 06-02-01 | 02 | 1 | PIPE-V2-02 | unit | `pytest tests/test_pipeline.py::test_resume_skips_done_steps -x` | W0 (Plan 02 Task 2 creates) | pending |
| 06-02-02 | 02 | 1 | PIPE-V2-02 | unit | `pytest tests/test_pipeline.py::test_resume_deletes_partial_chunk -x` | W0 (Plan 02 Task 2 creates) | pending |
| 06-02-03 | 02 | 1 | PIPE-V2-02 | unit | `pytest tests/test_db.py::test_recover_stale_sets_resuming -x` | W0 (Plan 02 Task 1 creates) | pending |
| 06-03-01 | 03 | 2 | PIPE-V2-01 | integration | `pytest tests/test_pipeline.py::test_parallel_faster_than_serial -x` | Plan 03 Task 3 creates | pending |
| 06-03-02 | 03 | 2 | PIPE-V2-01 | integration | `pytest tests/test_pipeline.py::test_parallel_cancel_no_orphans -x` | Plan 03 Task 3 creates | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_pipeline.py` — Plan 01 Task 1 creates 2 CRF oscillation test stubs (RED state)
- [ ] `tests/test_pipeline.py` — Plan 02 Task 2 creates 2 resume test functions
- [ ] `tests/test_db.py` — Plan 02 Task 1 creates `test_recover_stale_sets_resuming`
- [ ] `tests/test_pipeline.py` — Plan 03 Task 3 creates 2 parallel encoding integration tests

*Existing infrastructure covers fixtures — `_make_video`, `ffmpeg_bin`, and `tmp` are all reusable. No new conftest.py needed.*

*Note: PIPE-V2-01 tests (test_parallel_faster_than_serial, test_parallel_cancel_no_orphans) are created by Plan 03 Task 3, which runs after Tasks 1-2 implement the parallel encoding feature. This is acceptable because Task 3 tests the handle registration/cancel contract and parallelism performance — both require the implementation to exist first.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI shows RESUMING badge (amber) when recovered job is pending | PIPE-V2-02 | Visual UI assertion | Crash a running job, restart app, confirm RESUMING badge appears in amber before job starts running |
| Parallel chunks show N simultaneous running indicators in ChunkTable | PIPE-V2-01 | Visual UI assertion | Submit multi-chunk job with max_parallel_chunks=2; observe 2 rows with running indicators simultaneously |
| SettingsModal max_parallel_chunks input respects CPU count max | PIPE-V2-01 | Browser interaction | Open SettingsModal, verify max attribute on input equals os.cpu_count() |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
