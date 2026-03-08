# Phase 4: Web API + Scheduler - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

All pipeline capabilities accessible via HTTP. FastAPI REST + SSE endpoints, asyncio job scheduler, watch folder auto-enqueueing, and global configuration — testable with curl and browser DevTools before the React UI exists. No browser UI in this phase.

Steps delivered: POST /jobs, pause/cancel/retry endpoints, GET /jobs/{id}/stream (SSE), GET+PUT /settings, watch folder background task, disk space pre-flight.

</domain>

<decisions>
## Implementation Decisions

### SSE event structure
- Named events per stage (not a single generic 'update' type):
  - `stage` — fired when pipeline step changes (name, started_at)
  - `chunk_progress` — fired periodically during chunk encode (chunk_index, crf, pass)
  - `chunk_complete` — fired when a chunk finishes (chunk_index, crf_used, vmaf_score)
  - `job_complete` — fired when the full job finishes (status, duration)
  - `error` — fired on pipeline failure (message, step)
- Per-job stream endpoint: `GET /jobs/{id}/stream`
  - Each job has its own SSE connection; React opens one per visible job
- Keepalive: SSE comment pings (`:`) every 15 seconds to prevent proxy/browser timeouts

### Job scheduler design
- Serial queue — one job at a time (encoding already saturates CPU/IO)
- Asyncio background task consuming a queue; new jobs enqueued on POST /jobs
- Pipeline runs in a `ThreadPoolExecutor` via `loop.run_in_executor()` — consistent with Phase 3 sync pattern
- Cancel propagation: each running job gets a `threading.Event`; cancel endpoint calls `event.set()`; pipeline polls it between steps (same interface Phase 3 designed)
- On startup: call `recover_stale_jobs()` to reset stale RUNNING → QUEUED; scheduler re-picks them up

### Watch folder behavior
- Manual polling every 10 seconds via asyncio background task (no watchdog dependency)
- File stability check: poll file size every 2s; enqueue when size unchanged for 5s (handles slow copies, NAS)
- Leave source files in place — non-destructive
- Track seen files in DB (by path + mtime) so they're not re-enqueued after restart
- If watch folder path is missing or throws OSError: log a warning, skip poll cycle, retry next interval

### Settings persistence
- Global defaults stored in SQLite (settings table, key-value or single-row JSON blob) — consistent with the rest of the state layer already in the DB
- API: `GET /settings` returns all defaults; `PUT /settings` replaces them
- Settings covered: vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, output_path, temp_path, watch_folder_path
- On `POST /jobs`: snapshot current settings into `jobs.config` blob at submit time — queued jobs are unaffected by later settings changes

### Disk space pre-flight
- Runs at job start (before pipeline begins), not at submit time
- Check: available disk on output drive vs 3× source file size
- On insufficient space: emit `warning` SSE event; decision on whether to block or proceed is Claude's discretion

### Claude's Discretion
- Exact SQLite schema for settings (single-row JSON blob vs key-value rows)
- API response shapes (field names, envelope structure)
- FastAPI router organization (single file vs module split)
- How asyncio queue drains and restarts if the worker task crashes

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/encoder/pipeline.py`: `run_pipeline(source, config, cancel_event, job_id, ...)` — importable entry point; runs sync, must be wrapped in executor
- `src/encoder/ffmpeg.py`: `run_ffmpeg()` — all ffmpeg calls already go through this; cancel via `.cancel()`
- `src/encoder/db.py`: full async DB API — `create_job`, `update_job_status`, `update_heartbeat`, `append_job_log`, `create_chunk`, `update_chunk`, `get_chunks`, `recover_stale_jobs`
- `src/encoder/__init__.py`: existing package — `main.py` (FastAPI app) slots in as `src/encoder/main.py`

### Established Patterns
- Windows subprocess: sync Popen via `run_ffmpeg()` — no async subprocess, no ProactorEventLoop subprocess usage
- All blocking calls: ThreadPoolExecutor + `run_in_executor`
- DB calls: async (aiosqlite) — FastAPI route handlers and scheduler are async
- Cancel interface: `threading.Event` (not asyncio.Event) — Phase 3 established this as the pipeline contract

### Integration Points
- Phase 5 (React UI) will call every endpoint defined in this phase
- Phase 5 reads SSE named events (`stage`, `chunk_complete`, `job_complete`) to render live progress
- Phase 5 reads `GET /settings` to populate the settings panel and writes via `PUT /settings`
- Watch folder task and scheduler task both run as `asyncio` background tasks started in FastAPI lifespan

</code_context>

<specifics>
## Specific Ideas

- Settings should live in SQLite alongside jobs — user explicitly prefers consistency over a separate JSON file
- "Testable with curl and browser DevTools" is the acceptance bar for this phase — no React UI needed to validate

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-web-api-scheduler*
*Context gathered: 2026-03-08*
