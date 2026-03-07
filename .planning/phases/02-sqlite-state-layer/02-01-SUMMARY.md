---
phase: 02-sqlite-state-layer
plan: "01"
subsystem: database
tags: [sqlite, aiosqlite, tdd, async, state-layer]

# Dependency graph
requires:
  - phase: 01-subprocess-foundation
    provides: src-layout package structure, established no-mock test philosophy with asyncio.run()
provides:
  - "src/encoder/db.py: 15 public async stubs defining the full CRUD API for Phase 3+"
  - "tests/test_db.py: 7 RED integration test specs defining QUEUE-05 behavior contract"
  - "aiosqlite>=0.22,<0.23 runtime dependency declared and installed"
affects: [03-pipeline-runner, 04-web-api, 05-react-ui]

# Tech tracking
tech-stack:
  added: [aiosqlite 0.22.1]
  patterns:
    - "All DB functions are async, accept path: str as first arg, use aiosqlite internally"
    - "Tests use real SQLite via tmp_path fixture with asyncio.run() wrappers (no mocking)"
    - "Config stored as JSON blob in TEXT column, deserialized to dict on read"

key-files:
  created:
    - src/encoder/db.py
    - tests/test_db.py
  modified:
    - pyproject.toml

key-decisions:
  - "aiosqlite>=0.22,<0.23 placed in [project] dependencies (not dev) — runtime dependency for Phase 3+"
  - "HEARTBEAT_STALE_SECONDS=60 exported as module-level constant so tests and callers can reference threshold"
  - "All 15 stubs raise NotImplementedError — ensures no stub is accidentally permissive at RED stage"
  - "update_chunk uses keyword-only args (*, crf_used, vmaf_score, iterations, status) to prevent positional errors"

patterns-established:
  - "DB API pattern: async def fn(path: str, ...) -> T — no connection object passed around; each function opens/closes connection"
  - "TDD RED state: tests import successfully, stubs raise NotImplementedError immediately on first await"

requirements-completed: [QUEUE-05]

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 2 Plan 01: SQLite State Layer (RED Specs) Summary

**aiosqlite 0.22.1 added, db.py skeleton with 15 async stubs, and 7 RED integration test specs defining the full QUEUE-05 database contract**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T17:45:38Z
- **Completed:** 2026-03-07T17:47:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `aiosqlite>=0.22,<0.23` to `[project]` dependencies in pyproject.toml and verified version 0.22.1 installs and imports cleanly
- Created `src/encoder/db.py` with all 15 public async stub functions and the `HEARTBEAT_STALE_SECONDS = 60` constant, all raising `NotImplementedError`
- Created `tests/test_db.py` with 7 integration tests covering job persistence, WAL mode, stale recovery, chunk CRUD, step CRUD, log appending, and config round-trip — all 7 fail RED with `NotImplementedError`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add aiosqlite dependency and install it** - `5e7b0c4` (chore)
2. **Task 2: Write test_db.py (RED state) and db.py skeleton** - `806ff75` (test)

## Files Created/Modified

- `pyproject.toml` - Added `dependencies = ["aiosqlite>=0.22,<0.23"]` to `[project]` section
- `src/encoder/db.py` - New module: 15 async stub functions + HEARTBEAT_STALE_SECONDS constant, all raise NotImplementedError
- `tests/test_db.py` - New test file: 7 integration test specs for QUEUE-05 behaviors using real SQLite + asyncio.run()

## Decisions Made

- `aiosqlite>=0.22,<0.23` goes in `[project] dependencies` not `[project.optional-dependencies].dev` — it's a runtime dependency since Phase 3 pipeline code calls db.py in production
- `update_chunk` uses keyword-only arguments (`*`) after `chunk_id` to prevent accidental positional argument errors when passing CRF, VMAF, iterations
- `HEARTBEAT_STALE_SECONDS = 60` exported as module-level constant so Phase 3/4 callers and tests can reference the threshold symbolically
- All stubs raise `NotImplementedError` immediately (before any argument processing) to ensure RED state is unambiguous

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. `import aiosqlite` warnings (`Could not find platform independent libraries <prefix>`) appear due to Python 3.13 installed without standard library prefix; they are cosmetic and do not affect functionality.

## Next Phase Readiness

- Plan 02-02 (GREEN implementation) has the full test contract it needs — 7 specs covering all CRUD surfaces
- Phase 3 (Pipeline Runner) has the stable public API it depends on: 15 function signatures with exact names, arg types, and return types locked
- No blockers for proceeding to GREEN implementation

## Self-Check: PASSED

- src/encoder/db.py: FOUND
- tests/test_db.py: FOUND
- .planning/phases/02-sqlite-state-layer/02-01-SUMMARY.md: FOUND
- commit 5e7b0c4 (chore: aiosqlite dependency): FOUND
- commit 806ff75 (test: RED specs + db.py skeleton): FOUND

---
*Phase: 02-sqlite-state-layer*
*Completed: 2026-03-07*
