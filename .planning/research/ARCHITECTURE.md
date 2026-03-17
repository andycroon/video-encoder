# Architecture Research

**Domain:** Video encoding pipeline web app — v1.1 feature integration
**Researched:** 2026-03-17
**Confidence:** HIGH (based on direct code inspection of all existing modules)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (React 19)                           │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  TopBar    │  │  JobList   │  │ HistoryList  │  │   Modals    │ │
│  │  FilePick  │  │  JobRow    │  │ (NEW)        │  │  Profile/   │ │
│  │  FileUpload│  │  JobCard   │  │ BulkActions  │  │  Settings   │ │
│  │  (NEW)     │  │  VmafChart │  │ (NEW)        │  │             │ │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  └─────────────┘ │
│        │               │                │                            │
│  ┌─────┴───────────────┴────────────────┴──────────────────────┐    │
│  │                  Zustand Store (jobsStore)                    │    │
│  │  jobs[] | profiles[] | expandedJobId | theme (NEW)           │    │
│  └──────────────────────────┬───────────────────────────────────┘    │
│       SSE useJobStream       │    REST polling (5s interval)         │
└──────────────────────────────┼─────────────────────────────────────┘
                               │ HTTP /api/*
┌──────────────────────────────┴─────────────────────────────────────┐
│                      FastAPI (main.py)                               │
│                                                                      │
│  /api/jobs     /api/browse   /api/upload (NEW)   /api/profiles       │
│  /api/settings               /api/jobs/bulk (NEW)                   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Scheduler (asyncio)                        │    │
│  │  asyncio.Queue → ThreadPoolExecutor (1 worker currently)    │    │
│  │  cancel_events: dict[job_id, threading.Event]               │    │
│  └──────────────────────┬──────────────────────────────────────┘    │
│                         │ loop.run_in_executor                       │
│  ┌──────────────────────┴──────────────────────────────────────┐    │
│  │                 Pipeline (sync, in thread)                   │    │
│  │  FFV1 → SceneDetect → ChunkSplit → AudioTranscode            │    │
│  │  → ChunkEncode (serial → PARALLEL in v1.1) → Concat → Mux   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌───────────┐  ┌─────────────┐  ┌────────────────────────────┐    │
│  │ EventBus  │  │ WatchFolder │  │ db.py (aiosqlite WAL)      │    │
│  │ (sse.py)  │  │ (watcher.py)│  │ jobs/steps/chunks/profiles │    │
│  └───────────┘  └─────────────┘  └────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | v1.1 Status |
|-----------|---------------|-------------|
| `main.py` | FastAPI routes, lifespan, static serving | MODIFY — add `/api/upload`, `/api/jobs/bulk`; `/api/browse` already exists |
| `scheduler.py` | asyncio job queue, ThreadPoolExecutor, cancel/pause signals | MODIFY — expose loop ref for parallel chunk db writes |
| `pipeline.py` | Full 10-step sync pipeline, CRF+VMAF loop | MODIFY — parallel chunks, resume/checkpoint, oscillation fix |
| `db.py` | aiosqlite CRUD, WAL mode, step/chunk tracking | MODIFY — add `delete_job`, `bulk_delete_jobs`, `auto_cleanup_jobs` |
| `sse.py` | In-process EventBus, thread-safe publish, per-job subscriber queues | NO CHANGE |
| `ffmpeg.py` | subprocess wrapper, cancellable iterator, VMAF path escaping | NO CHANGE |
| `watcher.py` | Watch folder polling, seen_files dedup | NO CHANGE |
| `App.tsx` | Root layout, modal state | MODIFY — add history tab toggle, theme data attribute |
| `JobList.tsx` | Polls REST, renders active jobs | MODIFY — filter to active statuses only |
| `JobRow.tsx` / `JobCard.tsx` | Per-job row and expanded card | MODIFY — delete button; `VmafChart` inside expanded card |
| `ChunkTable.tsx` | Per-chunk CRF/VMAF/passes table | MODIFY — stronger convergence color thresholds |
| `jobsStore.ts` | Zustand store, SSE event reducer | MODIFY — add `theme`, `removeJob`, `removeJobsByStatus` |
| `types/index.ts` | TypeScript interfaces | MODIFY — extend `Job` or add `convergence_status` to `ChunkData` |
| `TopBar.tsx` | File path input, profile picker, Add Job | MODIFY — upload trigger, history view toggle |
| `FilePicker.tsx` | Directory browser modal | NO CHANGE — already integrated with `/api/browse` |
| `SettingsModal.tsx` | Global settings form | MODIFY — add concurrency and auto-cleanup fields |

---

## Recommended Project Structure

```
src/encoder/
├── main.py           # MODIFY: add /upload, /jobs/bulk endpoints
├── pipeline.py       # MODIFY: parallel chunks, resume, oscillation fix
├── scheduler.py      # MODIFY: pass loop ref for cross-thread db writes
├── db.py             # MODIFY: delete_job, bulk_delete, auto_cleanup
├── sse.py            # no change
├── ffmpeg.py         # no change
└── watcher.py        # no change

frontend/src/
├── App.tsx                     # MODIFY: history tab, theme data attr
├── components/
│   ├── TopBar.tsx               # MODIFY: upload button, history toggle
│   ├── JobList.tsx              # MODIFY: filter to active statuses
│   ├── JobRow.tsx               # MODIFY: delete button for terminal jobs
│   ├── JobCard.tsx              # MODIFY: add VmafChart
│   ├── ChunkTable.tsx           # MODIFY: convergence color thresholds
│   ├── SettingsModal.tsx        # MODIFY: concurrency + cleanup settings
│   ├── StageList.tsx            # no change
│   ├── LogPanel.tsx             # no change
│   ├── FilePicker.tsx           # no change
│   ├── ProfileModal.tsx         # no change
│   ├── CancelDialog.tsx         # no change
│   ├── StatusBadge.tsx          # no change
│   ├── VmafChart.tsx            # NEW: line chart vmaf vs chunk_index
│   ├── HistoryList.tsx          # NEW: DONE/FAILED/CANCELLED view
│   ├── FileUpload.tsx           # NEW: multipart upload to /api/upload
│   ├── ThemeToggle.tsx          # NEW: localStorage + data-theme toggle
│   └── BulkActions.tsx          # NEW: "Clear completed" / "Clear failed"
├── store/
│   └── jobsStore.ts             # MODIFY: removeJob, theme field
├── types/
│   └── index.ts                 # MODIFY: extend ChunkData, Job
├── api/
│   ├── jobs.ts                  # MODIFY: add deleteJob, bulkDelete
│   ├── settings.ts              # no change
│   ├── browse.ts                # no change
│   └── profiles.ts              # no change
└── hooks/
    └── useJobStream.ts          # no change
```

### Structure Rationale

- **New components in `components/`:** All five new components are UI-only with no shared logic between them. No new subdirectories needed.
- **No new backend modules:** All backend changes are surgical modifications to existing files. A `cleanup.py` or `uploads.py` module is not warranted — the logic is small enough to live in `db.py` and `main.py`.
- **No schema migration file:** `init_db` uses `ALTER TABLE ... IF NOT EXISTS` guards (already established pattern in `db.py` lines 86-94). New columns added the same way.

---

## Architectural Patterns

### Pattern 1: Parallel Chunk Encoding with ThreadPoolExecutor

**What:** The serial `for i, chunk_in in enumerate(chunks)` loop in `pipeline.py` becomes a `ThreadPoolExecutor` dispatch. Each worker calls `_encode_chunk_with_vmaf` (already synchronous) in its own thread.

**When to use:** After ChunkSplit completes — the full chunk list is known and all inputs exist.

**Trade-offs:** N workers = N simultaneous ffmpeg processes. At N=2 on a workstation this is safe. At N=4+ it can saturate CPU and push VMAF scoring time up due to contention. Default of 2.

**Windows constraint (critical):** The pipeline runs in a `ThreadPoolExecutor` thread that creates its own `asyncio` event loop (`_run_pipeline_sync` in `scheduler.py`). The chunk sub-threads cannot call `await` directly. The `db.py` functions are all async (aiosqlite). Two clean options:

Option A — `asyncio.run_coroutine_threadsafe` to post DB writes back to the pipeline thread's loop:
```python
# Inside each chunk worker thread:
future = asyncio.run_coroutine_threadsafe(
    update_chunk(db_path, chunk_id, ...),
    loop=pipeline_loop  # passed in from run_pipeline
)
future.result()  # block until done
```

Option B — use `sqlite3` (synchronous) directly inside the chunk worker, bypassing aiosqlite for chunk writes only. Simpler but diverges from the existing db.py API.

**Recommendation:** Option A. Pass `asyncio.get_event_loop()` from `run_pipeline` down to the chunk workers. Keeps all DB access through `db.py`.

```python
# Sketch — replaces serial for-loop in run_pipeline:
from concurrent.futures import ThreadPoolExecutor, as_completed

max_workers = config.get("max_parallel_chunks", 2)
pipeline_loop = asyncio.get_event_loop()

def encode_one(args):
    i, chunk_in, chunk_out, chunk_id = args
    crf, vmaf, iters = _encode_chunk_with_vmaf(
        chunk_in, chunk_out, config, cancel_event, f"Chunk {i}/{total}", on_progress=_log
    )
    asyncio.run_coroutine_threadsafe(
        update_chunk(db_path, chunk_id, crf_used=float(crf), vmaf_score=vmaf,
                     iterations=iters, status="DONE"),
        pipeline_loop
    ).result()
    return (i, crf, vmaf, iters)

with ThreadPoolExecutor(max_workers=max_workers) as pool:
    futures = [pool.submit(encode_one, (i, chunk_in, chunk_out, chunk_id))
               for i, (chunk_in, chunk_out, chunk_id) in enumerate(chunk_tasks)]
    for future in as_completed(futures):
        i, crf, vmaf, iters = future.result()
        # emit SSE chunk_complete from main pipeline thread
```

### Pattern 2: Checkpoint-Based Resume

**What:** Before each pipeline step, check whether a `DONE` step row already exists in `steps` for this `job_id` + `step_name`. If yes, skip the encode body and verify the output file exists.

**When to use:** At the top of `run_pipeline`, fetch all existing steps for the job once. Use a `completed_steps: set[str]` for O(1) lookup at each step gate.

**Trade-offs:** Adds one DB read at pipeline start. Step skipping is idempotent — running twice on a fresh job (no prior steps) produces identical behaviour.

```python
# At top of run_pipeline, after status update to RUNNING:
existing = await get_steps(db_path, job_id)
completed_steps = {s["step_name"] for s in existing if s["status"] == "DONE"}

# Then at each step gate:
if "FFV1" not in completed_steps:
    step_id = await create_step(db_path, job_id, "FFV1")
    _ffv1_encode(source_path, intermediate, cancel_event, on_progress=_log)
    await update_step(db_path, step_id, "DONE")
else:
    _log("[FFV1] Skipping — checkpoint found")
    # Verify output file exists; if not, re-run step regardless
    if not intermediate.exists():
        completed_steps.discard("FFV1")
        # fall through to encode
```

**File guard is mandatory:** If `temp/job_{id}/` was manually deleted between runs, the DB says DONE but the file is gone. Always check `Path.exists()` before skipping.

**Chunk resume detail:** The ChunkEncode step is one DB step covering many chunks. For resume after partial chunk encoding, check the `chunks` table for `status='DONE'` rows per `chunk_index`. Skip encoding for done chunks; encode only the remainder.

### Pattern 3: Smart CRF Oscillation Resolution

**What:** Replace the `visited_crfs: set[int]` tracker in `_encode_chunk_with_vmaf` with a `history: list[tuple[int, float]]` of `(crf, vmaf)` pairs. On oscillation exit, select the `(crf, vmaf)` whose VMAF is closest to the window midpoint. If that CRF differs from the last encoded, do one final re-encode.

**When to use:** Only triggered when `crf in visited_crfs` — same condition as before, no behaviour change for well-converging chunks.

```python
# Replace:
visited_crfs: set[int] = set()
best_crf, best_vmaf = crf, 0.0

# With:
history: list[tuple[int, float]] = []  # (crf, vmaf)

# After each encode+score:
history.append((crf, vmaf))

# On oscillation exit:
target_vmaf = (vmaf_min + vmaf_max) / 2.0
best_crf, best_vmaf = min(history, key=lambda h: abs(h[1] - target_vmaf))
# If best_crf is not the last encoded CRF, do one more encode at best_crf
if best_crf != crf:
    _encode_chunk_x264(chunk_path, encoded_path, best_crf, config, cancel_event=cancel_event)
    best_vmaf = _vmaf_score(encoded_path, chunk_path)
```

**No schema changes, no API changes, no frontend changes.** This is a self-contained fix.

### Pattern 4: History View via Status Filtering

**What:** The existing `jobs[]` array in Zustand contains all jobs regardless of status. The active queue view filters to `['QUEUED', 'RUNNING', 'PAUSED']`. The history view filters to `['DONE', 'FAILED', 'CANCELLED']` from the same array.

**When to use:** Do not create a separate history store or a second polling interval. One store, one polling loop, two filtered views.

**Trade-offs:** The 5-second poll fetches all jobs every cycle. For large histories (100+ DONE jobs), this grows. Mitigation: the active queue view polls `/api/jobs?status=QUEUED` (comma-separated status filter) while the history view does a one-time fetch on mount plus manual refresh button.

### Pattern 5: Dark Mode via CSS Custom Properties + localStorage

**What:** All existing colour values already use `var(--bg)`, `var(--txt)`, `var(--panel)`, etc. Add `[data-theme="light"]` overrides to `index.css`. Apply `document.documentElement.dataset.theme = 'light' | 'dark'` from `ThemeToggle`. Persist in `localStorage`.

**When to use:** On app mount read `localStorage.getItem('theme')` and apply. Toggle button swaps and re-persists.

**No Zustand involvement needed:** `localStorage` is the source of truth. No server round-trip. The theme applies before React renders — no flash of wrong theme if applied in a `<script>` tag before the bundle loads, or in a `useLayoutEffect` in `App.tsx`.

---

## Data Flow

### Parallel Chunk Encode Flow (modified)
```
ChunkEncode step begins in pipeline thread
    → ThreadPoolExecutor(max_workers=N) dispatches chunk tasks
    → N worker threads each call _encode_chunk_with_vmaf concurrently
    → Encode → VMAF score → CRF adjust loop (fully synchronous per thread)
    → On completion: asyncio.run_coroutine_threadsafe(update_chunk(...), loop)
    → SSE chunk_complete event emitted from main pipeline thread after each result
    → chunk_complete events arrive unordered by chunk_index (expected)
    → Frontend: keyed on chunkIndex in Zustand — handles out-of-order correctly
```

### Resume Flow (new)
```
App restarts → recover_stale_jobs() resets RUNNING → QUEUED (db.py)
    → lifespan re-enqueues all QUEUED jobs (main.py)
    → scheduler._run_job() → run_pipeline()
    → run_pipeline queries get_steps(db_path, job_id) at entry
    → Steps with status=DONE + output file present are skipped
    → Pipeline continues from first incomplete step
    → If temp dir was wiped: missing file guard forces re-run of affected steps
```

### File Upload Flow (new)
```
User selects file (FileUpload.tsx)
    → POST /api/upload (multipart, streaming write to upload_path/)
    → FastAPI: shutil.copyfileobj(file.file, dest) — never file.read()
    → create_job(db_path, saved_path, config_snapshot)
    → scheduler.enqueue(job_id)
    → Returns Job object → upsertJob(store) → appears in JobList
```

### Delete / History Flow (new)
```
User clicks delete on DONE/FAILED/CANCELLED job (JobRow trash button)
    → DELETE /api/jobs/{id}
    → db.delete_job(): DELETE chunks → DELETE steps → DELETE jobs (one transaction)
    → Returns {deleted: id}
    → store.removeJob(id) → job disappears from HistoryList

Auto-cleanup (background asyncio task, hourly):
    → db.auto_cleanup_jobs(max_age_hours) deletes old terminal jobs
    → No SSE needed — next REST poll naturally drops the missing rows
```

### Bulk Delete Flow (new)
```
User clicks "Clear all completed" (BulkActions)
    → DELETE /api/jobs/bulk?status=DONE
    → db.delete_jobs_by_status("DONE")
    → Returns {deleted: N}
    → store.removeJobsByStatus("DONE") → HistoryList empties
```

---

## Integration Points Per Feature

### 1. Parallel Chunk Encoding

| Layer | Change |
|-------|--------|
| `db.py` | Add `max_parallel_chunks` to `SETTINGS_DEFAULTS` (default `"2"`) |
| `pipeline.py` | Replace serial chunk for-loop with `ThreadPoolExecutor` dispatch; pass `pipeline_loop` to workers for DB writes |
| `scheduler.py` | No change needed — pipeline still runs as single `run_in_executor` call |
| `main.py` | No change |
| `SettingsModal.tsx` | Add numeric input for `max_parallel_chunks` setting |
| SSE impact | `chunk_complete` events arrive unordered; frontend already handles correctly |

### 2. Job Resume

| Layer | Change |
|-------|--------|
| `db.py` | No schema change; `get_steps()` already exists and returns step rows with status |
| `pipeline.py` | Add `completed_steps` check at each step gate; file-existence guard; chunk-level resume via `chunks` table query |
| `scheduler.py` | Allow re-enqueue of `PAUSED` status jobs (currently only `QUEUED` is accepted) |
| `main.py` | No change; existing `/retry` already creates new job — resume is different: same job_id, same temp dir |

### 3. Smart CRF Oscillation

| Layer | Change |
|-------|--------|
| `pipeline.py` | `_encode_chunk_with_vmaf` only — replace `visited_crfs: set` with `history: list[tuple]`; add midpoint selection on oscillation exit |
| All other layers | No change |

### 4. Browser File Upload

| Layer | Change |
|-------|--------|
| `db.py` | Add `upload_path` to `SETTINGS_DEFAULTS` (default `"temp/uploads"`) |
| `main.py` | New `POST /api/upload` endpoint; streaming write; create + enqueue job |
| `frontend/src/api/jobs.ts` | Add `uploadFile(file: File): Promise<Job>` function |
| `FileUpload.tsx` | New component — file input or drag zone; calls `uploadFile`; `upsertJob` on success |
| `TopBar.tsx` | Add upload trigger button |

### 5. Server-Side Directory Browser

**Already implemented.** `/api/browse` exists in `main.py` (line 237). `FilePicker.tsx` already consumes it. No v1.1 work required.

### 6. Job Delete / Bulk / History / Auto-Cleanup

| Layer | Change |
|-------|--------|
| `db.py` | Add `delete_job(path, job_id)`, `delete_jobs_by_status(path, status)`, `auto_cleanup_jobs(path, max_age_hours)` |
| `db.py` | Add `auto_cleanup_hours` to `SETTINGS_DEFAULTS` (default `"0"` = disabled) |
| `main.py` | Change `DELETE /api/jobs/{id}` semantics: terminal-state jobs → hard delete; running jobs → cancel (existing). Add `DELETE /api/jobs/bulk?status=DONE` |
| `main.py` | Add background auto-cleanup `asyncio.create_task` in lifespan |
| `jobsStore.ts` | Add `removeJob(id: number)` and `removeJobsByStatus(status: string)` actions |
| `api/jobs.ts` | Add `deleteJob(id)`, `bulkDeleteJobs(status)` API functions |
| `JobRow.tsx` | Add trash icon button for DONE/FAILED/CANCELLED jobs |
| `HistoryList.tsx` | New — filters `jobs[]` to terminal statuses; shows bulk actions |
| `BulkActions.tsx` | New — "Clear completed" / "Clear failed" buttons |
| `App.tsx` | Add Queue / History tab or toggle |

### 7. VMAF History Chart

| Layer | Change |
|-------|--------|
| Backend | No change — `vmaf_score` per chunk already in DB, already returned in `job.chunks` by `list_jobs` |
| `VmafChart.tsx` | New — receives `chunks: ChunkData[]`; renders line chart of `vmaf` vs `chunkIndex`; show target band as horizontal band |
| `JobCard.tsx` | Add `<VmafChart chunks={job.chunks} />` below ChunkTable |

**Chart library:** Use recharts (if already a dep) or a minimal SVG path drawn manually to avoid adding a dependency. The data is simple: one line, ~20–200 points.

### 8. CRF Convergence Indicator

| Layer | Change |
|-------|--------|
| `ChunkTable.tsx` | Add red color threshold at `passes >= 3` (amber already exists at `passes > 1`) |
| Optional schema add | Add `convergence_status TEXT` column to `chunks` table to expose "oscillation" / "bounds" / "pass" status. Requires `ALTER TABLE` in `init_db` + `update_chunk` signature change + pipeline emit. Skip if visual-only is acceptable |
| SSE | If convergence_status column added: include `convergence_status` in `chunk_complete` event and `applyEvent` case in `jobsStore.ts` |

### 9. Dark Mode

| Layer | Change |
|-------|--------|
| `index.css` | Add `[data-theme="light"]` selector block with light palette values for all CSS variables |
| `ThemeToggle.tsx` | New — reads/writes `localStorage.theme`; sets `document.documentElement.dataset.theme` |
| `App.tsx` | Mount `ThemeToggle` in header; apply initial theme in `useLayoutEffect` on mount |
| `jobsStore.ts` | Optionally add `theme` field for reactive access — not required if `ThemeToggle` is self-contained |

---

## Recommended Build Order

Dependencies drive this sequence. Each step leaves the app shippable.

| Step | Feature | Rationale |
|------|---------|-----------|
| 1 | Smart CRF oscillation fix | Pure algorithm, zero risk, one function in `pipeline.py`. No dependencies. |
| 2 | Job resume (checkpoint) | Modifies the pipeline step loop structure. Must be done before parallel chunks because both restructure the same loop. |
| 3 | Parallel chunk encoding | Builds on step 2's restructured loop. Adds `ThreadPoolExecutor` dispatch + settings key. |
| 4 | Job delete + bulk + history view | Backend delete functions, new REST endpoints, frontend `HistoryList`. Fully independent of pipeline changes. |
| 5 | Auto-cleanup background task | Depends on delete functions from step 4. Two lines of lifespan code once `auto_cleanup_jobs` exists. |
| 6 | VMAF history chart | Read-only chart over existing `job.chunks`. Pure frontend, no backend needed. |
| 7 | CRF convergence indicator | Minor `ChunkTable` change. Optionally add `convergence_status` column if full detail wanted. |
| 8 | Dark mode | Pure CSS + localStorage. Zero backend. No risk of breaking pipeline. |
| 9 | Browser file upload | New FastAPI endpoint + `FileUpload.tsx`. Depends on stable create/enqueue path (established in steps 1-3). |

---

## Anti-Patterns

### Anti-Pattern 1: asyncio.create_subprocess_exec for Parallel Chunks

**What people do:** Reach for `asyncio.gather` with `create_subprocess_exec` for parallelism inside the pipeline.
**Why it's wrong:** The pipeline runs in a `ThreadPoolExecutor` thread with a non-main event loop. On Windows, `create_subprocess_exec` requires the ProactorEventLoop and cannot be safely created in arbitrary threads (Python restriction).
**Do this instead:** Use `concurrent.futures.ThreadPoolExecutor` inside the pipeline thread. Each chunk worker calls `subprocess.Popen` via the existing synchronous `run_ffmpeg` interface.

### Anti-Pattern 2: Storing Theme in Zustand Without localStorage Sync

**What people do:** Put `theme` in Zustand and derive the CSS class from it.
**Why it's wrong:** Zustand state resets to default on every page load — causes flash of wrong theme before hydration.
**Do this instead:** `localStorage` is the source of truth. Apply theme in `useLayoutEffect` (or a `<script>` in `index.html`) before first paint. Zustand can mirror it for reactive components but must not own it.

### Anti-Pattern 3: Inline Object Selectors in Zustand

**What people do:** `const { jobs, removeJob } = useJobsStore(s => ({ jobs: s.jobs, removeJob: s.removeJob }))`.
**Why it's wrong:** React 19 + Zustand 5 creates a new object on every render — causes infinite re-render loop (established rule in MEMORY.md).
**Do this instead:** One `useJobsStore` call per field: `const jobs = useJobsStore(s => s.jobs)` and `const removeJob = useJobsStore(s => s.removeJob)` separately.

### Anti-Pattern 4: await file.read() for Large Uploads

**What people do:** `content = await file.read()` then write to disk.
**Why it's wrong:** A 40 GB MKV loaded entirely into memory crashes the process.
**Do this instead:** Stream-copy with `shutil.copyfileobj(file.file, dest_file, length=1024*1024)` in a `run_in_executor` call so it doesn't block the event loop.

### Anti-Pattern 5: Forgetting to Cascade Delete Child Rows

**What people do:** `DELETE FROM jobs WHERE id=?` and assume children vanish.
**Why it's wrong:** SQLite foreign key cascade is disabled by default (`PRAGMA foreign_keys=OFF`). Orphaned rows in `chunks`, `steps` accumulate silently.
**Do this instead:** In `delete_job`: delete in order within one transaction: `DELETE FROM chunks WHERE job_id=?` → `DELETE FROM steps WHERE job_id=?` → `DELETE FROM jobs WHERE id=?`.

### Anti-Pattern 6: Resume Without File Existence Guard

**What people do:** Check only the DB step status to decide whether to skip a step.
**Why it's wrong:** If `temp/job_{id}/` was manually deleted, DB says DONE but the intermediate file is gone — the next step fails with a missing-input error instead of gracefully re-running.
**Do this instead:** Before skipping a step, verify the expected output file exists at the computed path. If missing, discard the checkpoint and re-run the step.

---

## Scaling Considerations

This is a single-user local/LAN tool. Scaling is operational, not load-based.

| Concern | After v1.1 | Notes |
|---------|-----------|-------|
| Job history growth | Auto-cleanup with configurable TTL | `auto_cleanup_hours=0` disables |
| Temp disk during resume | Job temp dir must survive until DONE | Cleanup is deferred; monitor disk manually |
| Parallel encode memory | N ffmpeg processes × ~1-2 GB each | Default N=2; warn if N > 4 in UI |
| SQLite write contention | N chunk workers + heartbeat writes simultaneously | WAL mode handles this; all writes serialized through aiosqlite connection pool |
| Upload storage | Files accumulate in `upload_path/` unless cleaned | Auto-cleanup of uploads not in scope for v1.1 |

---

## Sources

- Direct code inspection: `src/encoder/{main,pipeline,scheduler,db,sse,ffmpeg}.py` (2026-03-17)
- Direct code inspection: `frontend/src/{store/jobsStore,types/index,components/*}.ts(x)` (2026-03-17)
- FastAPI UploadFile streaming docs: https://fastapi.tiangolo.com/tutorial/request-files/
- Windows asyncio subprocess constraint: confirmed in existing `MEMORY.md` pitfalls (ThreadPoolExecutor required)
- Zustand 5 selector rule: confirmed in `MEMORY.md` (object selectors cause infinite re-renders)
- `asyncio.run_coroutine_threadsafe` pattern: https://docs.python.org/3/library/asyncio-task.html#asyncio.run_coroutine_threadsafe

---
*Architecture research for: VibeCoder Video Encoder v1.1*
*Researched: 2026-03-17*
