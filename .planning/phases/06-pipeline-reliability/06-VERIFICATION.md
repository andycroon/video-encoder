---
phase: 06-pipeline-reliability
verified: 2026-03-17T00:00:00Z
status: passed
score: 10/10 must-haves verified
re_verification: null
gaps: []
human_verification: []
---

# Phase 6: Pipeline Reliability Verification Report

**Phase Goal:** Pipeline Reliability — CRF oscillation resolution, job resume on crash, parallel chunk encoding
**Verified:** 2026-03-17
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | CRF oscillation exits with the encode whose VMAF is closest to center of window | VERIFIED | `vmaf_history` + `min(..., key=lambda h: (abs(h[1] - center), h[0]))` at pipeline.py:424-427 |
| 2  | When two candidates are equidistant from center, lower CRF wins | VERIFIED | Tiebreak is `h[0]` (CRF) in the `min` key; `test_crf_oscillation_best_selection` passes with CRF 16 asserted |
| 3  | If best entry was not the last encode written, a re-encode produces the correct file | VERIFIED | `if best_crf != vmaf_history[-1][0]:` at pipeline.py:430; `test_crf_oscillation_reencodes_winner` confirms 4 calls, last CRF=16 |
| 4  | A crashed RUNNING job resumes from its last fully completed pipeline step | VERIFIED | `completed_steps` set built from `get_steps` at pipeline.py:550-551; each step gated by `if "StepName" not in completed_steps` |
| 5  | Steps already marked DONE are skipped and not re-executed on resume | VERIFIED | `test_resume_skips_done_steps` passes: `mock_ffv1.assert_not_called()` confirmed |
| 6  | Chunks with status != DONE are re-encoded with partial output deleted first | VERIFIED | `chunk_out.unlink(missing_ok=True)` at pipeline.py:688; `test_resume_deletes_partial_chunk` passes |
| 7  | recover_stale_jobs sets status to RESUMING (not QUEUED) | VERIFIED | `UPDATE jobs SET status='RESUMING'` at db.py:217; `test_recover_stale_sets_resuming` passes |
| 8  | Scheduler accepts RESUMING jobs for execution | VERIFIED | `if job["status"] not in ("QUEUED", "RESUMING"):` at scheduler.py:90 |
| 9  | With concurrency >= 2, multiple chunks encode simultaneously | VERIFIED | `ThreadPoolExecutor(max_workers=max_parallel)` at pipeline.py:783; `test_parallel_faster_than_serial` passes |
| 10 | Cancelling a job with parallel chunks signals all active ffmpeg processes via registered handles | VERIFIED | `_cancel_all_handles()` calls `handle.cancel()` at pipeline.py:671-678; `test_parallel_cancel_no_orphans` passes |

**Score:** 10/10 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts (PIPE-V2-03 — CRF Oscillation)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/encoder/pipeline.py` | `_encode_chunk_with_vmaf` using `vmaf_history` list | VERIFIED | `vmaf_history: list[tuple[int, float]] = []` at line 387; `visited_crfs` absent |
| `tests/test_pipeline.py` | Unit tests for CRF oscillation best-selection and re-encode | VERIFIED | `test_crf_oscillation_best_selection` at line 277; `test_crf_oscillation_reencodes_winner` at line 301 |

#### Plan 02 Artifacts (PIPE-V2-02 — Job Resume)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/encoder/pipeline.py` | Resume gate building `completed_steps` set | VERIFIED | `completed_steps: set[str]` at line 551; `completed_chunk_indices: set[int]` at line 554 |
| `src/encoder/db.py` | `recover_stale_jobs` sets RESUMING; `PRAGMA busy_timeout` | VERIFIED | `status='RESUMING'` at line 217; `PRAGMA busy_timeout = 5000` at line 80 |
| `src/encoder/scheduler.py` | Accepts RESUMING in `_run_job` guard | VERIFIED | `("QUEUED", "RESUMING")` at line 90 |
| `frontend/src/types/index.ts` | RESUMING in JobStatus union | VERIFIED | `'RESUMING'` present at line 1 |
| `frontend/src/components/StatusBadge.tsx` | RESUMING entry with amber color and pulse | VERIFIED | `RESUMING: { color: '#fbbf24', bg: '#1c1600', border: '#78350f', label: 'Resuming', pulse: true }` at line 7 |
| `tests/test_db.py` | `test_recover_stale_sets_resuming` | VERIFIED | Present at line 176; passes |

#### Plan 03 Artifacts (PIPE-V2-01 — Parallel Encoding)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/encoder/pipeline.py` | `ThreadPoolExecutor` for parallel chunk encoding | VERIFIED | `ThreadPoolExecutor(max_workers=max_parallel)` at line 783 |
| `src/encoder/pipeline.py` | `_register_handle` called inside `_worker_encode_chunk` | VERIFIED | `_register_handle(chunk_index, proc)` via `_on_encode_started` callback at line 712 |
| `src/encoder/main.py` | `GET /api/system` returning `cpu_count` | VERIFIED | `@api.get("/system")` + `os.cpu_count()` at lines 277-280 |
| `frontend/src/api/settings.ts` | `max_parallel_chunks` in Settings interface | VERIFIED | `max_parallel_chunks: number` at line 13 |
| `frontend/src/components/SettingsModal.tsx` | Max parallel encoders input capped at cpu_count | VERIFIED | `fetch('/api/system')` at line 24; `max_parallel_chunks` input at line 123 |
| `tests/test_pipeline.py` | `test_parallel_cancel_no_orphans` and `test_parallel_faster_than_serial` | VERIFIED | Both present (lines 593, 649) and pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pipeline.py _encode_chunk_with_vmaf` | `_encode_chunk_x264` re-encode call | `best_crf != vmaf_history[-1][0]` | WIRED | Line 430: condition triggers final re-encode with winner CRF |
| `db.py recover_stale_jobs` | `scheduler.py _run_job` guard | RESUMING status flows through | WIRED | db.py sets RESUMING; scheduler.py accepts `("QUEUED", "RESUMING")` |
| `pipeline.py run_pipeline` | `db.py get_steps / get_chunks` | Builds `completed_steps` set | WIRED | `existing_steps = await get_steps(...)` at line 550; `existing_chunks = await get_chunks(...)` at line 553 |
| `pipeline.py ThreadPoolExecutor` | `asyncio.run_coroutine_threadsafe` | Worker threads bridge async DB calls | WIRED | `asyncio.run_coroutine_threadsafe(update_chunk(...), loop)` at line 731 |
| `pipeline.py _worker_encode_chunk` | `_register_handle / _unregister_handle` | `on_started` callback registers FfmpegProcess; `finally` unregisters | WIRED | `_on_encode_started` at line 711; `_unregister_handle(chunk_index)` in `finally` at line 721 |
| `pipeline.py _cancel_all_handles` | `FfmpegProcess.cancel()` | Iterates `_chunk_handles` values and calls `.cancel()` | WIRED | Lines 671-678: `handle.cancel()` called on each registered process |
| `SettingsModal.tsx` | `/api/system` | Fetches `cpu_count` on modal open to cap input max | WIRED | `fetch('/api/system')` at line 24; `max={cpuCount ?? undefined}` at line 120 |
| `main.py submit_job` | `config_snapshot` | `max_parallel_chunks` included from settings | WIRED | `"max_parallel_chunks": settings.get("max_parallel_chunks", 1)` at line 117 |
| `main.py lifespan` | RESUMING jobs re-enqueued on startup | `list_jobs(status="RESUMING")` loop | WIRED | Lines 48-50: RESUMING jobs fetched and enqueued on app start |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIPE-V2-01 | 06-03-PLAN.md | Multiple chunks encode in parallel (configurable concurrency) | SATISFIED | `ThreadPoolExecutor(max_workers=max_parallel)` in pipeline.py; `max_parallel_chunks` in settings, db, main, frontend |
| PIPE-V2-02 | 06-02-PLAN.md | Job resumes from last completed step after crash/restart | SATISFIED | `completed_steps` gate in run_pipeline; `recover_stale_jobs` sets RESUMING; scheduler and main.py re-enqueue RESUMING jobs |
| PIPE-V2-03 | 06-01-PLAN.md | CRF oscillation picks encode closest to window center; lower CRF tiebreak | SATISFIED | `vmaf_history` + `min(key=lambda h: (abs(h[1] - center), h[0]))` + re-encode if last != best |

All 3 requirement IDs declared in plan frontmatter are satisfied. No orphaned requirements found — REQUIREMENTS.md maps PIPE-V2-01, PIPE-V2-02, PIPE-V2-03 exclusively to Phase 6.

---

### Anti-Patterns Found

No blockers or warnings found.

Scanned all modified files for stubs, TODO comments, empty returns, and placeholder patterns:

- `src/encoder/pipeline.py` — No TODO/FIXME/placeholder. All implementations substantive.
- `src/encoder/db.py` — No TODO/FIXME/placeholder. All implementations substantive.
- `src/encoder/scheduler.py` — No TODO/FIXME/placeholder.
- `src/encoder/main.py` — No TODO/FIXME/placeholder.
- `frontend/src/types/index.ts` — No issues.
- `frontend/src/components/StatusBadge.tsx` — No issues.
- `frontend/src/api/settings.ts` — No issues.
- `frontend/src/components/SettingsModal.tsx` — No issues.

---

### Test Results

All 7 phase-06 targeted tests pass:

```
tests/test_pipeline.py::test_crf_oscillation_best_selection   PASSED
tests/test_pipeline.py::test_crf_oscillation_reencodes_winner PASSED
tests/test_pipeline.py::test_resume_skips_done_steps          PASSED
tests/test_pipeline.py::test_resume_deletes_partial_chunk     PASSED
tests/test_pipeline.py::test_parallel_cancel_no_orphans       PASSED
tests/test_pipeline.py::test_parallel_faster_than_serial      PASSED
tests/test_db.py::test_recover_stale_sets_resuming            PASSED
7 passed in 2.23s
```

Frontend build: clean (exit 0, no TypeScript errors).

---

### Human Verification Required

None. All goal behaviors are verifiable by code inspection and unit tests.

Note for optional manual confirmation: to observe parallel encoding in practice, configure `max_parallel_chunks > 1` in Settings, submit a job, and confirm multiple `chunk_encode` SSE events arrive simultaneously for different `chunk_index` values. This is integration behavior that automated tests approximate via `test_parallel_faster_than_serial`.

---

## Summary

Phase 6 goal is fully achieved. All three v1.1 pipeline reliability requirements are satisfied:

- **PIPE-V2-03** (CRF oscillation): `vmaf_history` replaces `visited_crfs`. The best encode is selected by closest VMAF to window center, lower CRF tiebreak. Re-encode fires when the winner was not the last file on disk.
- **PIPE-V2-02** (Job resume): `recover_stale_jobs` sets RESUMING; startup re-enqueues RESUMING jobs; `run_pipeline` builds `completed_steps` and `completed_chunk_indices` sets and gates every step; partial chunk files deleted before re-encode.
- **PIPE-V2-01** (Parallel encoding): Inner `ThreadPoolExecutor` runs `_worker_encode_chunk_threaded` workers in parallel; handles registered/unregistered for cancel; `_cancel_all_handles` calls `.cancel()` gracefully; frontend `SettingsModal` exposes `max_parallel_chunks` capped at `cpu_count` from `/api/system`.

---

_Verified: 2026-03-17_
_Verifier: Claude (gsd-verifier)_
