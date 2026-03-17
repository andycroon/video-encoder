---
phase: 06-pipeline-reliability
plan: "02"
subsystem: pipeline-resume
tags: [resume, crash-recovery, sqlite, frontend, status]
dependency_graph:
  requires: []
  provides: [job-resume, resuming-status, busy-timeout, max-parallel-chunks-setting]
  affects: [pipeline.py, db.py, scheduler.py, main.py, StatusBadge, JobRow, types]
tech_stack:
  added: []
  patterns: [resume-gate, completed-steps-set, partial-file-cleanup, conditional-step-execution]
key_files:
  created: []
  modified:
    - src/encoder/pipeline.py
    - src/encoder/db.py
    - src/encoder/scheduler.py
    - src/encoder/main.py
    - frontend/src/types/index.ts
    - frontend/src/components/StatusBadge.tsx
    - frontend/src/components/JobRow.tsx
    - tests/test_pipeline.py
    - tests/test_db.py
decisions:
  - "SceneDetect re-runs on resume (fast) to provide timestamps needed for ChunkSplit path"
  - "ChunkEncode step ID is looked up from existing_steps when already present in DB, avoiding duplicate step rows"
  - "JobRow.tsx STATUS_BORDER updated as auto-fix (Rule 2) — TypeScript Record exhaustiveness required it"
metrics:
  duration: "5 minutes"
  completed: "2026-03-17"
  tasks_completed: 2
  files_modified: 9
---

# Phase 6 Plan 02: Pipeline Resume Summary

Job resume capability so a crash mid-encode resumes from the last fully completed step instead of restarting from FFV1.

## What Was Built

### Task 1: Backend Resume Infrastructure

**src/encoder/db.py:**
- `recover_stale_jobs` now sets `status='RESUMING'` instead of `status='QUEUED'` so the UI shows recovery state and the pipeline can read existing steps on re-run
- `PRAGMA busy_timeout = 5000` added to `get_db()` after WAL pragma — prevents lock contention errors when parallel chunk writers compete
- `"max_parallel_chunks": "1"` added to `SETTINGS_DEFAULTS` and `"max_parallel_chunks"` added to `_SETTINGS_INT_KEYS` — prerequisite for Phase 6 Plan 3 (parallel encoding)

**src/encoder/scheduler.py:**
- `_run_job` status guard expanded from `("QUEUED",)` to `("QUEUED", "RESUMING")` so recovered jobs enter the execution path

**src/encoder/main.py:**
- Lifespan now re-enqueues `RESUMING` jobs alongside `QUEUED` jobs on startup

**tests/test_db.py:**
- `test_recover_stale_sets_resuming` added — verifies status is `RESUMING` after recovery
- `test_stale_job_recovery` updated — was asserting `QUEUED`; updated to `RESUMING` to match new behavior

### Task 2: Pipeline Resume Gate + Frontend RESUMING Status

**src/encoder/pipeline.py:**
- Resume gate added at top of `run_pipeline` after directory creation:
  - `completed_steps: set[str]` built from DB steps with `status == "DONE"`
  - `completed_chunk_indices: set[int]` built from DB chunks with `status == "DONE"`
  - `is_resuming = bool(completed_steps)` logged when resuming
- Each pipeline step wrapped in `if "StepName" not in completed_steps:` guard (FFV1, SceneDetect, ChunkSplit, AudioTranscode, Concat, Mux)
- SceneDetect re-runs on resume without creating a new step row — necessary to get timestamps for ChunkSplit
- ChunkSplit resume path globs existing `chunk*.mov` files; raises `PipelineError` if none found
- AudioTranscode resume path derives `audio_file` path without re-transcoding
- Chunk encode loop: skips chunks in `completed_chunk_indices`; calls `chunk_out.unlink(missing_ok=True)` before re-encoding incomplete chunks
- Concat resume path sets `concat_mp4` path for Mux without re-running
- ChunkEncode step ID looked up from `existing_steps` when step was previously created

**frontend/src/types/index.ts:**
- `'RESUMING'` added to `JobStatus` union type

**frontend/src/components/StatusBadge.tsx:**
- `RESUMING` entry added to `CFG` dict: amber-400 color `#fbbf24`, dark amber bg `#1c1600`, amber-900 border `#78350f`, `pulse: true`

**tests/test_pipeline.py:**
- `test_resume_skips_done_steps` — mocks `get_steps` returning FFV1/SceneDetect/ChunkSplit/AudioTranscode all DONE, asserts `_ffv1_encode` was NOT called
- `test_resume_deletes_partial_chunk` — creates a fake partial output file, asserts it is deleted before re-encoding (unlinked)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] JobRow.tsx STATUS_BORDER missing RESUMING entry**
- **Found during:** Task 2 (frontend build)
- **Issue:** `STATUS_BORDER: Record<JobStatus, string>` is exhaustive by TypeScript; adding RESUMING to the union caused a compile error
- **Fix:** Added `RESUMING: '#d97706'` (amber-600) to match StatusBadge amber family
- **Files modified:** `frontend/src/components/JobRow.tsx`
- **Commit:** c034875

**2. [Rule 1 - Bug] test_stale_job_recovery asserted old QUEUED status**
- **Found during:** Task 1 (after changing recover_stale_jobs)
- **Issue:** Existing test asserted `result["status"] == "QUEUED"` but behavior changed to RESUMING
- **Fix:** Updated assertion to `RESUMING` to match new correct behavior
- **Files modified:** `tests/test_db.py`
- **Commit:** 6488183

## Self-Check: PASSED

- Commit 6488183 (Task 1): FOUND
- Commit c034875 (Task 2): FOUND
- SUMMARY.md: FOUND
- `completed_steps` in pipeline.py: FOUND
- `RESUMING` in db.py: FOUND
