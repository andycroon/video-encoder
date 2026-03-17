# Phase 6: Pipeline Reliability - Research

**Researched:** 2026-03-17
**Domain:** Python asyncio, ThreadPoolExecutor, SQLite concurrency, React state
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CRF oscillation fix**
- Replace `visited_crfs: set[int]` with a VMAF history list (`list[tuple[int, float]]`, one entry per encode attempt)
- On oscillation exit: iterate the history list, pick the entry whose VMAF is closest to the window center (`(vmaf_min + vmaf_max) / 2`)
- Tiebreak: prefer the lower CRF (slightly over-quality is safer than under-quality)
- The selected `(crf, vmaf)` becomes the return value; the encoded file for that CRF must be the one written to disk (may need re-encode if the chosen entry wasn't the last one written)

**Job resume behavior**
- On pipeline entry, query `get_steps(db_path, job_id)` to get all step rows for this job
- Build a `completed_steps: set[str]` from rows where `status == "DONE"`
- Before each pipeline step block, check `if step_name in completed_steps: skip` — no re-execution, no file I/O
- For chunks: query existing chunk rows; chunks with `status == "DONE"` are skipped; chunks with any other status (or missing) are re-encoded from scratch — delete any partially-written output file before re-encoding
- `recover_stale_jobs()` already resets RUNNING → QUEUED on startup; scheduler re-picks those jobs, which then enter the resume path above

**Resume UX — status badge**
- Add `RESUMING` as a distinct job status badge in `StatusBadge.tsx`
- Color: amber/orange family (distinct from QUEUED grey and RUNNING blue pulse)
- `recover_stale_jobs()` should set status to `RESUMING` (not `QUEUED`) so the UI communicates "this is a recovery, not a fresh enqueue"
- Once the pipeline starts executing, status transitions to `RUNNING` as normal

**Resume UX — stage list on reconnect**
- Frontend reads `GET /jobs/{id}` on mount/reconnect to reconstruct stage state — no change to SSE contract
- No synthetic SSE re-emit from the pipeline for already-done steps; REST endpoint is the source of truth for historical stage state

**Parallel concurrency setting — backend**
- New key `max_parallel_chunks` added to `SETTINGS_DEFAULTS` in `db.py`, default value `1` (serial, safe)
- Pipeline reads this setting from the job's config snapshot; inner `ThreadPoolExecutor(max_workers=max_parallel_chunks)` handles concurrent chunk encoding
- DB writes from worker threads use `asyncio.run_coroutine_threadsafe` to call async DB functions from sync thread context
- Add `PRAGMA busy_timeout = 5000` to `get_db()` in db.py so concurrent chunk DB writers don't immediately raise SQLITE_BUSY
- Cancel: each job maintains a handle list (protected by `threading.Lock`) of active ffmpeg `Popen` objects; cancel endpoint iterates the list and terminates all; new chunks check `cancel_event` before starting

**Parallel concurrency setting — frontend**
- Location: SettingsModal (global setting, not per-profile)
- Label: "Max parallel encoders"
- Widget: Number input, `min=1`, max capped at the machine's CPU count
- CPU count exposed via a new `GET /api/system` endpoint returning `{ cpu_count: int }` — frontend reads this on SettingsModal open to set the input's `max` attribute
- Default displayed: 1 (matches SETTINGS_DEFAULTS)

**Parallel chunk live display**
- `chunk_progress` SSE payload already includes `chunk_index` — no SSE contract changes needed
- Frontend keys the "currently encoding" running indicator by `chunk_index` (not a single global flag)
- With N chunks in parallel: N rows simultaneously show `--` VMAF + a running indicator
- No UI state changes needed beyond keying the existing in-progress indicator by `chunk_index` instead of a single active slot

### Claude's Discretion
- Exact color/styling for the RESUMING badge (amber family, consistent with existing palette)
- How the handle list for cancel is structured (e.g., dict keyed by chunk index vs plain list)
- Whether to re-encode the "best" chunk file if it wasn't the last encode written (can keep all intermediate files until oscillation resolves, or re-encode the winner — simpler approach is re-encode the winner)
- Error handling if `GET /api/system` is unavailable (fallback: no max attribute on input)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-V2-01 | Multiple chunks can encode in parallel (configurable concurrency limit) | ThreadPoolExecutor inner executor pattern; asyncio.run_coroutine_threadsafe for cross-thread DB writes; PRAGMA busy_timeout; handle list for cancel |
| PIPE-V2-02 | Job resumes from last completed step after application crash/restart | get_steps() already exists; completed_steps set pattern; recover_stale_jobs() already resets on startup; new RESUMING status |
| PIPE-V2-03 | CRF oscillation resolution picks the encode closest to window center; equidistant prefers lower CRF | vmaf_history list replaces visited_crfs set; midpoint formula `(vmaf_min + vmaf_max) / 2`; re-encode winner if not last written |
</phase_requirements>

---

## Summary

Phase 6 makes three surgical improvements to the backend pipeline plus a small frontend addition. The changes are ordered from least to most invasive: CRF oscillation fix modifies only `_encode_chunk_with_vmaf()`; job resume adds a gate at the top of `run_pipeline()` plus a new `RESUMING` status; parallel encoding restructures the chunk loop to use an inner `ThreadPoolExecutor` and adds cross-thread DB write infrastructure.

The critical cross-cutting concern is thread safety. The pipeline already runs in a `ThreadPoolExecutor` thread (spawned by the scheduler). For parallel chunks, a second inner executor is spawned within that thread. All async DB functions (`create_chunk`, `update_chunk`, `append_job_log`, `set_job_eta`) must be called from worker threads using `asyncio.run_coroutine_threadsafe(coro, loop)` — the event loop reference must flow from the scheduler into `run_pipeline`. SQLite WAL mode is already configured; the missing piece is `PRAGMA busy_timeout = 5000` to give concurrent writers time to retry instead of raising `SQLITE_BUSY` immediately.

Cancel in parallel mode is the main new safety concern. Each job needs a handle list (a `dict[int, subprocess.Popen]` keyed by chunk index, protected by `threading.Lock`) so the cancel endpoint can terminate all in-flight ffmpeg processes. Workers check `cancel_event` before starting each chunk and pass it through to `_encode_chunk_with_vmaf()` which already checks it.

**Primary recommendation:** Implement in the documented order (06-01 CRF fix, 06-02 resume, 06-03 parallel) to avoid two passes through the same pipeline loop.

---

## Standard Stack

### Core (already in use — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `concurrent.futures.ThreadPoolExecutor` | stdlib | Parallel chunk execution | Already used by scheduler; well-understood cancel/shutdown semantics |
| `asyncio.run_coroutine_threadsafe` | stdlib | Call async DB functions from sync threads | The canonical bridge; returns a `concurrent.futures.Future` |
| `threading.Lock` | stdlib | Protect the ffmpeg handle dict | Minimal; guards one shared mutable dict |
| `threading.Event` | stdlib | Cancel signal already in use | Already threading.Event; shared across parallel workers |
| `aiosqlite` + WAL + `PRAGMA busy_timeout` | existing | SQLite concurrent writes | busy_timeout causes SQLite to retry on SQLITE_BUSY for up to N ms |

### No new packages required

All Phase 6 work uses stdlib threading primitives, the existing aiosqlite stack, and React state changes. No pip install or npm install needed.

---

## Architecture Patterns

### Pattern 1: Inner ThreadPoolExecutor for parallel chunks

The scheduler owns an outer `ThreadPoolExecutor(max_workers=1)` (one job at a time). For the chunk encode section inside `run_pipeline`, a second inner executor is created per job:

```python
# Source: confirmed pattern from docs + codebase audit
with concurrent.futures.ThreadPoolExecutor(max_workers=max_parallel_chunks) as chunk_executor:
    futures = {
        chunk_executor.submit(_encode_one_chunk, ...): i
        for i, chunk_in in enumerate(chunks_to_encode)
    }
    for future in concurrent.futures.as_completed(futures):
        result = future.result()  # raises if worker raised
```

The inner executor is job-scoped — created inside `run_pipeline`, not at the scheduler level. This ensures clean shutdown and cancel semantics per job.

**Key detail:** The inner executor lives inside the already-threaded `run_pipeline` function (which is running in the outer executor thread). Python allows creating new threads from within a thread pool thread. The inner executor completes before `run_pipeline` returns.

### Pattern 2: asyncio.run_coroutine_threadsafe bridge

Worker threads cannot `await` coroutines. They must use the bridge:

```python
# Source: Python stdlib docs
future = asyncio.run_coroutine_threadsafe(
    update_chunk(db_path, chunk_id, crf_used=crf, vmaf_score=vmaf, ...),
    loop,
)
future.result()  # blocks until the coroutine completes; raises on exception
```

The event loop reference must be captured in `_run_job` (`loop = asyncio.get_running_loop()`) and passed through `_run_pipeline_sync` into `run_pipeline`. Currently `_run_pipeline_sync` creates a new loop via `asyncio.new_event_loop()` — this is the loop that must be passed to worker threads for the bridge to work.

**Critical:** `asyncio.run_coroutine_threadsafe` requires the target loop to be running. In `_run_pipeline_sync`, the loop IS running (it's running `run_pipeline`). Worker threads dispatched within `run_pipeline` can safely call `run_coroutine_threadsafe(coro, loop)` against that same loop.

### Pattern 3: PRAGMA busy_timeout for concurrent SQLite writers

```python
# Add to get_db() in db.py
await db.execute("PRAGMA busy_timeout = 5000")
```

This tells SQLite to spin-wait up to 5000 ms before raising `SQLITE_BUSY`. WAL mode already allows one writer + many readers concurrently, but two concurrent writers still serialise. With a 5-second timeout, the second writer will wait rather than fail immediately.

### Pattern 4: CRF oscillation fix — vmaf_history list

Current code uses `visited_crfs: set[int]` and `best_crf/best_vmaf` updated each loop iteration (so `best_*` always reflects the last encode, not the best encode). The fix:

```python
vmaf_history: list[tuple[int, float]] = []   # (crf, vmaf) per attempt

for i in range(10):
    _encode_chunk_x264(chunk_path, encoded_path, crf, config, ...)
    vmaf = _vmaf_score(encoded_path, chunk_path)
    vmaf_history.append((crf, vmaf))

    if vmaf_min <= vmaf <= vmaf_max:
        break   # converged — last entry in vmaf_history is the winner

    # oscillation detection: same CRF already attempted
    if crf in {h[0] for h in vmaf_history[:-1]}:
        break   # oscillation exit — pick best from history below

    # adjust CRF ...

# Select winner from history
center = (vmaf_min + vmaf_max) / 2
best_crf, best_vmaf = min(
    vmaf_history,
    key=lambda h: (abs(h[1] - center), h[0])  # (distance, crf) — lower CRF wins tiebreak
)

# If best entry wasn't the last encode written, re-encode with that CRF
if best_crf != vmaf_history[-1][0]:
    _encode_chunk_x264(chunk_path, encoded_path, best_crf, config, ...)
```

The `min()` key `(abs(h[1] - center), h[0])` implements the exact REQUIREMENTS.md rule: closest to center first, lower CRF as tiebreak.

### Pattern 5: Job resume gate

At the top of `run_pipeline`, before any work begins:

```python
existing_steps = await get_steps(db_path, job_id)
completed_steps = {s["step_name"] for s in existing_steps if s["status"] == "DONE"}

existing_chunks = await get_chunks(db_path, job_id)
completed_chunk_indices = {c["chunk_index"] for c in existing_chunks if c["status"] == "DONE"}
```

Each step block becomes:

```python
if "FFV1" not in completed_steps:
    step_id = await create_step(db_path, job_id, "FFV1")
    # ... do the work ...
    await update_step(db_path, step_id, "DONE")
else:
    _log("Resuming: FFV1 already done, skipping")
```

For chunks: iterate all chunks; skip those in `completed_chunk_indices`; for non-DONE chunks, delete any existing output file before re-encoding from scratch.

### Pattern 6: RESUMING status

`recover_stale_jobs()` currently sets status to `QUEUED`. Change to `RESUMING`. The scheduler `_run_job` currently filters on `status not in ("QUEUED",)` — add `RESUMING` to the accepted set.

`update_job_status` already handles arbitrary status strings via the `else` branch, so no schema change is needed. Add `RESUMING` to:
- `JobStatus` type union in `frontend/src/types/index.ts`
- `StatusBadge.tsx` CFG dict
- `scheduler.py` `_run_job` accepted-status check

### Pattern 7: Cancel handle list for parallel chunks

```python
# In run_pipeline, scoped to the chunk encode section:
_chunk_handles: dict[int, subprocess.Popen] = {}
_handles_lock = threading.Lock()

def _register_handle(chunk_index: int, proc: subprocess.Popen) -> None:
    with _handles_lock:
        _chunk_handles[chunk_index] = proc

def _unregister_handle(chunk_index: int) -> None:
    with _handles_lock:
        _chunk_handles.pop(chunk_index, None)

def _cancel_all_handles() -> None:
    with _handles_lock:
        for proc in _chunk_handles.values():
            try:
                proc.terminate()
            except OSError:
                pass
```

The cancel_event is already checked in `_run_ffmpeg_cancellable`. When `cancel_event.is_set()`, `proc.cancel()` is called on the ffmpeg process generator. For parallel mode the handle list provides a backup that terminates all in-flight processes when the job is cancelled from the API.

### Anti-Patterns to Avoid

- **Putting the inner ThreadPoolExecutor at the scheduler level:** The scheduler executor is job-level (one job at a time). Parallel chunk encoding is a per-job concern that must be scoped inside `run_pipeline` so it tears down correctly on cancel/error.
- **Calling `asyncio.run()` from a worker thread:** This creates a new event loop per call and doesn't share the DB connection pool. Use `asyncio.run_coroutine_threadsafe` against the existing loop instead.
- **Using `future.result()` with no timeout in worker threads:** If a DB coroutine hangs, the worker thread hangs indefinitely. Add a reasonable timeout (e.g., `future.result(timeout=30)`) for DB operations.
- **Assuming `recover_stale_jobs()` creates steps rows for skipped steps:** It doesn't — it only resets the job status. The resume path reads existing step rows; if FFV1 completed before the crash, its step row exists with `status=DONE`. The resume gate skips re-execution but does not insert new step rows for already-done steps.
- **Forgetting to pass `loop` through `_run_pipeline_sync`:** Currently `_run_pipeline_sync` creates a new event loop with `asyncio.new_event_loop()`. This loop is the one worker threads must use for `run_coroutine_threadsafe`. The loop reference must flow into the worker thread closures.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel task dispatch | Custom thread management | `ThreadPoolExecutor` + `as_completed` | Handles exceptions, shutdown, timeout correctly |
| Async-from-thread calls | `asyncio.run()` in worker threads | `asyncio.run_coroutine_threadsafe` | Shares the running event loop; no new loop overhead |
| SQLite write contention | Retry logic in app code | `PRAGMA busy_timeout = 5000` | SQLite handles the retry internally; one line fix |
| Distance-to-center selection | Custom sort | `min(history, key=lambda h: (abs(h[1]-center), h[0]))` | stdlib `min` with compound key handles midpoint + tiebreak in one expression |

---

## Common Pitfalls

### Pitfall 1: SQLITE_BUSY without busy_timeout

**What goes wrong:** Two chunk workers both try to commit simultaneously. The second raises `sqlite3.OperationalError: database is locked` immediately (default timeout is 0 ms in some SQLite builds).
**Why it happens:** WAL mode allows concurrent readers but serialises writers. Without a timeout, the second write fails instantly.
**How to avoid:** Add `PRAGMA busy_timeout = 5000` to `get_db()` before any other work. This must land in Plan 06-03 before any parallel encode test.
**Warning signs:** `OperationalError: database is locked` in worker thread tracebacks.

### Pitfall 2: Event loop reference in worker threads

**What goes wrong:** Worker thread calls `asyncio.run_coroutine_threadsafe(coro, loop)` but `loop` is a different loop object than the one currently running — causes `RuntimeError: no current event loop` or silently posts to a stopped loop.
**Why it happens:** `_run_pipeline_sync` creates `loop = asyncio.new_event_loop()` and then runs `loop.run_until_complete(run_pipeline(...))`. Worker threads must capture this same `loop` object, not the scheduler's outer loop.
**How to avoid:** Capture the loop inside `run_pipeline` with `loop = asyncio.get_event_loop()` (which returns the loop currently running the coroutine) and pass it into worker thread closures.
**Warning signs:** `Future attached to a different loop` or `got Future <Future pending> attached to a different loop`.

### Pitfall 3: Orphaned ffmpeg processes on cancel

**What goes wrong:** Cancel is signalled after some workers have already launched `_encode_chunk_x264`. Workers check `cancel_event` between encode + VMAF score, but not mid-encode. A long encode keeps running even after cancel.
**Why it happens:** `_run_ffmpeg_cancellable` checks `cancel_event` between event loop iterations of the ffmpeg subprocess but if no events arrive (e.g. silent encode), the check is infrequent.
**How to avoid:** The handle list pattern (Pitfall N3 from STATE.md) — register each ffmpeg `Popen` in the handle dict on start, terminate all on cancel. The existing `proc.cancel()` in `_run_ffmpeg_cancellable` also works but the handle list is the backup.
**Warning signs:** ffmpeg processes visible in Task Manager after a cancelled job.

### Pitfall 4: create_step called for already-done steps on resume

**What goes wrong:** Resume path skips the work but still calls `create_step(db_path, job_id, "FFV1")` — creates a duplicate step row. The `_attach_stages` function then shows two FFV1 entries in the UI.
**Why it happens:** Forgetting that the `create_step` call must also be inside the `if not in completed_steps` guard.
**How to avoid:** The entire block `{ create_step → do work → update_step }` is inside the guard. When skipping, emit only a log line and the `stage` SSE event (so the UI highlights the stage), but do not insert a new step row.

### Pitfall 5: Chunk resume leaves orphaned output files

**What goes wrong:** A chunk was partially written before crash. On resume, the old partial file is re-used by `_encode_chunk_x264` (ffmpeg sees `-y` so overwrites, but if the file is corrupted/truncated, VMAF scoring may behave unpredictably).
**Why it happens:** `-y` overwrites rather than fails, but a partial file header can confuse libvmaf.
**How to avoid:** Before re-encoding a non-DONE chunk, explicitly `encoded_path.unlink(missing_ok=True)`. This is already stated in the CONTEXT.md locked decisions.

### Pitfall 6: scheduler _run_job status check excludes RESUMING

**What goes wrong:** `recover_stale_jobs()` sets status to `RESUMING`. The scheduler's `_run_job` skips any job not in `("QUEUED",)`. The RESUMING job is dequeued but immediately skipped — it never runs.
**Why it happens:** The status filter in `_run_job` was written before `RESUMING` existed.
**How to avoid:** Change the guard to `if job["status"] not in ("QUEUED", "RESUMING"):`.

---

## Code Examples

### CRF oscillation fix — complete replacement for `_encode_chunk_with_vmaf`

```python
# Source: derived from existing pipeline.py + locked decisions in 06-CONTEXT.md
def _encode_chunk_with_vmaf(
    chunk_path: Path,
    encoded_path: Path,
    config: dict,
    cancel_event=None,
    chunk_label: str = "chunk",
    on_progress=None,
) -> tuple[int, float, int]:
    crf: int = config["crf_start"]
    vmaf_min: float = config["vmaf_min"]
    vmaf_max: float = config["vmaf_max"]
    crf_min: int = config["crf_min"]
    crf_max: int = config["crf_max"]
    center: float = (vmaf_min + vmaf_max) / 2

    vmaf_history: list[tuple[int, float]] = []

    for _i in range(10):
        _check_cancel(cancel_event)
        _encode_chunk_x264(chunk_path, encoded_path, crf, config,
                           cancel_event=cancel_event, on_progress=on_progress)
        vmaf = _vmaf_score(encoded_path, chunk_path)
        vmaf_history.append((crf, vmaf))

        if vmaf_min <= vmaf <= vmaf_max:
            break  # converged

        tried = {h[0] for h in vmaf_history}
        if vmaf < vmaf_min:
            next_crf = crf - 1
        elif vmaf > vmaf_max:
            next_crf = crf + 1
        else:
            break

        if next_crf < crf_min or next_crf > crf_max or next_crf in tried:
            break  # bounds or oscillation

        crf = next_crf

    # Select the entry closest to window center; lower CRF breaks ties
    best_crf, best_vmaf = min(
        vmaf_history,
        key=lambda h: (abs(h[1] - center), h[0])
    )

    # Re-encode if the best entry was not the last written
    if best_crf != vmaf_history[-1][0]:
        _encode_chunk_x264(chunk_path, encoded_path, best_crf, config,
                           cancel_event=cancel_event, on_progress=on_progress)

    return (best_crf, best_vmaf, len(vmaf_history))
```

### Resume gate at top of run_pipeline

```python
# Source: derived from get_steps() in db.py + locked decisions in 06-CONTEXT.md
existing_steps = await get_steps(db_path, job_id)
completed_steps: set[str] = {s["step_name"] for s in existing_steps if s["status"] == "DONE"}

existing_chunks = await get_chunks(db_path, job_id)
completed_chunk_indices: set[int] = {
    c["chunk_index"] for c in existing_chunks if c["status"] == "DONE"
}

is_resuming = bool(completed_steps)
if is_resuming:
    await update_job_status(db_path, job_id, "RUNNING")
```

### asyncio.run_coroutine_threadsafe in worker thread

```python
# Source: Python stdlib docs — asyncio.run_coroutine_threadsafe
def _worker_encode_chunk(chunk_in, chunk_out, chunk_index, job_id, db_path, config,
                         cancel_event, loop, publish):
    # ... encode ...
    crf, vmaf, iters = _encode_chunk_with_vmaf(chunk_in, chunk_out, config, cancel_event)

    # Bridge: call async DB function from sync thread
    fut = asyncio.run_coroutine_threadsafe(
        update_chunk(db_path, chunk_id, crf_used=float(crf),
                     vmaf_score=vmaf, iterations=iters, status="DONE"),
        loop,
    )
    fut.result(timeout=30)  # raise on exception; timeout prevents indefinite hang

    publish("chunk_complete", {
        "chunk_index": chunk_index,
        "crf_used": crf,
        "vmaf_score": round(vmaf, 2),
        "iterations": iters,
    })
```

### GET /api/system endpoint

```python
# Source: derived from main.py patterns; os.cpu_count() is stdlib
@api.get("/system")
async def get_system_info():
    import os
    return {"cpu_count": os.cpu_count() or 1}
```

### RESUMING badge in StatusBadge.tsx

```typescript
// Source: derived from existing StatusBadge.tsx CFG pattern
// RESUMING: amber family — fc — distinguishes from QUEUED (#94a3b8) and RUNNING (#93c5fd)
RESUMING: { color: '#fcd34d', bg: '#1c1600', border: '#78350f', label: 'Resuming', pulse: true },
```

Note: `pulse: true` communicates "active recovery" which suits the amber color. The existing PAUSED badge also uses `#fcd34d` but with a different bg/border — using `#1c1600` bg and `#78350f` (darker amber) border makes RESUMING visually distinct from PAUSED.

### max_parallel_chunks in SettingsModal.tsx

```typescript
// Source: derived from existing numField pattern in SettingsModal.tsx
// Fetched from GET /api/system on modal open; stored in cpuCount state
const [cpuCount, setCpuCount] = useState<number | null>(null);
useEffect(() => {
  if (open) {
    fetch('/api/system').then(r => r.json()).then(d => setCpuCount(d.cpu_count)).catch(() => {});
  }
}, [open]);

// In the form:
<div>
  <label className="block text-xs text-neutral-400 mb-1">Max parallel encoders</label>
  <input
    type="number"
    min={1}
    max={cpuCount ?? undefined}
    step={1}
    className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
    value={settings?.max_parallel_chunks ?? 1}
    onChange={e => update('max_parallel_chunks', parseInt(e.target.value))}
  />
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `visited_crfs: set[int]`, `best_crf` = last encode | `vmaf_history: list[tuple[int,float]]`, `best_crf` = midpoint-closest | Phase 6 | Correct quality selection on oscillation |
| `recover_stale_jobs()` resets to QUEUED | resets to RESUMING | Phase 6 | UI communicates recovery vs fresh queue |
| Serial chunk loop | Inner ThreadPoolExecutor per job | Phase 6 | Parallel chunk throughput |
| Default busy_timeout = 0ms | `PRAGMA busy_timeout = 5000` | Phase 6 | Eliminates SQLITE_BUSY under parallel writes |

---

## Open Questions

1. **Loop reference threading through _run_pipeline_sync**
   - What we know: `_run_pipeline_sync` creates a new event loop via `asyncio.new_event_loop()` and runs `run_pipeline` on it. Worker threads need a reference to this loop.
   - What's unclear: The cleanest way to pass the loop — via a new `loop` parameter on `run_pipeline`, or captured inside `run_pipeline` via `asyncio.get_event_loop()`.
   - Recommendation: `asyncio.get_event_loop()` called inside `run_pipeline` returns the loop currently executing it (the one created by `_run_pipeline_sync`). No new parameter needed. Use `loop = asyncio.get_event_loop()` inside `run_pipeline` at the point where the inner executor is created.

2. **config snapshot propagation of max_parallel_chunks**
   - What we know: The config snapshot in `submit_job` currently copies only `vmaf_min`, `vmaf_max`, `crf_min`, `crf_max`, `crf_start`, `audio_codec` from settings. `max_parallel_chunks` must be added here.
   - What's unclear: Whether the value should be per-job (snapshotted at submit time) or always read live from settings at run time.
   - Recommendation: Per-job snapshot (consistent with existing config snapshot pattern). Add `max_parallel_chunks` to the `config_snapshot` dict in `submit_job`.

3. **ChunkTable in-progress indicator keying**
   - What we know: ChunkTable currently renders all `chunks` from the Zustand store. In-progress chunks are those with `chunk_progress` SSE received but no `chunk_complete` yet. The existing store likely tracks this as a single active slot.
   - What's unclear: Exact shape of the in-progress state in the store without reading the full store file.
   - Recommendation: Plan 06-03 implementer must read `useJobStore` to find how active chunk index is tracked before modifying ChunkTable.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (existing, confirmed in tests/) |
| Config file | none found — invoked directly |
| Quick run command | `pytest tests/test_pipeline.py -x -q` |
| Full suite command | `pytest tests/ -x -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-V2-03 | vmaf_history list, midpoint selection, tiebreak | unit | `pytest tests/test_pipeline.py::test_crf_oscillation_best_selection -x` | ❌ Wave 0 |
| PIPE-V2-03 | Re-encode winner when not last written | unit | `pytest tests/test_pipeline.py::test_crf_oscillation_reencodes_winner -x` | ❌ Wave 0 |
| PIPE-V2-02 | Completed steps are skipped on resume | unit (mock DB) | `pytest tests/test_pipeline.py::test_resume_skips_done_steps -x` | ❌ Wave 0 |
| PIPE-V2-02 | Non-DONE chunk output files deleted before re-encode | unit | `pytest tests/test_pipeline.py::test_resume_deletes_partial_chunk -x` | ❌ Wave 0 |
| PIPE-V2-01 | N=2 parallel chunks encode faster than serial | integration (requires ffmpeg) | `pytest tests/test_pipeline.py::test_parallel_faster_than_serial -x` | ❌ Wave 0 |
| PIPE-V2-01 | Cancel signals all parallel ffmpeg processes | integration | `pytest tests/test_pipeline.py::test_parallel_cancel_no_orphans -x` | ❌ Wave 0 |
| PIPE-V2-02 | recover_stale_jobs sets status to RESUMING | unit | `pytest tests/test_db.py::test_recover_stale_sets_resuming -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pytest tests/test_pipeline.py -x -q`
- **Per wave merge:** `pytest tests/ -x -q`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/test_pipeline.py` — add 6 new test functions for Phase 6 behaviors listed above
- [ ] `tests/test_db.py` — add `test_recover_stale_sets_resuming` function

*(Existing test infrastructure and fixtures in `tests/test_pipeline.py` cover the new tests — `_make_video`, `ffmpeg_bin`, and `tmp` fixtures are all reusable. No new conftest.py needed.)*

---

## Sources

### Primary (HIGH confidence)

- `src/encoder/pipeline.py` — full audit of `_encode_chunk_with_vmaf`, `run_pipeline`, `_run_ffmpeg_cancellable`; current data structures and control flow confirmed
- `src/encoder/db.py` — confirmed `get_steps()`, `get_chunks()`, `SETTINGS_DEFAULTS`, `recover_stale_jobs()`, `get_db()` patterns
- `src/encoder/scheduler.py` — confirmed `ThreadPoolExecutor(max_workers=1)`, `_cancel_events` dict, `_run_pipeline_sync` new-event-loop pattern
- `src/encoder/main.py` — confirmed `config_snapshot` fields in `submit_job`; located where `GET /api/system` must be added
- `frontend/src/types/index.ts` — confirmed `JobStatus` union lacks `RESUMING`
- `frontend/src/components/StatusBadge.tsx` — confirmed CFG dict shape and color palette
- `frontend/src/components/SettingsModal.tsx` — confirmed `numField` helper pattern; `Settings` interface location
- `frontend/src/api/settings.ts` — confirmed `Settings` interface lacks `max_parallel_chunks`
- `.planning/phases/06-pipeline-reliability/06-CONTEXT.md` — all locked decisions
- `.planning/REQUIREMENTS.md` — PIPE-V2-01/02/03 exact wording
- `.planning/ROADMAP.md` — plan outline for 06-01/02/03
- Python stdlib docs (asyncio.run_coroutine_threadsafe, ThreadPoolExecutor) — verified patterns

### Secondary (MEDIUM confidence)

- SQLite WAL mode + busy_timeout behavior — standard SQLite documentation behavior; cross-verified with aiosqlite usage already in codebase

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all patterns are stdlib or already in use
- Architecture: HIGH — all patterns derived from existing code audit + locked decisions in CONTEXT.md
- Pitfalls: HIGH — derived from code audit (the event loop threading pitfall is directly observable in _run_pipeline_sync)

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable stdlib patterns; no external dependencies to drift)
