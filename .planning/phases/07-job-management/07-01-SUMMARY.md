---
phase: 07-job-management
plan: "01"
subsystem: backend
tags: [delete, cleanup, api, sqlite, background-task]
dependency_graph:
  requires: [06-pipeline-reliability]
  provides: [delete_job, delete_jobs_by_status, auto_cleanup_jobs, DELETE /api/jobs/{id}, DELETE /api/jobs/bulk, AutoCleanup]
  affects: [src/encoder/db.py, src/encoder/main.py, src/encoder/cleanup.py]
tech_stack:
  added: [httpx (dev dep for TestClient)]
  patterns: [manual cascade delete, asyncio background task, route registration order for path param conflicts]
key_files:
  created:
    - src/encoder/cleanup.py
    - tests/test_api_delete.py
  modified:
    - src/encoder/db.py
    - src/encoder/main.py
    - pyproject.toml
    - tests/test_db.py
decisions:
  - "Manual child-row deletion (chunks, steps) before job row — schema lacks ON DELETE CASCADE and SQLite does not support ALTER CONSTRAINT"
  - "DELETE /api/jobs/bulk registered before DELETE /api/jobs/{job_id} to prevent FastAPI parsing 'bulk' as integer and returning 422"
  - "delete_or_cancel_job always purges from DB (active jobs are cancelled then purged, not just status-updated)"
  - "AutoCleanup uses CLEANUP_INTERVAL=3600s (hourly) matching the delete threshold granularity"
metrics:
  duration: "3 min"
  completed: "2026-03-17"
  tasks_completed: 2
  files_changed: 6
---

# Phase 7 Plan 01: Backend Delete Infrastructure Summary

Backend delete infrastructure with manual cascade, bulk delete API, and hourly auto-cleanup background task.

## What Was Built

### db.py additions
- `PRAGMA foreign_keys = ON` added to `get_db()` — enforces FK constraints per-connection going forward
- `auto_cleanup_hours: "168"` added to `SETTINGS_DEFAULTS` (7-day default) with int coercion in `_SETTINGS_INT_KEYS`
- `delete_job(path, job_id) -> bool` — manually deletes chunks and steps rows before the jobs row; returns False if not found
- `delete_jobs_by_status(path, status) -> int` — collects IDs, bulk-deletes children, then jobs; returns count
- `auto_cleanup_jobs(path) -> int` — reads `auto_cleanup_hours` setting, queries DONE jobs older than threshold, cascades delete; no-op when hours=0

### cleanup.py (new)
- `AutoCleanup` class following the same asyncio.Task lifecycle pattern as `WatchFolder`
- Polls every `CLEANUP_INTERVAL=3600` seconds; logs when jobs are removed; swallows non-cancel exceptions

### main.py changes
- Imports `AutoCleanup`, `delete_job`, `delete_jobs_by_status`
- `AutoCleanup` started/stopped in lifespan with shutdown order: watcher → cleaner → scheduler
- `BulkDeleteBody(BaseModel)` with `status: str` field
- `DELETE /api/jobs/bulk` registered BEFORE `DELETE /api/jobs/{job_id}` — critical for FastAPI route matching
- Existing `cancel_job` replaced by `delete_or_cancel_job`: terminal-state jobs are purged directly; active jobs are cancelled then purged

## Tests

13 db tests (8 pre-existing + 5 new), 5 API integration tests — all passing (18 total).

New db tests: `test_delete_job_cascades`, `test_delete_job_not_found`, `test_delete_jobs_by_status`, `test_auto_cleanup_jobs`, `test_auto_cleanup_disabled`

New API tests: `test_delete_terminal_job`, `test_delete_nonexistent_job`, `test_bulk_delete`, `test_bulk_delete_invalid_status`, `test_bulk_route_not_swallowed`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing httpx dependency for FastAPI TestClient**
- **Found during:** Task 2
- **Issue:** `fastapi.testclient.TestClient` requires `httpx` but it was absent from the environment and not listed in pyproject.toml dev deps
- **Fix:** Installed httpx; added `httpx>=0.27` to `[project.optional-dependencies] dev` in pyproject.toml
- **Files modified:** pyproject.toml
- **Commit:** cbdd525

## Self-Check: PASSED

- src/encoder/cleanup.py: FOUND
- tests/test_api_delete.py: FOUND
- 07-01-SUMMARY.md: FOUND
- Commit 4a70c81 (Task 1): FOUND
- Commit cbdd525 (Task 2): FOUND
