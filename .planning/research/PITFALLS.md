# Domain Pitfalls

**Domain:** Cross-platform Python video encoding web application (ffmpeg, VMAF, PySceneDetect, WebSocket/SSE)
**Researched:** 2026-03-07 (v1.0) / Updated 2026-03-17 (v1.1 new features)
**Overall Confidence:** HIGH (verified against official docs, GitHub issues, and existing codebase structure)

---

## v1.1 Pitfalls — New Feature Additions

These pitfalls apply specifically to the v1.1 features being added to the existing
Python + asyncio + ThreadPoolExecutor + SQLite + React 19 system.

---

### Pitfall N1: Parallel Chunk Encoding — Concurrency at the Wrong Level

**What goes wrong:**
The current `Scheduler` creates `ThreadPoolExecutor(max_workers=1)`. For parallel chunk encoding, the naive fix is changing that to `max_workers=N`. But `run_pipeline` is a single task submitted to the executor — it runs serially inside one thread. Raising the executor's worker count gives you multiple *jobs* running simultaneously, not multiple *chunks* within one job.

**Why it happens:**
The boundary between "job concurrency" and "chunk concurrency" is easy to confuse. The pipeline is a single long synchronous function. The `_encoder` executor is job-scoped from the caller's perspective. Developers who see `ThreadPoolExecutor(max_workers=1)` and raise the number are acting on the wrong abstraction.

**How to avoid:**
Inside `run_pipeline`, replace the serial `for i, chunk_in in enumerate(chunks)` loop with a separate `concurrent.futures.ThreadPoolExecutor` scoped to the job (not the scheduler's executor). This inner pool submits `_encode_chunk_with_vmaf` per chunk. Keep the scheduler's executor at `max_workers=1` — one job runs at a time. The inner pool's size comes from `config["parallel_chunks"]` (configurable, default 2).

**Warning signs:**
- Chunk encode step uses full CPU but all chunk timestamps are sequential with no overlap
- Encoding throughput increases when `max_workers` is raised on the scheduler instead of inside the pipeline
- Cancelling a job stops only one encode when N should be stopped

**Phase to address:** Parallel chunk encoding

---

### Pitfall N2: SQLite SQLITE_BUSY Under Parallel Chunk Writes

**What goes wrong:**
When N chunk-encode threads all call `create_chunk` / `update_chunk` concurrently, they open short-lived write transactions via aiosqlite. WAL mode allows one writer at a time. The existing `_run_pipeline_sync` creates a new event loop per job — so each chunk thread also runs `asyncio.run()` in its thread, each with its own aiosqlite connection. Under parallel writes, SQLite's default busy timeout (0 ms — fail immediately) causes `sqlite3.OperationalError: database is locked` on write collisions.

**Why it happens:**
WAL mode was set up for the serial case: one writer at a time, and writes are infrequent (one per step, not per frame). Parallel chunks make writes far more concurrent. The default busy timeout is 0 ms, meaning any contention immediately raises an error.

**How to avoid:**
Add `PRAGMA busy_timeout = 5000` in `get_db()` — this makes SQLite retry for up to 5 seconds before returning SQLITE_BUSY. For typical 2–8 chunk parallelism this is sufficient; write transactions are short (a single `UPDATE` or `INSERT`). Add this to `get_db()` alongside the existing WAL and synchronous pragmas.

**Warning signs:**
- `sqlite3.OperationalError: database is locked` appears in logs during `chunk_encode` stage
- Errors occur only when `parallel_chunks >= 2`
- Error frequency increases with higher `parallel_chunks`

**Phase to address:** Parallel chunk encoding

---

### Pitfall N3: Cancel Event Stops Only the Active Worker, Not All Parallel Workers

**What goes wrong:**
In serial mode, `cancel_event.is_set()` is checked at the start of each chunk iteration, and `_run_ffmpeg_cancellable` calls `proc.cancel()` on the active process. In parallel mode, N workers are all mid-encode when cancel fires. Each worker holds its own stack-local `FfmpegProcess`. Setting `cancel_event` causes each worker's next `_check_cancel` call to raise — but `_check_cancel` is only called between VMAF scoring and re-encode attempts, not inside the running ffmpeg process. The in-flight processes are not signalled until they naturally complete.

**Why it happens:**
The current cancel design assumed one ffmpeg process active at a time. Parallel mode means N processes are running simultaneously. `FfmpegProcess` handles are stack-local and not externally accessible.

**How to avoid:**
Maintain a job-scoped list of active `FfmpegProcess` objects, protected by a `threading.Lock`. When the cancel event fires (detected in the dispatcher loop, not inside each worker), iterate the list and call `.cancel()` on each. Remove handles from the list when each worker's encode completes. This ensures all N ffmpeg processes receive the graceful quit signal within milliseconds of cancellation.

**Warning signs:**
- After clicking cancel, CPU stays pinned for seconds
- Cancel time scales linearly with `parallel_chunks` × average chunk encode time
- Log shows "Job cancelled" but additional `[Chunk N/M]` progress lines continue appearing

**Phase to address:** Parallel chunk encoding

---

### Pitfall N4: Job Resume Replays Already-Completed Steps

**What goes wrong:**
Resume logic reads `steps` rows for a job and re-enters the pipeline after the last DONE step. If the implementation calls `create_step` again for already-completed steps, the DB accumulates duplicate step rows. `_attach_stages` in `db.py` iterates all rows for a job — duplicates produce duplicate stage entries in the UI and incorrect `currentStage` derivation.

**Why it happens:**
`run_pipeline` calls `create_step` at the top of each step block. On resume, a developer adds a "skip if already done" check around the step *body* but leaves `create_step` outside the guard. Or the guard checks status correctly but doesn't skip the `create_step` call. The step creation and skip logic are not co-located.

**How to avoid:**
Before the pipeline loop begins, load all existing steps for the job into a `completed: set[str]` (set of `step_name` values with status DONE). Gate each step block entirely: `if "FFV1" not in completed: ...`. This includes the `create_step` call — do not create a new step row if one already exists. The FFV1 intermediate file check (does `intermediate.mov` exist?) provides a filesystem double-check but the DB is the authoritative source.

**Warning signs:**
- `SELECT count(*) FROM steps WHERE job_id=X` returns more than 8 rows after resume
- StageList shows duplicate entries for ffv1_encode or scene_detect
- Resumed job re-runs FFV1 encode even though the intermediate file is present and larger than the source

**Phase to address:** Job resume

---

### Pitfall N5: Resume Trusts Filesystem Existence Instead of DB Status

**What goes wrong:**
On resume, the pipeline finds the `chunks/` directory populated with chunk files. Some chunks are fully encoded (DB shows DONE); the last one written at crash time may be truncated. The naive resume path treats "file exists" as "chunk is complete" and skips re-encoding it, producing a corrupt output.

**Why it happens:**
Filesystem and DB state diverge when a crash occurs between the file being written and `update_chunk(..., status="DONE")` being called. The last chunk file is physically on disk but its DB row is still PENDING.

**How to avoid:**
Trust the DB, not the filesystem. A chunk is complete only if its `chunks` row has `status="DONE"`. On resume, for each chunk without a DONE row, delete the corresponding output file (if it exists) and re-encode from scratch. For DONE chunks, verify the encoded file still exists on disk; if not, re-encode and update the DB row.

**Warning signs:**
- Output MKV has a visible glitch or audio desync at a specific timestamp
- `ffmpeg` concat step fails with "Invalid data found when processing input"
- A chunk file is present on disk but smaller than 50 KB

**Phase to address:** Job resume

---

### Pitfall N6: Smart CRF Selection Uses Last Encode Instead of Best-Match

**What goes wrong:**
The current `_encode_chunk_with_vmaf` updates `best_crf`/`best_vmaf` on every iteration. When oscillation is detected (`crf in visited_crfs`), `best_vmaf` reflects the most recent encode — which may not be closest to the window center. The requirements say: "pick the encode whose VMAF is closest to the window center; if equidistant, prefer lower CRF." The current code does not implement this selection.

**Why it happens:**
The "best" selection feels like "keep track as you go" but the requirements require retrospective selection over the full history. The two approaches produce different results when oscillation occurs between a value above-center and one below-center.

**How to avoid:**
Accumulate a `history: list[tuple[int, float]]` of every `(crf, vmaf)` pair from every iteration. When the loop terminates (any reason: oscillation, bounds, maxiter, convergence), select the entry with `vmaf` closest to `(vmaf_min + vmaf_max) / 2`. Break ties by choosing the lower CRF. This is O(10) over max 10 entries and handles all termination modes uniformly. The convergence case (VMAF in window) does not need selection — the in-window result is already the winner.

**Warning signs:**
- Final VMAF scores consistently land at window boundaries (96.2 or 97.6) rather than near center
- Unit test: CRF sequence [17→16→17], VMAF [96.0→97.8→96.0], window [96.2–97.6], center 96.9 → should return CRF 16 (97.8 is 0.9 from center) not CRF 17 (96.0 is 0.9 from center — equidistant, lower CRF wins)
- The oscillation status path returns `best_vmaf` equal to the last encode's score

**Phase to address:** Smart CRF oscillation

---

### Pitfall N7: Browser Upload Reads Entire File into Memory

**What goes wrong:**
FastAPI's `UploadFile` uses a `SpooledTemporaryFile` with a 1 MB spool threshold. For files above 1 MB (every video file ever), the upload is written to a temp file — but if the handler calls `await file.read()`, the entire file is read into RAM before being written to the destination. A 20 GB MKV will OOM the server.

**Why it happens:**
The FastAPI documentation examples use `await file.read()` for simplicity. This is appropriate for small files (images, JSON). Developers copy this pattern without recognizing that multi-GB video files are categorically different.

**How to avoid:**
Stream the upload to disk in chunks: use `aiofiles.open(dest, 'wb')` and loop `while chunk := await file.read(1024 * 1024): await f.write(chunk)`. Store uploaded files in a dedicated `uploads/` subdirectory that is separate from the per-job temp directories — `_cleanup()` wipes `temp/job_N/` but must not touch `uploads/`. Delete the upload file after the job completes successfully or after a configurable retention period.

**Warning signs:**
- Server memory usage equals source file size during upload
- Upload endpoint returns 413 for files over the default body limit
- Upload succeeds but file on disk is smaller than source (truncated by memory limit)

**Phase to address:** Browser file upload

---

### Pitfall N8: Directory Browser Allows Arbitrary Filesystem Traversal

**What goes wrong:**
The existing `/api/browse` endpoint accepts an arbitrary `path` query parameter with no root restriction. A network-accessible instance (even LAN-only) exposes the full server filesystem to any client. A UI bug or malformed request can list system directories. `../` traversal in the path parameter bypasses the "only list directories that exist" check.

**Why it happens:**
The endpoint was written for local-only use where the server operator is the only user. There is no allowed-roots concept in the current implementation.

**How to avoid:**
Call `Path(path).resolve()` before any filesystem operation — this eliminates `../` traversal. Maintain a configurable `allowed_roots` list (default: all drive roots on Windows, `/` on Linux). Validate that the resolved path starts with at least one allowed root: `any(resolved.is_relative_to(root) for root in allowed_roots)`. Return HTTP 403 for paths outside the allowed roots. This is a single guard function, low complexity.

**Warning signs:**
- `GET /api/browse?path=../../../../windows/system32` returns results
- `Path(raw_path).resolve() != Path(raw_path)` in tests (path contained `..`)
- No root restriction in the browse handler code path

**Phase to address:** Directory browser

---

### Pitfall N9: Deleting a Running Job Leaves Orphaned ffmpeg Processes

**What goes wrong:**
A "delete job" endpoint that removes the DB row without first stopping the pipeline leaves `_run_pipeline_sync` running in the executor thread. It holds a `job_id` reference and continues calling `update_step`, `update_chunk`, etc. Those writes update rows that no longer exist (SQLite silently accepts UPDATE/DELETE with 0 rows matched). The ffmpeg processes keep running, consuming CPU and disk indefinitely.

**Why it happens:**
DELETE semantics in REST APIs mean "remove the resource." The pipeline running in a thread is not visible at the API layer — it's a background concern. Without explicit cancellation before deletion, the two concerns are disconnected.

**How to avoid:**
The delete endpoint must: (1) call `scheduler.cancel(job_id)` to set the cancel event, (2) mark the job CANCELLED in the DB (which the pipeline will read on its next `_check_cancel` call), (3) remove the DB row only after the pipeline thread has exited. A pragmatic approach: mark the job with a `deleted=1` flag (soft delete); after the pipeline thread exits and observes the cancel, a post-cleanup callback removes the row. If hard-delete is required, at minimum do cancel + wait for status to transition out of RUNNING before deleting.

**Warning signs:**
- CPU stays at 100% after deleting a running job
- ffmpeg processes remain visible in Task Manager after delete
- The `encoded/` directory continues to fill after deletion

**Phase to address:** Job deletion

---

### Pitfall N10: Cascading Delete Leaves Orphaned Steps, Chunks, and Logs

**What goes wrong:**
`DELETE FROM jobs WHERE id=?` removes only the job row. Without `PRAGMA foreign_keys = ON`, SQLite does not enforce the `REFERENCES jobs(id)` constraints on `steps`, `chunks`, and `seen_files`. The child rows remain, accumulating silently. The DB grows without bound over time; the orphaned rows can confuse resume logic on a future job with a recycled ID (SQLite auto-increment avoids this in practice, but the cleanup problem is real).

**Why it happens:**
SQLite's foreign key enforcement is **disabled by default** — it must be explicitly enabled per connection with `PRAGMA foreign_keys = ON`. This is a well-known SQLite gotcha. The existing `get_db()` does not set this pragma.

**How to avoid:**
Add `PRAGMA foreign_keys = ON` to `get_db()`. With this set, deleting a job row cascades automatically to `steps` and `chunks` (both have `REFERENCES jobs(id)`). Add `ON DELETE CASCADE` to those foreign key definitions if not already present. Verify with `DELETE FROM jobs WHERE id=1; SELECT count(*) FROM steps WHERE job_id=1;` — should return 0.

**Warning signs:**
- `SELECT count(*) FROM steps` keeps growing even after jobs are deleted
- `SELECT count(*) FROM chunks` same
- `PRAGMA foreign_key_list('steps')` shows no cascading action

**Phase to address:** Job deletion

---

### Pitfall N11: Auto-Cleanup Fires During Active Encoding, Deletes Just-Completed Jobs

**What goes wrong:**
A background `asyncio.create_task` that periodically deletes DONE jobs older than N days can delete a job the user just finished watching if the interval and threshold are misconfigured (e.g., "delete DONE jobs older than 1 hour" with a 1-hour check interval). More critically, if auto-cleanup runs while the SSE stream for a just-completed job is still open, it deletes the job row before the frontend receives the `job_complete` event and can update its state.

**Why it happens:**
The cleanup interval and retention period are often set too aggressively in development ("clean up after 1 hour") and not adjusted for production. The interaction between SSE stream lifecycle (client reads `job_complete` event → closes connection) and DB row deletion timing is not considered.

**How to avoid:**
The minimum retention period should default to 24 hours and be configurable. Auto-cleanup must check `finished_at < now() - retention_period` and use `DONE` status only (not CANCELLED jobs, which users may want to review). Use `PRAGMA foreign_keys = ON` to ensure cascading deletes are safe. The SSE stream endpoint should not depend on the job row existing after the `job_complete` event is delivered — close the stream before the row can be cleaned up.

**Warning signs:**
- Job cards disappear from the UI seconds after completing
- SSE stream returns an error event immediately after `job_complete`
- `GET /api/jobs/{id}` returns 404 for a job that was visible 30 seconds ago

**Phase to address:** Auto-cleanup

---

### Pitfall N12: Dark Mode Flash of Unstyled Light Mode on Load

**What goes wrong:**
If dark mode class is applied via a React `useEffect` that reads `localStorage`, the first render completes in light mode before the effect fires. On any machine where the component tree is non-trivial, this produces a visible white flash before the dark class is applied.

**Why it happens:**
`useEffect` runs after the first paint. `localStorage` is accessible in client-side React but not during server-side rendering. Even in pure Vite client builds, the render → paint → effect sequence means at least one frame is visible in light mode.

**How to avoid:**
Apply the dark class synchronously before the React bundle loads. In `index.html`, before the `<script>` tag for the Vite bundle:
```html
<script>
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
</script>
```
The React store reads `document.documentElement.classList.contains('dark')` on mount to initialize its own state, keeping it in sync. Tailwind's `darkMode: 'class'` strategy then applies correctly without flash.

**Warning signs:**
- Brief white flash visible when loading the page with dark mode active
- Flash is more visible on slower machines or large monitors
- Dark mode works correctly after load but always flashes on initial navigation

**Phase to address:** Dark mode

---

## Technical Debt Patterns (v1.1 Additions)

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Raise `max_workers` on scheduler executor for chunk parallelism | Trivial one-line change | Job-level concurrency instead of chunk-level; breaks cancel semantics | Never — wrong abstraction level |
| `await file.read()` for video uploads | One-line handler | OOM on files over 1 GB | Never for video files |
| Trust file existence for chunk resume | Simpler code path | Corrupt output on crash-mid-write | Never for encoded video files |
| No `busy_timeout` in `get_db()` | Works in serial mode | Intermittent SQLITE_BUSY under parallel chunk writes | Acceptable in serial-only; unacceptable for parallel chunks |
| Hard-delete job row without cancelling pipeline | Clean REST semantics | Orphaned ffmpeg processes consuming CPU indefinitely | Never |
| Auto-cleanup retention < 1 hour | Aggressive history pruning | Users lose completed jobs before reviewing them | Never as a default |
| Dark mode in `useEffect` | Simple React pattern | Visible flash on load | Never — use inline script instead |
| No `PRAGMA foreign_keys = ON` | Slightly simpler `get_db()` | Orphaned steps/chunks rows after delete | Never — add it to `get_db()` |

---

## Integration Gotchas (v1.1 Additions)

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| SQLite + parallel chunk threads | No `busy_timeout` set | Add `PRAGMA busy_timeout=5000` to `get_db()` alongside existing WAL pragma |
| `ThreadPoolExecutor` + parallel chunks | Submit entire pipeline to outer executor with higher `max_workers` | Use a separate inner executor scoped to the job for chunk parallelism |
| Cancel + parallel workers | Only set the `threading.Event`; don't signal active `FfmpegProcess` objects | Maintain a registry of active `FfmpegProcess` handles; call `.cancel()` on all of them |
| FastAPI `UploadFile` + large files | `await file.read()` buffering into RAM | Chunked `file.read(1MB)` streaming to disk via `aiofiles` |
| SQLite cascading deletes | Default `PRAGMA foreign_keys = OFF` leaves orphan rows | Add `PRAGMA foreign_keys = ON` in `get_db()` before any delete operation |
| Windows path in upload API response | `Path(dest)` returns backslashes | Normalize to forward slashes before returning from API |
| Dark mode init | `useEffect` reads `localStorage` after first paint | Inline `<script>` in `index.html` before Vite bundle |

---

## "Looks Done But Isn't" Checklist (v1.1 Additions)

- [ ] **Parallel chunk encoding:** Often missing cancel propagation to all workers — verify cancelling a running job stops all N ffmpeg processes within 3 seconds (check Task Manager on Windows)
- [ ] **Job resume:** Often missing the "skip already-completed steps" gate — verify that resuming a job interrupted during chunk_encode does NOT re-run FFV1 encode
- [ ] **Job resume:** Often missing corrupt chunk file detection — verify that a chunk file present on disk but not DONE in DB gets re-encoded rather than used
- [ ] **Smart CRF:** Often returns last-encode VMAF instead of center-closest — verify with unit test: CRF oscillation [17→16→17] returns CRF 16 when window center is equidistant
- [ ] **Browser upload:** Often OOMs on large files — verify 5 GB upload does not spike server memory above 500 MB
- [ ] **Directory browser:** Often missing path traversal prevention — verify `GET /api/browse?path=../../../../` returns 403
- [ ] **Job deletion (running):** Often missing cancel-before-delete — verify ffmpeg processes are gone in Task Manager after deleting a running job
- [ ] **Job deletion (cascading):** Often missing `PRAGMA foreign_keys = ON` — verify that `SELECT count(*) FROM steps WHERE job_id=X` returns 0 after delete
- [ ] **Auto-cleanup:** Often missing retention floor — verify a job completed 5 minutes ago is NOT deleted when auto-cleanup runs
- [ ] **Dark mode:** Often missing inline script — verify no white flash when opening app in a fresh browser tab with dark mode active

---

## Recovery Strategies (v1.1 Additions)

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Parallel cancel doesn't stop all workers | MEDIUM | Add `FfmpegProcess` registry to pipeline; call `.cancel()` on all active handles |
| SQLITE_BUSY under parallel chunks | LOW | Add `PRAGMA busy_timeout=5000` to `get_db()`; no schema change |
| Corrupt chunk from crash | LOW | Delete chunk file + reset DB row to PENDING; pipeline re-encodes only that chunk |
| Upload file OOM | LOW | Rewrite handler to use chunked streaming; no API contract change |
| Orphaned ffmpeg after delete | MEDIUM | Add cancel guard to delete endpoint; optionally add `deleted_at` soft-delete column |
| Orphaned step/chunk rows | LOW | Add `PRAGMA foreign_keys = ON` to `get_db()`; add `ON DELETE CASCADE` to schema |
| Dark mode flash | LOW | Add 3-line inline script to `index.html` |

---

## Pitfall-to-Phase Mapping (v1.1)

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| N1: Chunk parallelism at wrong level | Parallel chunk encoding | Confirm chunk timestamps overlap in pipeline logs |
| N2: SQLITE_BUSY under parallel writes | Parallel chunk encoding | Run `parallel_chunks=4`; check logs for "database is locked" |
| N3: Cancel doesn't stop all workers | Parallel chunk encoding | Cancel a running job; verify CPU drops and processes exit within 5s |
| N4: Resume replays completed steps | Job resume | Interrupt mid-job; restart; verify FFV1 step is skipped |
| N5: Resume uses corrupt chunk file | Job resume | Kill process mid-chunk-write; restart; verify output is playable |
| N6: CRF uses last instead of center-closest | Smart CRF | Unit test oscillation case with equidistant candidates |
| N7: Upload OOM | Browser upload | Upload a 5 GB file; server memory stays below 500 MB |
| N8: Browse path traversal | Directory browser | `GET /api/browse?path=../../../../` returns 403 |
| N9: Delete leaves orphaned ffmpeg | Job deletion | Delete running job; check Task Manager for ffmpeg processes |
| N10: Delete leaves orphan DB rows | Job deletion | `SELECT count(*) FROM steps WHERE job_id=X` after delete returns 0 |
| N11: Auto-cleanup deletes recent jobs | Auto-cleanup | Job completed 5 min ago survives a cleanup run |
| N12: Dark mode flash | Dark mode | No white flash in fresh incognito tab with dark mode active |

---

---

## v1.0 Pitfalls — Foundation

*Original research from 2026-03-07. All v1.0 pitfalls are resolved in the existing codebase.*

---

### Pitfall C1: The Subprocess Pipe Deadlock

**What goes wrong:** The Python process hangs indefinitely when an ffmpeg subprocess generates enough stderr/stdout output to fill the OS pipe buffer. Nobody reads the pipe, ffmpeg blocks writing, and the parent blocks waiting for ffmpeg.

**Why it happens:** Any `Popen` call using `stdout=PIPE` or `stderr=PIPE` without actively draining those pipes will deadlock once the pipe buffer (typically 64KB on Linux, 4KB on Windows) fills. ffmpeg is especially prone because it writes verbose progress data continuously to stderr.

**Consequences:** The encode worker thread hangs permanently. No error is raised. The job appears to be running but makes no progress. On long encodes (FFV1 intermediates can be gigabytes), this happens reliably.

**Prevention:**
- Always drain both stdout AND stderr concurrently — use a dedicated reader thread per pipe, or use `asyncio.create_subprocess_exec` with async stream readers.
- The canonical safe pattern: spawn two threads (one per pipe) that continuously read and process output, then call `process.wait()`.
- Never use `process.communicate()` for long-running ffmpeg jobs — it buffers all output in memory before returning, blocking real-time progress parsing.
- Do not use `stdout=PIPE` if you do not need stdout; use `subprocess.DEVNULL` instead.

**Detection:** Worker thread CPU usage drops to zero while ffmpeg is supposedly running. Job progress stops updating. `psutil` shows ffmpeg process stuck in pipe write syscall.

**Phase:** Address in the worker/queue implementation phase (core pipeline), before any UI work.

---

### Pitfall C2: Windows Asyncio Event Loop Cannot Spawn Subprocesses

**What goes wrong:** `asyncio.create_subprocess_exec()` raises `NotImplementedError` on Windows when uvicorn uses `SelectorEventLoop` (which it does in some configurations).

**Why it happens:** Windows has two asyncio event loop implementations. `SelectorEventLoop` (the Windows default in Python < 3.8, and sometimes forced by frameworks) does not support subprocess creation. Only `ProactorEventLoop` supports it. Uvicorn's event loop selection strategy has changed across versions — as of 0.36.0+, overriding the policy with `WindowsSelectorEventLoopPolicy` before `uvicorn.run()` no longer works reliably.

**Consequences:** The entire encoding pipeline silently fails on Windows when trying to launch ffmpeg asynchronously. The error only surfaces at runtime.

**Prevention:**
- Do not use `asyncio.create_subprocess_exec` directly in FastAPI route handlers or background tasks.
- Run all ffmpeg subprocesses in a dedicated worker thread pool (`ThreadPoolExecutor`) using synchronous `subprocess.Popen`. Communicate results back to the asyncio event loop via `asyncio.Queue` or `janus` (mixed sync/async queue).
- Explicitly set `asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())` at application startup on Windows, OR avoid async subprocess entirely.
- Verify at application startup: `assert sys.platform != 'win32' or isinstance(asyncio.get_event_loop(), asyncio.ProactorEventLoop)`.

**Detection:** `NotImplementedError` from `asyncio.create_subprocess_exec` on Windows only.

**Phase:** Address at the very start of the worker architecture phase. This is a foundational Windows compatibility decision.

---

### Pitfall C3: ffmpeg Graceful Cancellation Kills the Parent on Windows

**What goes wrong:** Sending `CTRL_C_EVENT` to an ffmpeg subprocess on Windows also kills the Python parent process. `p.terminate()` calls `TerminateProcess()` which kills ffmpeg immediately without flushing output, leaving partial/corrupt intermediate files.

**Why it happens:** On Windows, `os.kill(pid, signal.CTRL_C_EVENT)` broadcasts the event to the entire process group, not just the target process. Without `CREATE_NEW_PROCESS_GROUP`, the Python process is in the same group and receives the signal too.

On Linux, `p.terminate()` sends SIGTERM which ffmpeg handles gracefully (flushes output, writes valid file trailer). On Windows, there is no SIGTERM equivalent — you must either send `CTRL_C_EVENT` to a separate process group, or write `q\n` to ffmpeg's stdin.

**Consequences:** Partial .mov chunk files left on disk. The job queue has no record of what was cleaned up. Subsequent job runs find corrupt or incomplete intermediate files.

**Prevention:**
- Always spawn ffmpeg with `creationflags=subprocess.CREATE_NEW_PROCESS_GROUP` on Windows.
- For graceful stop: write `q\n` to ffmpeg's stdin (ffmpeg interprets this as user-requested quit and finalizes output), then wait up to 5 seconds, then `p.kill()`.
- Cross-platform cancel strategy:
  ```python
  import sys, signal, subprocess
  if sys.platform == 'win32':
      proc = subprocess.Popen(..., creationflags=subprocess.CREATE_NEW_PROCESS_GROUP, stdin=subprocess.PIPE)
      # To cancel: proc.stdin.write(b'q\n'); proc.stdin.flush()
  else:
      proc = subprocess.Popen(..., stdin=subprocess.PIPE)
      # To cancel: proc.send_signal(signal.SIGTERM)
  ```
- After cancellation, always trigger temp file cleanup regardless of process exit code.

**Detection:** Python process exits when cancelling a job. Partial files in CHUNKS/ or ENCODED/ directories after cancellation.

**Phase:** Cancellation logic must be designed before the queue worker is built. Retrofitting cross-platform cancel is painful.

---

### Pitfall C4: VMAF Model File Path — Windows Path Escaping in ffmpeg Filter Strings

**What goes wrong:** libvmaf on Windows fails to find its model file because the path passed inside an ffmpeg filter string uses Windows-style backslashes, which ffmpeg's filter parser interprets as escape characters.

**Why it happens:** ffmpeg's `-lavfi` / `-filter_complex` argument parser has its own escaping rules. On Windows, the model path `C:\path\to\vmaf_v0.6.1.json` inside a filter string is parsed as escape sequences. On Linux, the model has a known default install path; on Windows, there is no standard install location and the path must always be explicitly specified.

The correct Windows encoding requires double-escaped colons:
- Wrong: `libvmaf=model_path=C:\vmaf\vmaf_v0.6.1.json`
- Wrong: `libvmaf=model_path=C:/vmaf/vmaf_v0.6.1.json`
- Correct: `libvmaf=model_path=C\\:/vmaf/vmaf_v0.6.1.json`

**Consequences:** VMAF scoring silently fails or raises "could not parse model config" error. The feedback loop cannot read VMAF scores, halting all encodes.

**Prevention:**
- Use a dedicated path-escaping function for Windows model paths in filter strings:
  ```python
  def vmaf_model_path_for_filter(path: Path) -> str:
      posix = path.as_posix()  # forward slashes
      if sys.platform == 'win32':
          # Escape the drive letter colon: C:/path -> C\:/path
          posix = posix.replace(':', '\\:')
      return posix
  ```
- Store the VMAF model file alongside the ffmpeg binary (or in a configurable `models/` directory). Never rely on system default paths, especially not on Windows.
- Download the `.json` model files from the Netflix VMAF GitHub repository and bundle them with the application.
- Validate that the model path exists at application startup before accepting any jobs.

**Detection:** "could not parse model config" or "No such file or directory" in ffmpeg stderr for VMAF operations. VMAF score returns -1 or is absent from the JSON log.

**Phase:** Core pipeline phase — the VMAF feedback loop cannot be built without this solved first.

---

### Pitfall C5: VMAF Returns Zero or Wrong Score Due to Resolution/Format Mismatch

**What goes wrong:** libvmaf silently returns 0 or a nonsensical score when the distorted and reference videos differ in resolution, pixel format, or are not frame-synchronized.

**Why it happens:** libvmaf requires both inputs to have identical width, height, and pixel format. The FFV1 intermediate chunks and the x264-encoded chunks may have identical content but differ in chroma subsampling or pixel format (e.g., `yuv420p10le` vs `yuv420p`). Additionally, VMAF compares frames by position, not by timestamp — if PTS is not normalized to 0, frame pairing will be wrong.

**Consequences:** VMAF score is wrong (often 0 or very low), causing the CRF feedback loop to run to its ceiling without terminating correctly. Or score is falsely high, producing poor quality output without triggering re-encoding.

**Prevention:**
- Always include explicit format normalization in the VMAF filter graph:
  ```
  [0:v]scale=WxH:flags=bicubic,format=yuv420p,setpts=PTS-STARTPTS[dist];
  [1:v]scale=WxH:flags=bicubic,format=yuv420p,setpts=PTS-STARTPTS[ref];
  [dist][ref]libvmaf=...
  ```
- Extract `W` and `H` from the reference chunk using `ffprobe` before running VMAF.
- `setpts=PTS-STARTPTS` is mandatory for chunk-based comparison to reset timestamps to 0.
- Match pixel format explicitly — don't assume the x264 output will match the FFV1 source format.

**Detection:** VMAF feedback loop runs to CRF ceiling on every chunk. VMAF scores are suspiciously uniform (all 0, all 100, or always the same value). Check ffmpeg stderr for libvmaf warnings about dimension mismatch.

**Phase:** Core pipeline phase — validate VMAF scoring works correctly against a known-good chunk pair before building the feedback loop logic.

---

## Moderate Pitfalls (v1.0)

These cause correctness bugs or reliability issues that are painful but recoverable.

---

### Pitfall M1: Job State "Running" After Crash — Ghost Jobs on Restart

**What goes wrong:** If the server crashes while a job is in `RUNNING` state, it restarts with that job still marked as running in the database. The worker never picks it back up. The job is stuck forever.

**Why it happens:** A simple status field with values `(queued, running, done, failed)` has no mechanism to distinguish "actively being processed" from "was processing when we crashed." SQLite has no row-level locks and no TTL mechanism.

**Consequences:** Queue accumulates ghost jobs. User cannot re-queue or retry the job because the system thinks it is running. Temp files from the aborted job are never cleaned up.

**Prevention:**
- Add a `heartbeat_at` timestamp column to the job record. The worker updates it every 10–30 seconds while the job is active.
- On startup, query for jobs in `RUNNING` state where `heartbeat_at < now() - 60s`. Transition these to `FAILED` with reason "Interrupted by server restart" and enqueue cleanup.
- Store `worker_pid` alongside job state. On startup, check if that PID is alive; if not, the job is orphaned.
- Always use a database transaction when transitioning job state to prevent partial updates.

**Detection:** Jobs stuck in "Running" after server restart. No ffmpeg process with the expected PID exists.

**Phase:** Queue persistence design phase.

---

### Pitfall M2: ffmpeg Progress Parsing — Carriage Return vs Newline

**What goes wrong:** ffmpeg writes progress updates using carriage return (`\r`) rather than newline (`\n`), overwriting the current line in a terminal. Reading stderr with `readline()` blocks indefinitely because no newline is ever written until the process ends.

**Why it happens:** ffmpeg's default stats output format writes `\r` + updated stats repeatedly on the same line. `readline()` only returns when it sees `\n`.

**Consequences:** Real-time progress updates never arrive. The UI shows no progress until the entire encode finishes, then all lines arrive at once.

**Prevention:**
- Read character-by-character from stderr and split on both `\r` and `\n`, OR
- Use ffmpeg's dedicated progress protocol: pass `-progress pipe:1 -nostats` which writes structured `key=value\n` pairs to stdout at regular intervals. This is parseable line-by-line and is the correct solution.
- The `-progress` output provides: `frame`, `fps`, `total_size`, `out_time_ms`, `dup_frames`, `drop_frames`, `speed`, `progress` (continues/end).
- Extract duration from a preliminary `ffprobe` call, then compute `out_time_ms / duration_ms * 100` for percentage.

**Detection:** Progress bar never moves until encode finishes. All progress lines arrive simultaneously at job completion.

**Phase:** Worker implementation phase, before connecting progress to the UI.

---

### Pitfall M3: Concat List File — "Unsafe File Name" and Path Spaces

**What goes wrong:** ffmpeg's concat demuxer rejects file paths in the concat list that contain spaces, absolute paths, or Windows drive letters when running with the default `safe=1` mode.

**Why it happens:** The concat demuxer's safety check rejects paths containing `..`, absolute paths, or paths with characters outside a safe set. Any user with spaces in their path (e.g., `D:\My Videos\`) will hit this.

**Consequences:** The final merge step fails silently or with a cryptic "Unsafe file name" error. All chunk encoding work is lost.

**Prevention:**
- Always pass `-safe 0` to the concat demuxer: `ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4`
- Write concat list files using absolute POSIX-style paths (using `Path.as_posix()`).
- Alternatively, use relative paths in the concat list by writing it to the same directory as the chunks and running ffmpeg from that directory (but this complicates process management).
- Quote paths in the concat list that contain spaces using single quotes: `file '/path/with spaces/chunk1.mov'`

**Detection:** "Unsafe file name" error in ffmpeg stderr during the concat step.

**Phase:** Pipeline implementation phase, during concat step development.

---

### Pitfall M4: PySceneDetect API Instability — Pin to Minor Version

**What goes wrong:** PySceneDetect 0.6 was a major breaking change from 0.5 (new backend system, deprecated `VideoManager`, new API surface). The API is documented as still evolving toward 1.0. Unpinned dependencies will pull in breaking changes silently.

**Why it happens:** PySceneDetect's own docs warn: "The current SceneDetector API is under development and expected to change somewhat before v1.0." The project is actively developed and makes breaking changes between minor versions.

Specific breaking changes in 0.6:
- `VideoManager` replaced by `scenedetect.backends` (e.g., `open_video`)
- `detect_scenes()` no longer shows a progress bar by default
- Logger is named `pyscenedetect` and has no default handlers (silently drops messages)

**Consequences:** Upgrading PySceneDetect breaks scene detection silently or with confusing errors. CSV output format may change.

**Prevention:**
- Pin PySceneDetect to a specific minor version: `scenedetect>=0.6.7,<0.7`
- Use only the stable CLI interface via subprocess (not the Python API) if stability is more important than integration depth. The CLI output format is more stable than the API.
- If using the Python API, wrap it in an adapter layer so changes are isolated.
- Variable framerate (VFR) sources are known-broken in PySceneDetect — detect VFR sources at input validation and warn the user.

**Detection:** `AttributeError` or `ImportError` on PySceneDetect after an upgrade. Scene detection produces no output or wrong scene count.

**Phase:** Input pipeline phase (scene detection step).

---

### Pitfall M5: WebSocket/SSE — Lost Progress Events on Reconnect

**What goes wrong:** The browser disconnects from the WebSocket or SSE stream (page refresh, tab sleep, network blip) and reconnects. The new connection receives no historical progress — it appears as if the job has no progress until the next event fires.

**Why it happens:** WebSocket connections are stateless — when a client reconnects, the server treats it as a brand-new connection with no shared state. If progress events are only pushed to active connections, reconnecting clients miss all prior events.

**Consequences:** User sees a blank progress bar after reconnecting. They cannot tell if the job is running or stuck.

**Prevention:**
- Maintain the last known progress state for each job in the job record (or an in-memory dict keyed by job ID).
- On WebSocket/SSE connection, immediately emit the current state for all active jobs before subscribing to future events.
- For SSE: use `id:` fields on events and honor `Last-Event-ID` on reconnect to replay missed events from a small ring buffer.
- Implement server-side heartbeat (ping every 15–30s) so the client can detect a stale connection before the user notices.

**Detection:** Progress bar resets to 0% when the browser tab is refreshed mid-encode.

**Phase:** Real-time progress phase, after the WebSocket/SSE transport is chosen.

---

### Pitfall M6: Temp File Accumulation on Crash or Cancellation

**What goes wrong:** FFV1 intermediates, chunk files, and encoded chunks are never deleted when a job is cancelled or the server crashes mid-encode. Over multiple failed jobs, disk space is exhausted.

**Why it happens:** `atexit` handlers are not called when Python receives an unhandled signal (SIGKILL, OOM killer, hard reboot). Cleanup code in a `finally` block is skipped if the process is forcibly killed. On Windows, temp files from a running process cannot be deleted until the process releases them.

**Consequences:** Disk fills up. Subsequent jobs fail to allocate temp space. Orphaned FFV1 files (which can be 10x the source size) are the primary risk.

**Prevention:**
- Store all temp file paths in the job database record (as a JSON array) at the moment each file is created — before writing to it.
- On job startup, the worker registers what it will create. On job failure or cancellation, the cleanup routine queries the database for the file list and deletes them.
- On server startup, run a cleanup pass: any job in `FAILED` or `CANCELLED` state that still has files listed in its `temp_files` column should have those files deleted.
- Use a dedicated temp directory per job (e.g., `TEMP/{job_id}/`) so that `shutil.rmtree(job_temp_dir)` cleans everything in one call.
- On Windows: ffmpeg holds file handles open during encoding. Ensure the ffmpeg process is fully terminated (not just "killing" its PID) before attempting file deletion.

**Detection:** Disk usage grows monotonically. TEMP/ directory contains directories from old job IDs.

**Phase:** Queue/worker phase, during job lifecycle design.

---

## Minor Pitfalls (v1.0)

These cause friction but are straightforward to fix.

---

### Pitfall m1: pathlib on Windows Returns WindowsPath — ffmpeg Args Need Strings

**What goes wrong:** Passing a `pathlib.WindowsPath` object directly to `subprocess.Popen` args list works in Python, but `Path.as_posix()` returns forward-slash paths that some Windows tools or ffmpeg filter arguments still misinterpret.

**Prevention:**
- Always call `str(path)` when building subprocess argument lists — Python handles the OS-correct format.
- Use `Path.as_posix()` only when building ffmpeg filter strings (e.g., VMAF model paths, concat list paths) where the ffmpeg filter parser expects forward slashes.
- Use `pathlib.Path` for all file operations internally; only convert to string at the boundary (subprocess args, filter strings, database storage).
- Store paths in the database as POSIX strings (forward slashes) for portability; reconstruct as `Path` objects on load.

**Phase:** Foundational — establish this convention in Phase 1, not retrofitted later.

---

### Pitfall m2: ffmpeg Progress Protocol — Duration Not Available for All Operations

**What goes wrong:** ffmpeg's `-progress` output provides `out_time_ms` (elapsed encode time) but not `total_duration`. Without knowing total duration, percentage cannot be computed.

**Prevention:**
- Run `ffprobe -v quiet -print_format json -show_format -show_streams input.mkv` before each encode to extract duration.
- Cache the probe result in the job record. Do not re-probe during encoding.
- Some container formats (notably MPEG-TS) do not report accurate duration from ffprobe — fall back to frame-count-based progress (`frame / total_frames`).
- For FFV1 intermediate encoding, duration is known from the source probe. For chunk encoding, duration is known per-chunk from the split metadata.

**Phase:** Worker implementation phase.

---

### Pitfall m3: PySceneDetect Scene CSV Timestamp Format — Parsing Fragility

**What goes wrong:** PySceneDetect's CSV output uses timecode strings (`HH:MM:SS.mmm`) not frame numbers. If parsed naively or if framerate detection is wrong, the ffmpeg split timestamps are off by a fraction of a frame, causing scene boundaries to fall mid-frame.

**Prevention:**
- Use PySceneDetect's `--output-dir` with `--save-images` disabled and `--stats-file` to get frame-accurate output.
- Prefer using PySceneDetect's Python API (despite version caveats) to get scene objects with both timecode and frame-number fields, rather than parsing CSV output.
- If using CLI output, parse the `Start Frame` column directly rather than the timecode string.
- Validate that ffmpeg split output chunk count matches PySceneDetect scene count ±1.

**Phase:** Scene detection / chunking pipeline phase.

---

### Pitfall m4: SQLite WAL Mode Not Enabled — Blocking Reads During Writes

**What goes wrong:** With default SQLite journal mode, a write transaction (job status update from worker) blocks all readers (web UI polling for job list). The UI appears to freeze or times out.

**Prevention:**
- Enable WAL mode at database creation: `PRAGMA journal_mode=WAL;`
- Set `check_same_thread=False` when creating the SQLite connection for multi-threaded access, and use a connection-per-thread or connection pool strategy.
- Keep write transactions short — update only the status field, not the entire job row, during hot-path worker loops.

**Phase:** Database schema phase.

---

### Pitfall m5: CRF Feedback Loop — No Convergence Guard

**What goes wrong:** The VMAF feedback loop adjusts CRF by ±1 per iteration. If VMAF oscillates around the target (e.g., CRF 18 gives VMAF 96.1, CRF 17 gives VMAF 97.8, alternating forever), the loop never terminates.

**Prevention:**
- Track CRF values already tried in the current iteration. If a CRF is revisited, accept the closest result and exit.
- Add a maximum iteration count (e.g., `max_iterations=10`).
- If `crfMin` and `crfMax` are both exhausted without hitting the target, accept the best result and log a warning.
- Store all VMAF results per chunk to surface quality outliers in the UI.

**Phase:** VMAF feedback loop implementation phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Parallel chunk encoding | Wrong executor level (N1) | Inner executor per job, not outer scheduler executor |
| Parallel chunk encoding | SQLITE_BUSY (N2) | `PRAGMA busy_timeout=5000` in `get_db()` |
| Parallel chunk encoding | Cancel only stops one worker (N3) | FfmpegProcess registry + call `.cancel()` on all active handles |
| Job resume | Replays completed steps (N4) | Gate each step on `step_name not in completed_steps` set |
| Job resume | Corrupt chunk file trusted (N5) | Trust DB status, not file existence |
| Smart CRF | Returns last instead of center-closest (N6) | Accumulate full history; select by distance to window center |
| Browser upload | OOM on large files (N7) | Chunked streaming to disk; aiofiles |
| Directory browser | Path traversal (N8) | `Path.resolve()` + allowed_roots validation |
| Job deletion | Orphaned ffmpeg processes (N9) | Cancel before delete |
| Job deletion | Orphan DB rows (N10) | `PRAGMA foreign_keys = ON` in `get_db()` |
| Auto-cleanup | Deletes recently-completed jobs (N11) | Minimum retention 24h; configurable |
| Dark mode | Flash on load (N12) | Inline script in `index.html` before bundle |
| Worker architecture | Windows asyncio event loop (C2) | Sync-in-thread with ThreadPoolExecutor |
| ffmpeg subprocess launch | Pipe deadlock (C1) | Dedicated reader threads; never `communicate()` |
| Job cancellation | Windows graceful kill (C3) | `CREATE_NEW_PROCESS_GROUP` + stdin `q\n` |
| VMAF integration | Model path on Windows (C4) | `escape_vmaf_path()` utility |
| VMAF scoring | Resolution/format mismatch (C5) | Explicit scale+format in filter graph |
| Database design | Ghost jobs on restart (M1) | `heartbeat_at` column + startup recovery |
| Database | SQLite blocking (m4) | WAL mode enabled in `get_db()` |

---

## Sources

- Existing codebase: `src/encoder/scheduler.py`, `src/encoder/pipeline.py`, `src/encoder/db.py`, `src/encoder/ffmpeg.py`
- Python `concurrent.futures` docs — cancel semantics: https://docs.python.org/3/library/concurrent.futures.html
- SQLite WAL and busy timeout: https://www.sqlite.org/wal.html
- SQLite foreign keys: https://www.sqlite.org/foreignkeys.html (disabled by default — must enable per connection)
- FastAPI `UploadFile` source — `SpooledTemporaryFile` with 1 MB spool: https://github.com/encode/starlette/blob/master/starlette/datastructures.py
- Tailwind CSS dark mode class strategy: https://tailwindcss.com/docs/dark-mode
- Python subprocess documentation — pipe deadlock warning: https://docs.python.org/3/library/subprocess.html
- ffmpeg-progress-yield PyPI: https://pypi.org/project/ffmpeg-progress-yield/
- Graceful ffmpeg stop on Windows (Camratus blog): https://camratus.com/blog/_Python__Graceful_stop_FFMPEG_recording_process_on_Windows-55
- Windows CTRL_C_EVENT process group (concourse issue): https://github.com/concourse/concourse/issues/2368
- Netflix VMAF ffmpeg documentation: https://github.com/netflix/vmaf/blob/master/resource/doc/ffmpeg.md
- VMAF Windows path escaping (Streaming Learning Center): https://streaminglearningcenter.com/blogs/compute-vmaf-using-ffmpeg-on-windows.html
- PySceneDetect changelog: https://www.scenedetect.com/changelog/
- asyncio Windows subprocess support: https://docs.python.org/3/library/asyncio-platforms.html
