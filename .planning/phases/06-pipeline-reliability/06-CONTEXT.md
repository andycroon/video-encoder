# Phase 6: Pipeline Reliability - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Three targeted improvements to the encoding pipeline backend: (1) CRF oscillation fix — select the encode whose VMAF was closest to the window center, not the last encode the loop landed on; (2) job resume — skip pipeline steps already marked DONE in the DB after a crash/restart; (3) parallel chunk encoding — encode multiple chunks concurrently with a configurable limit. One small frontend addition: a `max_parallel_chunks` setting in SettingsModal. No new pipeline stages, no new API endpoints beyond what the settings system already provides.

</domain>

<decisions>
## Implementation Decisions

### CRF oscillation fix
- Replace `visited_crfs: set[int]` with a VMAF history list (list of `(crf, vmaf)` tuples, one entry per encode attempt)
- On oscillation exit: iterate the history list, pick the entry whose VMAF is closest to the window center (`(vmaf_min + vmaf_max) / 2`)
- Tiebreak: prefer the lower CRF (slightly over-quality is safer than under-quality) — exact rule from REQUIREMENTS.md PIPE-V2-03
- The selected `(crf, vmaf)` becomes the return value; the encoded file for that CRF must be the one written to disk (may need re-encode if the chosen entry wasn't the last one written)

### Job resume behavior
- On pipeline entry, query `get_steps(db_path, job_id)` to get all step rows for this job
- Build a `completed_steps: set[str]` from rows where `status == "DONE"`
- Before each pipeline step block, check `if step_name in completed_steps: skip` — no re-execution, no file I/O
- For chunks: query existing chunk rows; chunks with `status == "DONE"` are skipped; chunks with any other status (or missing) are re-encoded from scratch — delete any partially-written output file before re-encoding
- `recover_stale_jobs()` already resets RUNNING → QUEUED on startup; scheduler re-picks those jobs, which then enter the resume path above

### Resume UX — status badge
- Add `RESUMING` as a distinct job status badge in `StatusBadge.tsx`
- Color: amber/orange family (distinct from QUEUED grey and RUNNING blue) — exact shade is Claude's discretion within the existing color palette
- `recover_stale_jobs()` should set status to `RESUMING` (not `QUEUED`) so the UI communicates "this is a recovery, not a fresh enqueue"
- Once the pipeline starts executing, status transitions to `RUNNING` as normal

### Resume UX — stage list on reconnect
- Frontend reads `GET /jobs/{id}` on mount/reconnect to reconstruct stage state — no change to SSE contract
- `StageList` already reads `stages` array with `startedAt` / `completedAt` from the REST response; completed stages already render with ✔ + duration
- No synthetic SSE re-emit from the pipeline for already-done steps; REST endpoint is the source of truth for historical stage state

### Parallel concurrency setting — backend
- New key `max_parallel_chunks` added to `SETTINGS_DEFAULTS` in `db.py`, default value `1` (serial, safe)
- Pipeline reads this setting from the job's config snapshot; inner `ThreadPoolExecutor(max_workers=max_parallel_chunks)` handles concurrent chunk encoding
- DB writes from worker threads use `asyncio.run_coroutine_threadsafe` to call async DB functions from sync thread context
- Add `PRAGMA busy_timeout = 5000` to `get_db()` in db.py so concurrent chunk DB writers don't immediately raise SQLITE_BUSY
- Cancel: each job maintains a handle list (protected by `threading.Lock`) of active ffmpeg `Popen` objects; cancel endpoint iterates the list and terminates all; new chunks check `cancel_event` before starting

### Parallel concurrency setting — frontend
- Location: SettingsModal (global setting, not per-profile)
- Label: "Max parallel encoders"
- Widget: Number input, `min=1`, max capped at the machine's CPU count
- CPU count exposed via a new `GET /api/system` endpoint returning `{ cpu_count: int }` — frontend reads this on SettingsModal open to set the input's `max` attribute
- Default displayed: 1 (matches SETTINGS_DEFAULTS)

### Parallel chunk live display
- `chunk_progress` SSE payload already includes `chunk_index` — no SSE contract changes needed
- Frontend keys the "currently encoding" running indicator by `chunk_index` (not a single global flag)
- With N chunks in parallel: N rows simultaneously show `--` VMAF + a running indicator
- When a `chunk_complete` event arrives for a chunk, that row's running indicator clears and VMAF/CRF values fill in
- No UI state changes needed beyond keying the existing in-progress indicator by `chunk_index` instead of a single active slot

### Claude's Discretion
- Exact color/styling for the RESUMING badge (amber family, consistent with existing palette)
- How the handle list for cancel is structured (e.g., dict keyed by chunk index vs plain list)
- Whether to re-encode the "best" chunk file if it wasn't the last encode written (can keep all intermediate files until oscillation resolves, or re-encode the winner — simpler approach is re-encode the winner)
- Error handling if `GET /api/system` is unavailable (fallback: no max attribute on input)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — PIPE-V2-01 (parallel encoding), PIPE-V2-02 (job resume), PIPE-V2-03 (CRF oscillation — exact selection rule and tiebreak)

### Roadmap
- `.planning/ROADMAP.md` §"Phase 6: Pipeline Reliability" — Success criteria (5 items), plan outlines for 06-01, 06-02, 06-03

No external ADRs or specs — all requirements are captured above and in the files listed.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/encoder/pipeline.py` `_encode_chunk_with_vmaf()` — the function to modify for CRF oscillation fix; currently uses `visited_crfs: set[int]` and `best_crf/best_vmaf` updated each iteration; replace with `vmaf_history: list[tuple[int, float]]`
- `src/encoder/db.py` `get_steps(path, job_id)` — already exists; returns list of step dicts with `step_name`, `status`, `started_at`, `finished_at`; use this to build `completed_steps` set on resume
- `src/encoder/db.py` `SETTINGS_DEFAULTS` — add `"max_parallel_chunks": "1"` here; `_coerce_setting()` will need an int branch for it
- `src/encoder/db.py` `get_db()` / `init_db()` — add `PRAGMA busy_timeout = 5000` here
- `src/encoder/scheduler.py` — `ThreadPoolExecutor(max_workers=1)` is job-level; the new parallel chunk executor is a separate inner executor scoped per job inside `pipeline.py`, not at the scheduler level
- `frontend/src/components/StatusBadge.tsx` — add `RESUMING` entry to the CFG dict; amber/orange color family
- `frontend/src/components/ChunkTable.tsx` — already renders `--` for in-progress rows; currently uses a single active-chunk indicator; refactor to key running state by `chunk_index`
- `frontend/src/components/SettingsModal.tsx` — add "Max parallel encoders" number input field
- `frontend/src/components/StageList.tsx` — already reads `stages` array with `startedAt`/`completedAt`; resume state already works via REST; no changes needed here

### Established Patterns
- All sync ffmpeg calls go through `run_ffmpeg()` in `ffmpeg.py`; cancel via `threading.Event` checked between steps
- DB async calls from sync thread context need `asyncio.run_coroutine_threadsafe(coro, loop)` — the scheduler already has `self._loop`; pipeline needs to accept/receive the event loop reference for this
- `recover_stale_jobs()` in db.py already exists and is called on startup in `run_pipeline` context; it resets RUNNING → QUEUED

### Integration Points
- New `GET /api/system` endpoint in `main.py` → returns `{ cpu_count: os.cpu_count() }`
- `RESUMING` status must be added to both backend `JobStatus` type and frontend `JobStatus` type/constant wherever job status is typed
- `max_parallel_chunks` flows: `SETTINGS_DEFAULTS` → `get_settings()` → config snapshot on `POST /jobs` → `run_pipeline()` config dict → inner ThreadPoolExecutor

</code_context>

<specifics>
## Specific Ideas

- The oscillation exit rule from REQUIREMENTS.md is precise: "closest to window center; if equidistant, prefer lower CRF." This is a locked decision — do not deviate.
- `RESUMING` badge should be visually distinct from both QUEUED (grey) and RUNNING (blue pulse) — amber/orange family communicates "recovering" without alarm.
- The inner ThreadPoolExecutor for parallel chunks is job-scoped (created inside `run_pipeline` for the chunk encode section), not scheduler-level — important for correct cancel and resource cleanup.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-pipeline-reliability*
*Context gathered: 2026-03-17*
