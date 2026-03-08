---
phase: 04-web-api-scheduler
verified: 2026-03-08T14:00:00Z
status: human_needed
score: 20/20 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 19/20
  gaps_closed:
    - "Settings survive an app restart — test_settings_db.py run() helper fixed: asyncio.get_event_loop().run_until_complete() replaced with asyncio.run(). All 4 tests now pass in full suite runs."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "SSE stream visible in browser DevTools"
    expected: "Content-Type: text/event-stream in Network tab; keepalive pings (: ping) every 15s; named events (stage, job_complete) visible after submitting a job"
    why_human: "Requires running server and inspecting browser DevTools Network tab — cannot verify programmatically without an HTTP client in the CI environment"
---

# Phase 4: Web API + Scheduler Verification Report

**Phase Goal:** Expose the pipeline as a web service with job queue management, real-time SSE progress, configurable settings, and a watch folder that auto-enqueues MKV files
**Verified:** 2026-03-08T14:00:00Z
**Status:** human_needed (all automated checks pass; 1 item requires human inspection)
**Re-verification:** Yes — after gap closure

---

## Re-verification Summary

Previous verification (2026-03-08T12:00:00Z) returned `gaps_found` with score 19/20.

**Gap closed:** `tests/test_settings_db.py` line 23 now reads `return asyncio.run(coro)`. The deprecated `asyncio.get_event_loop().run_until_complete(coro)` call has been removed. Confirmed by grep: pattern `asyncio.get_event_loop` no longer appears in the file.

**No regressions detected** in any production file (`main.py`, `db.py`, `scheduler.py`, `sse.py`, `watcher.py`) or the README Phase 4 section.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | FastAPI app starts with uvicorn and responds to GET / with health JSON | VERIFIED | `main.py` line 68-70: `@app.get("/") async def health(): return {"status": "ok"}` |
| 2 | GET /settings returns JSON object with all nine default keys | VERIFIED | `db.py` `SETTINGS_DEFAULTS` has all 9 keys; `get_settings` fetches+coerces all rows |
| 3 | PUT /settings persists changes; subsequent GET reflects new values | VERIFIED | `put_settings` issues UPDATE per valid key then commits; `get_settings` re-reads from DB |
| 4 | Settings survive app restart (SQLite, not in-memory) | VERIFIED | SQLite persistence in `db.py`; test helper fixed to `asyncio.run()`; all 4 tests pass in full suite |
| 5 | POST /jobs returns 201 and job object with id | VERIFIED | `main.py` line 84: `@app.post("/jobs", status_code=201)`, returns `get_job(job_id)` |
| 6 | Scheduler picks up QUEUED job and calls run_pipeline | VERIFIED | `scheduler._run_job` → `loop.run_in_executor(self._executor, _run_pipeline_sync, ...)` |
| 7 | GET /jobs returns list of all jobs with status | VERIFIED | `main.py` line 103-105: `list_jobs(DB_PATH, status=status)` |
| 8 | DELETE /jobs/{id} sets job to CANCELLED and signals cancel_event | VERIFIED | `cancel_job` calls `scheduler.cancel(job_id)` (sets threading.Event) then `update_job_status(..., "CANCELLED")` |
| 9 | POST /jobs/{id}/retry re-enqueues FAILED/CANCELLED job as new QUEUED job | VERIFIED | Creates new job row, calls `scheduler.enqueue(new_id)`, returns 201 |
| 10 | PATCH /jobs/{id}/pause sets status PAUSED | VERIFIED | `pause_job` calls `scheduler.pause(job_id)` + `update_job_status(..., "PAUSED")` |
| 11 | On startup, stale RUNNING jobs recovered to QUEUED | VERIFIED | Lifespan calls `recover_stale_jobs(DB_PATH)` then re-enqueues surviving QUEUED jobs |
| 12 | GET /jobs/{id}/stream opens SSE with keepalive pings every 15s | VERIFIED | `sse.py` KEEPALIVE_INTERVAL=15; `asyncio.wait_for(q.get(), timeout=15)` yields `: ping\n\n` on TimeoutError |
| 13 | stage named SSE event emitted when job starts | VERIFIED | `scheduler._run_job` line 111: `event_bus.publish(job_id, "stage", {"name": "starting", ...})` |
| 14 | job_complete SSE event emitted when job finishes | VERIFIED | After `run_in_executor` returns: `event_bus.publish(job_id, "job_complete", {...})` |
| 15 | warning SSE event emitted if disk space below threshold | VERIFIED | `_disk_preflight` publishes `event_bus.publish(job_id, "warning", {"message": msg})` when free < 3x source |
| 16 | SSE stream terminates correctly after job_complete or error | VERIFIED | `sse.py` line 50: checks `message.startswith("event: job_complete\n") or message.startswith("event: error\n")` |
| 17 | MKV file dropped in watch folder auto-enqueued within ~15s | VERIFIED | `WatchFolder._poll_once` globs *.mkv, checks seen_file dedup, 5s stability, calls create_job + enqueue; POLL_INTERVAL=10s |
| 18 | Empty watch_folder_path silently skips polling | VERIFIED | `watcher._poll_once` line 52-53: `if not folder_path: return` |
| 19 | Already-seen file not re-enqueued across restarts | VERIFIED | `seen_files` table with (path, mtime) composite PK; `seen_file()` check before enqueue; `mark_file_seen()` after |
| 20 | README Phase 4 section documents server start, ENCODER_DB, watch folder, settings API | VERIFIED | README line 261+ has all required content: uvicorn command, ENCODER_DB env var, watch_folder_path, /settings table |

**Score:** 20/20 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/encoder/main.py` | FastAPI app with /settings and /jobs endpoints | VERIFIED | 182 lines; all 9 routes registered; lifespan wires Scheduler + WatchFolder |
| `src/encoder/db.py` | get_settings/put_settings + settings table DDL + seen_files DDL | VERIFIED | SETTINGS_DEFAULTS dict; `init_db` creates settings + seen_files tables; both get/put functions present |
| `src/encoder/scheduler.py` | Scheduler class: asyncio queue, worker loop, cancel_event registry | VERIFIED | 178 lines; Scheduler class with start/stop/enqueue/cancel/pause; ThreadPoolExecutor; _cancel_events dict |
| `src/encoder/sse.py` | EventBus: publish/subscribe async SSE routing per job_id | VERIFIED | 75 lines; EventBus with publish/subscribe/close; _format_sse; event_bus singleton; 15s keepalive |
| `src/encoder/watcher.py` | WatchFolder: asyncio background task, stability check, dedup | VERIFIED | 107 lines; WatchFolder with start/stop/_poll_loop/_poll_once/_is_stable |
| `README.md` | Phase 4 section: uvicorn start, ENCODER_DB, watch folder, settings reference | VERIFIED | Phase 4 section at line 261; all required content present |
| `tests/test_settings_db.py` | 4 tests for get_settings/put_settings using asyncio.run() | VERIFIED | Fixed: `run()` helper now uses `asyncio.run(coro)`; no deprecated `get_event_loop()` usage |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `main.py lifespan` | `db.init_db` | `await init_db(DB_PATH)` | WIRED | Line 32 of main.py |
| `PUT /settings handler` | `db.put_settings` | `await put_settings(DB_PATH, body)` | WIRED | Line 80 of main.py |
| `POST /jobs handler` | `scheduler.enqueue(job_id)` | `app.state.scheduler` | WIRED | Line 98 of main.py; scheduler on app.state |
| `scheduler worker` | `run_pipeline` | `loop.run_in_executor(executor, _run_pipeline_sync, ...)` | WIRED | scheduler.py line 118 |
| `DELETE /jobs/{id}` | `scheduler.cancel_events[job_id].set()` | `threading.Event registry` | WIRED | `cancel()` fetches event from `_cancel_events` dict and calls `.set()` |
| `scheduler._run_job` | `event_bus.publish(job_id, ...)` | imported singleton | WIRED | publish called for stage, job_complete, error events |
| `GET /jobs/{id}/stream handler` | `event_bus.subscribe(job_id)` | `async for message in event_bus.subscribe(job_id)` | WIRED | main.py line 154 |
| `WatchFolder._poll_once` | `scheduler.enqueue(job_id)` | `self._scheduler.enqueue(job_id)` | WIRED | watcher.py line 90 |
| `WatchFolder._poll_once` | `db.mark_file_seen(path, mtime)` | called after create_job | WIRED | watcher.py line 89 |
| `main.py lifespan` | `WatchFolder(scheduler, db_path).start()` | `app.state.watcher` | WIRED | main.py lines 43-47 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| QUEUE-06 | 04-02, 04-04 | System monitors configurable watch folder and auto-adds new MKV files | SATISFIED | `WatchFolder` polls every 10s via asyncio.sleep; `seen_files` table deduplicates; wired into lifespan |
| CONF-05 | 04-01 | User can configure global defaults (VMAF range, CRF bounds, audio codec, output path, temp path) | SATISFIED | `/settings` GET/PUT endpoints backed by SQLite; 9 defaults seeded with INSERT OR IGNORE |
| CONF-06 | 04-01, 04-04 | User can configure watch folder path in settings | SATISFIED | `watch_folder_path` is one of the 9 default settings keys; WatchFolder reads it fresh each poll cycle |
| PROG-05 | 04-02, 04-03 | System warns user before starting job if disk space insufficient | SATISFIED | `_disk_preflight` checks free < 3x source size; logs warning + appends to job log + publishes SSE warning event |

No orphaned requirements found. All 4 IDs claimed by Phase 4 plans are accounted for.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/encoder/scheduler.py` | 96 | `import json as _json` inside `_run_job` method body | Info | Style issue only; not harmful to production behavior |

No blocker anti-patterns found. No TODO/FIXME/placeholder patterns in any production file. The previously flagged `asyncio.get_event_loop()` anti-pattern in `tests/test_settings_db.py` has been resolved.

---

## Human Verification Required

### 1. SSE Stream in Browser DevTools

**Test:** Start `py -m uvicorn encoder.main:app --host 127.0.0.1 --port 8000`, open browser DevTools Network tab, navigate to `http://127.0.0.1:8000/jobs/1/stream` (after creating a job via POST). Alternatively: `curl -N http://127.0.0.1:8000/jobs/1/stream`
**Expected:** Response has `Content-Type: text/event-stream`; keepalive comment lines (`: ping`) appear every 15 seconds; after submitting a job, `event: stage` appears followed by `event: job_complete` or `event: error` when done
**Why human:** Requires a live server process and inspecting streaming HTTP responses; not automatable without integration test infrastructure

---

## Gaps Summary

No gaps remain. The single gap from initial verification — the deprecated `asyncio.get_event_loop().run_until_complete()` in `tests/test_settings_db.py` — has been resolved. The `run()` helper now calls `asyncio.run(coro)` directly, which is correct for Python 3.10+ and does not fail in full pytest suite runs.

All 20 observable truths are verified. All production code is substantive and wired. All 4 phase requirements (QUEUE-06, CONF-05, CONF-06, PROG-05) are satisfied.

The one remaining item (`human_needed`) is the live SSE stream check, which requires a running server and cannot be verified by static code analysis.

---

_Verified: 2026-03-08T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: gap closed from previous run (2026-03-08T12:00:00Z)_
