---
phase: 04-web-api-scheduler
plan: 02
subsystem: api
tags: [fastapi, asyncio, scheduler, threading, jobs, rest]

# Dependency graph
requires:
  - phase: 04-01
    provides: FastAPI app skeleton, DB_PATH, init_db, recover_stale_jobs, settings endpoints
  - phase: 03-pipeline-runner
    provides: run_pipeline async entry point, DEFAULT_CONFIG dict

provides:
  - Scheduler class with serial asyncio queue, ThreadPoolExecutor, cancel_events registry
  - Seven job REST endpoints (POST/GET/PATCH/DELETE/retry) wired to Scheduler
  - Job lifecycle management: QUEUED -> RUNNING -> DONE/FAILED/CANCELLED/PAUSED
  - Disk space preflight warning on job start

affects: [04-03-sse, 05-react-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scheduler lives in app.state.scheduler, accessed via request.app.state in endpoints"
    - "run_pipeline wrapped in _run_pipeline_sync for ThreadPoolExecutor (new event loop per job)"
    - "cancel_events dict maps job_id -> threading.Event for cross-thread cancellation"
    - "config_snapshot at submit time: settings defaults + per-job overrides merged"

key-files:
  created:
    - src/encoder/scheduler.py
  modified:
    - src/encoder/main.py

key-decisions:
  - "Scheduler._run_job checks job config as dict first (get_job already deserializes config from JSON) before fallback json.loads"
  - "retry endpoint returns 201 and creates a new job row rather than resetting the original — preserves original job history"
  - "pause() only marks the job in _paused_jobs set — actual pause enforcement is pipeline's responsibility via cancel_event polling (Phase 3 decision)"
  - "Disk preflight warns but never blocks — proceed regardless of free space, surface via log"

patterns-established:
  - "request.app.state.scheduler: access scheduler from any endpoint via Request parameter"
  - "threading.Event in _cancel_events: signal cancellation from async HTTP layer to sync pipeline thread"
  - "Lifespan re-enqueues QUEUED jobs on startup: resilience across server restarts"

requirements-completed: [QUEUE-06, PROG-05]

# Metrics
duration: 7min
completed: 2026-03-08
---

# Phase 4 Plan 02: Job Scheduler and REST Endpoints Summary

**Serial asyncio Scheduler with threading.Event cancel registry and seven job management REST endpoints (submit/list/get/pause/cancel/retry) fully wired to FastAPI lifespan**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-08T09:37:51Z
- **Completed:** 2026-03-08T09:44:51Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `Scheduler` class: asyncio.Queue consumer, single ThreadPoolExecutor worker, threading.Event cancel registry, disk preflight
- Extended `main.py` with seven job endpoints covering the full job lifecycle
- Server verified end-to-end: POST /jobs triggers scheduler pickup within ~200ms, DELETE /jobs/1 signals cancel_event, POST /jobs/1/retry creates new job from CANCELLED
- Lifespan re-enqueues surviving QUEUED jobs on startup for restart resilience

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scheduler.py** - `4584583` (feat)
2. **Task 2: Add job REST endpoints to main.py** - `b4d7719` (feat)

## Files Created/Modified

- `src/encoder/scheduler.py` - Scheduler class: asyncio queue, worker loop, cancel_event registry, disk preflight
- `src/encoder/main.py` - Extended with Scheduler lifespan wiring and seven job REST endpoints

## Decisions Made

- `get_job` already deserializes config from JSON (returns dict), so `_run_job` checks `isinstance(job["config"], dict)` before fallback `json.loads` to avoid double-decode
- retry endpoint uses 201 status and creates a new job row (preserves original job history intact)
- pause() only registers in `_paused_jobs` set — actual enforcement is pipeline-side via cancel_event polling (consistent with Phase 3 sync pattern)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Job scheduler and all REST endpoints complete — encoding is fully testable with curl
- Plan 04-03 (SSE progress streaming) can attach to the existing job/chunk DB rows
- Plan 04-04 (watch folder + disk check) can use Scheduler.enqueue() directly

---
*Phase: 04-web-api-scheduler*
*Completed: 2026-03-08*
