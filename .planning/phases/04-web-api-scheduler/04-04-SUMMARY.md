---
phase: 04-web-api-scheduler
plan: "04"
subsystem: watcher
tags: [watch-folder, asyncio, dedup, readme, lifespan]
dependency_graph:
  requires: [04-02]
  provides: [WatchFolder, seen_file, mark_file_seen]
  affects: [encoder.main, encoder.db, README.md]
tech_stack:
  added: []
  patterns: [asyncio background task, file stability polling, SQLite dedup]
key_files:
  created:
    - src/encoder/watcher.py
  modified:
    - src/encoder/db.py
    - src/encoder/main.py
    - README.md
decisions:
  - seen_files table uses (path, mtime) composite primary key — changing mtime naturally re-enqueues a re-copied or re-touched file
  - _is_stable() polls size every 2s for 5s total — handles slow NAS copies and large file transfers
  - WatchFolder.stop() awaits task cancellation — ensures clean shutdown without dangling tasks
  - get_settings() fetched fresh on each poll cycle — picks up watch_folder_path changes made via PUT /settings without restart
metrics:
  duration_seconds: 101
  completed_date: "2026-03-08"
  tasks_completed: 2
  files_modified: 4
---

# Phase 4 Plan 04: Watch Folder + README Summary

**One-liner:** WatchFolder asyncio background task polls for new MKV files every 10s with SQLite path+mtime dedup, wired into FastAPI lifespan alongside Scheduler.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | seen_files DB table + seen_file/mark_file_seen + WatchFolder class | cdbc4ae |
| 2 | Wire WatchFolder into lifespan + README Phase 4 section | d29cf38 |

## What Was Built

### src/encoder/watcher.py (new)

`WatchFolder` class with asyncio background task:
- `start()` / `stop()` — create/cancel asyncio.Task cleanly
- `_poll_loop()` — infinite loop catching non-CancelledError exceptions, sleeping POLL_INTERVAL (10s) between cycles
- `_poll_once()` — reads `watch_folder_path` from settings, globs `*.mkv`, checks seen_file dedup, runs stability check, calls create_job + mark_file_seen + scheduler.enqueue
- `_is_stable()` — polls file size every STABILITY_INTERVAL (2s) for STABILITY_REQUIRED (5s), returns True when stable
- OSError on folder access: logs warning and returns (retries next poll cycle)

### src/encoder/db.py (extended)

- `seen_files` table added to `init_db()` executescript block — `(path TEXT, mtime REAL)` composite primary key
- `seen_file(path, mtime, db_path) -> bool` — SELECT 1 check for path+mtime
- `mark_file_seen(path, mtime, db_path) -> None` — INSERT OR IGNORE for idempotent recording

### src/encoder/main.py (extended)

- Import `WatchFolder` from `encoder.watcher`
- Lifespan creates `WatchFolder(scheduler=scheduler, db_path=DB_PATH)`, stores on `app.state.watcher`
- Start order: `scheduler.start()` then `watcher.start()`
- Stop order: `watcher.stop()` then `scheduler.stop()` (reverse)

### README.md (extended)

Phase 4 section added covering:
- `uvicorn encoder.main:app` start command with host/port/ENCODER_DB examples
- Startup sequence (5 steps)
- Job endpoints table + curl examples
- Settings API table + curl examples
- Global defaults reference table (9 keys)
- Watch folder configuration and disable instructions
- Disk space pre-flight description

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files Exist

- FOUND: src/encoder/watcher.py
- FOUND: src/encoder/db.py
- FOUND: src/encoder/main.py
- FOUND: README.md

### Commits Exist

- FOUND: cdbc4ae (Task 1)
- FOUND: d29cf38 (Task 2)

## Self-Check: PASSED
