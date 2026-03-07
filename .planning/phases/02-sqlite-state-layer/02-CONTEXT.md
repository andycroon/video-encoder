# Phase 2: SQLite State Layer - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Durable job state schema with WAL mode and tested CRUD functions. Delivers: `src/encoder/db.py` with schema creation, CRUD operations for jobs/chunks/steps, WAL mode setup, heartbeat tracking, and stale-job recovery. No scheduler, no API, no web server. This is the data layer that Phases 3–5 depend on.

</domain>

<decisions>
## Implementation Decisions

### Log storage
- Plain text blob stored as a `log` TEXT column on the `jobs` table
- Format matches the existing PowerShell script: chunk VMAF pass/fail events, CRF adjustments, VMAF averages per chunk
- Log is appended per chunk as encoding progresses (not written all at once at job completion)
- Phase 3 calls a DB function after each chunk's VMAF loop to append the chunk result line
- Phase 5 reads and renders the log blob verbatim in a log panel

### Schema granularity
- Match the existing script's per-chunk tracking behavior
- `jobs` table — overall job lifecycle (status, source path, output path, config, log, timestamps, heartbeat_at)
- `chunks` table — one row per scene chunk per job: chunk_index, crf_used, vmaf_score, iterations, status, started_at, finished_at
- `steps` table — one row per named pipeline stage per job (FFV1 encode, scene detect, chunk split, audio transcode, chunk encode, merge, mux, cleanup): step_name, status, started_at, finished_at
- VMAF scores and final CRF values live on the `chunks` table rows

### Stale job recovery
- DB layer auto-resets stale RUNNING jobs to QUEUED on startup
- Detection criteria: status = RUNNING and heartbeat_at is older than a threshold (e.g., 60 seconds)
- Phase 2 exposes an `init_db()` or `recover_stale_jobs()` function that Phase 3/4 calls at startup

### Per-job config storage
- Single `config` TEXT column on `jobs` table storing a JSON object
- Contains: vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, x264_params (as a nested object or string)
- Phase 3 reads config as a Python dict; defaults applied at job creation time

### Async DB layer
- Use `aiosqlite` for async-ready DB access (consistent with stack decision)
- WAL mode enabled on every new connection (`PRAGMA journal_mode=WAL`)
- Phase 2 tests use `asyncio.run()` to test async functions

### Claude's Discretion
- Exact column names and types beyond what's listed above
- Index strategy (which columns to index for Phase 4 query patterns)
- Connection pool / context manager pattern
- Exact heartbeat threshold value

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/encoder/ffmpeg.py`: `FfmpegProcess.stderr_lines` — the list of captured stderr lines Phase 3 will use to build the plain-text log entries after each chunk
- `src/encoder/__init__.py`: existing package — `db.py` slots in here as `src/encoder/db.py`

### Established Patterns
- Package: `src/encoder/` with src-layout — new module is `src/encoder/db.py`
- Public API pattern from Phase 1: `from encoder.db import init_db, create_job, update_job_status, ...`
- Tests at root: `tests/test_db.py` using real SQLite (no mocking), `asyncio.run()` for async test helpers
- No mocking philosophy carried forward from Phase 1

### Integration Points
- Phase 3 (Pipeline Runner) calls `create_job()`, `update_job_status()`, `append_chunk_result()`, `create_step()`, `update_step_status()`, and `update_heartbeat()`
- Phase 4 (Web API) calls `list_jobs()`, `get_job()`, and queries by status for the scheduler
- Phase 5 (React UI) reads `jobs.log` blob for the log panel and `chunks` rows for per-chunk VMAF display

</code_context>

<specifics>
## Specific Ideas

- Log format should mirror the original script's `encodinglog.txt` output style: per-chunk lines showing CRF tried, VMAF result (pass/fail), and final average VMAF for the chunk
- Recovery behavior: auto-reset to QUEUED on startup, not FAILED — user wants zero manual intervention on crash recovery

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-sqlite-state-layer*
*Context gathered: 2026-03-07*
