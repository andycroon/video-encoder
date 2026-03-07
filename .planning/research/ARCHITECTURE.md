# Architecture Patterns

**Project:** VibeCoder Video Encoder
**Domain:** Cross-platform Python video encoding queue web application
**Researched:** 2026-03-07
**Overall confidence:** HIGH (core patterns verified against official docs and multiple sources)

---

## Recommended Architecture

**Pattern:** Web-Queue-Worker with embedded process supervisor

This is the canonical architecture for long-running CPU/IO-bound tasks behind a web interface. The web frontend handles API and UI; a queue stores job state durably; a worker supervisor manages subprocess execution and streams events back to connected clients.

No external broker (Redis, RabbitMQ) is required. SQLite with WAL mode serves as both the job store and the persistent queue. This eliminates external service dependencies and makes the application self-contained — a single `python -m videoencoder` starts everything.

```
Browser
  |
  | HTTP REST + SSE (progress stream)
  v
FastAPI Web Server (single process)
  |-- REST endpoints: add job, pause, cancel, reorder, config
  |-- SSE endpoints: /jobs/{id}/progress  (per-job event stream)
  |-- Static file serving: SvelteKit or plain HTML/JS UI
  |
  | reads/writes
  v
SQLite Database (WAL mode)
  |-- jobs table      (id, state, config, created_at, updated_at)
  |-- steps table     (job_id, step_name, state, started_at, ended_at)
  |-- events table    (job_id, ts, payload JSON) -- ring buffer for SSE replay
  |
  | polls + notifies
  v
Job Scheduler (asyncio background task, same process)
  |-- Watches queue: pulls QUEUED jobs up to concurrency limit
  |-- Respects pause/cancel signals written to DB by REST endpoints
  |-- Spawns PipelineRunner per job
  |
  v
PipelineRunner (one per active job, asyncio coroutine)
  |-- Executes pipeline steps sequentially
  |-- Each step runs one or more FfmpegSubprocess instances
  |-- Writes step progress + events to DB
  |-- Broadcasts events to SSE EventBus
  |
  v
FfmpegSubprocess (thin wrapper, one per ffmpeg invocation)
  |-- asyncio.create_subprocess_exec (cross-platform, no shell=True)
  |-- reads -progress pipe:2 (or a temp file) for structured key=value progress
  |-- supports graceful cancel: write 'q\n' to stdin first, then terminate()
  |-- yields Progress objects upstream to PipelineRunner
  |
  v
SSE EventBus (in-process pub/sub)
  |-- asyncio.Queue per connected SSE client
  |-- PipelineRunner pushes events in; SSE endpoint drains out
  |-- Client reconnect: replays last N events from DB events table
  |
  v
WatchFolder Monitor (optional, asyncio background task)
  |-- watchdog library: cross-platform OS events (inotify/ReadDirectoryChanges)
  |-- On new .mkv detected: POST to job queue internally
```

---

## Component Boundaries

### 1. FastAPI Web Server

**Responsibility:** HTTP API, SSE streaming, static file serving. Entry point for all user actions.

**Communicates with:**
- SQLite (read/write job state, config)
- SSE EventBus (subscribe per client connection)
- Job Scheduler (signals via DB state changes, not direct calls)

**Does NOT:**
- Run subprocesses directly
- Block on long operations (all subprocess work is in background tasks)

**Boundary rule:** The web server is stateless beyond what is in SQLite. If the process restarts, it recovers by reading DB state.

---

### 2. SQLite Database (WAL mode)

**Responsibility:** Durable job state, pipeline step state, configuration, event replay buffer.

**Schema sketch:**

```sql
CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,       -- UUID
    input_path  TEXT NOT NULL,
    output_path TEXT NOT NULL,
    config_json TEXT NOT NULL,          -- VMAF targets, CRF bounds, audio codec
    state       TEXT NOT NULL,          -- QUEUED | RUNNING | PAUSED | DONE | FAILED | CANCELLED
    priority    INTEGER DEFAULT 0,      -- higher = sooner
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    error_msg   TEXT
);

CREATE TABLE steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT NOT NULL REFERENCES jobs(id),
    step_name   TEXT NOT NULL,          -- ffv1_encode | scene_detect | split | audio | chunk_encode | vmaf | concat | mux | cleanup
    state       TEXT NOT NULL,          -- PENDING | RUNNING | DONE | FAILED | SKIPPED
    chunk_index INTEGER,                -- NULL for non-chunk steps; chunk number for per-chunk steps
    crf_used    REAL,
    vmaf_score  REAL,
    started_at  REAL,
    ended_at    REAL
);

CREATE TABLE events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT NOT NULL REFERENCES jobs(id),
    ts          REAL NOT NULL,
    event_type  TEXT NOT NULL,          -- progress | state_change | error | log
    payload     TEXT NOT NULL           -- JSON
);
-- Keep last 500 events per job (prune on insert via trigger or app logic)
```

**WAL mode configuration (applied on connection open):**
```python
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA synchronous=NORMAL")
conn.execute("PRAGMA busy_timeout=5000")
```

**Concurrency model:** Single writer at a time (DB-level lock). The Job Scheduler owns all writes from PipelineRunner coroutines via an asyncio lock + dedicated writer thread pattern. REST endpoints do their own writes (job creation, pause/cancel state changes) — these are short transactions. WAL mode allows concurrent reads during writes.

---

### 3. Job Scheduler

**Responsibility:** Pull QUEUED jobs from DB and dispatch to PipelineRunner. Enforce concurrency limit (default: 1 job at a time — encoding is CPU-bound). Poll for pause/cancel signals.

**Communicates with:**
- SQLite (polls for QUEUED jobs, writes RUNNING state)
- PipelineRunner (spawns as asyncio task)

**Implementation:** An asyncio background task started at server startup via FastAPI lifespan. Uses `asyncio.sleep(1)` polling loop or SQLite change notification via a lightweight asyncio queue that REST endpoints push to when state changes.

**Pause/Cancel flow:**
- REST endpoint writes `state=PAUSED` or `state=CANCELLED` to DB.
- Scheduler polls DB periodically (or uses in-process notification queue).
- PipelineRunner checks a cancellation flag before each pipeline step; for mid-step cancellation, calls `FfmpegSubprocess.cancel()`.
- No cross-process signaling needed — everything is in one Python process.

---

### 4. PipelineRunner

**Responsibility:** Execute all 10 pipeline steps for one job sequentially. Manage the CRF feedback loop per chunk. Report progress to EventBus and DB.

**Communicates with:**
- FfmpegSubprocess (awaits one or more per step)
- SQLite (writes step state, VMAF scores, CRF used)
- SSE EventBus (pushes progress events)
- Job Scheduler (signals via asyncio.Event or return value)

**Pipeline step mapping:**

```
Step 1:  ffv1_encode       -- FfmpegSubprocess: source.mkv → temp/ffv1.mov
Step 2:  scene_detect      -- Python call: scenedetect API (not subprocess, Python lib)
Step 3:  split             -- FfmpegSubprocess per scene: temp/ffv1.mov → chunks/chunk_N.mov
Step 4:  audio             -- FfmpegSubprocess: source → FLAC → target codec
Step 5+: chunk_encode      -- FfmpegSubprocess: chunk_N.mov → encoded/chunk_N.mp4 (CRF loop)
Step 6:  vmaf_score        -- FfmpegSubprocess with libvmaf: per chunk
Step 7:  crf_feedback      -- Loop: if VMAF out of range, adjust CRF ±1, re-run step 5+6
Step 8:  concat            -- FfmpegSubprocess: concat list → temp/concat.mp4
Step 9:  mux               -- FfmpegSubprocess: concat.mp4 + audio → final.mkv
Step 10: cleanup           -- Python: shutil.rmtree on temp dirs
```

**CRF feedback loop implementation:**
```python
async def encode_chunk_with_vmaf(chunk, config, cancel_event):
    crf = config.crf_start
    while True:
        await ffmpeg_encode_chunk(chunk, crf, cancel_event)
        vmaf = await ffmpeg_vmaf_score(chunk, cancel_event)
        if config.vmaf_min <= vmaf <= config.vmaf_max:
            break
        if vmaf < config.vmaf_min and crf > config.crf_min:
            crf -= 1
        elif vmaf > config.vmaf_max and crf < config.crf_max:
            crf += 1
        else:
            break  # Hit CRF bounds, accept result
    return crf, vmaf
```

**Parallelism decision:** Steps 5-6 (per-chunk encode + VMAF) are independent across chunks. Running them in parallel is possible (`asyncio.gather`) but trades predictable progress reporting for throughput. Recommended default: sequential chunk processing for simpler cancellation and progress tracking. Make parallelism a later configurable option.

---

### 5. FfmpegSubprocess

**Responsibility:** Spawn a single ffmpeg invocation, parse progress output, support cancellation.

**Communicates with:**
- OS process (via asyncio subprocess)
- PipelineRunner (yields progress updates, raises on failure)

**Cross-platform subprocess pattern:**

```python
import asyncio
import sys

async def run_ffmpeg(cmd: list[str], cancel_event: asyncio.Event):
    # On Windows: ProactorEventLoop is default in Python 3.8+, supports subprocess
    # On Linux: SelectorEventLoop with child watcher, supports subprocess
    # No special loop configuration needed in Python 3.10+

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.PIPE,
    )
    # read stderr line by line for progress; -progress pipe:2 writes key=value there
    ...
```

**FFmpeg progress parsing:** Use `-progress pipe:2` (stderr) to get machine-readable key=value lines:
- `frame=N` — frames encoded
- `fps=N` — encoding fps
- `out_time_ms=N` — microseconds encoded so far
- `total_size=N` — output bytes
- `progress=continue|end` — sentinel

Parse by reading stderr line by line in an asyncio reader loop. Convert `out_time_ms` to percentage using source duration (obtained via `ffprobe` at job start).

Alternatively use `ffmpeg-progress-yield` (PyPI, Python >=3.9, actively maintained as of Feb 2026) which handles the parsing and yields percentage floats — good for simpler steps. For full control and the VMAF loop, raw parsing is preferred.

**Cancellation (cross-platform):**

```python
async def cancel(self):
    if self.proc and self.proc.returncode is None:
        try:
            # FFmpeg respects 'q' on stdin for graceful stop (saves partial output)
            self.proc.stdin.write(b'q')
            await self.proc.stdin.drain()
            await asyncio.wait_for(self.proc.wait(), timeout=5.0)
        except (asyncio.TimeoutError, Exception):
            pass
        finally:
            if self.proc.returncode is None:
                self.proc.terminate()  # SIGTERM on Linux, TerminateProcess on Windows
```

**Windows-specific note:** `subprocess.Popen.terminate()` on Windows calls `TerminateProcess()` — immediate, no SIGTERM. The stdin 'q' approach gives ffmpeg a chance to flush partial output cleanly before forced termination, which works cross-platform.

---

### 6. SSE EventBus

**Responsibility:** In-process pub/sub for streaming progress from PipelineRunner to browser clients. No external broker.

**Communicates with:**
- PipelineRunner (subscribes per job, pushes events)
- FastAPI SSE endpoint (drains per client connection)

**Implementation:**

```python
class EventBus:
    def __init__(self):
        # job_id -> list of asyncio.Queue (one per connected SSE client)
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self._subscribers.setdefault(job_id, []).append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue):
        if job_id in self._subscribers:
            self._subscribers[job_id].discard(q)

    async def publish(self, job_id: str, event: dict):
        for q in self._subscribers.get(job_id, []):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # slow client — drop rather than block
```

**SSE endpoint pattern:**

```python
from fastapi.responses import StreamingResponse

@app.get("/jobs/{job_id}/progress")
async def job_progress(job_id: str, request: Request):
    q = event_bus.subscribe(job_id)
    # Replay last N events from DB for reconnecting clients
    recent = db.get_recent_events(job_id, limit=50)

    async def generate():
        try:
            for ev in recent:
                yield f"data: {json.dumps(ev)}\n\n"
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # prevent proxy timeout
        finally:
            event_bus.unsubscribe(job_id, q)

    return StreamingResponse(generate(), media_type="text/event-stream")
```

SSE is chosen over WebSockets for progress streaming because it is unidirectional (server-to-client), has automatic browser reconnect, works through most proxies, and requires no special client library. Control actions (pause, cancel) go through regular REST endpoints.

---

### 7. WatchFolder Monitor

**Responsibility:** Detect new .mkv files dropped into a configured input directory and auto-enqueue them.

**Communicates with:**
- Filesystem (via watchdog Observer)
- SQLite / Job Scheduler (creates new job entries)

**Implementation:**

```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent

class IngestHandler(FileSystemEventHandler):
    def on_created(self, event: FileCreatedEvent):
        if not event.is_directory and event.src_path.endswith('.mkv'):
            # Debounce: wait for file size to stabilize before enqueueing
            asyncio.run_coroutine_threadsafe(
                enqueue_job(event.src_path),
                loop=main_event_loop
            )
```

**Cross-platform note:** watchdog uses `inotify` on Linux and `ReadDirectoryChangesW` on Windows automatically. No platform-specific code needed. The `asyncio.run_coroutine_threadsafe` call bridges watchdog's threads to the asyncio event loop.

**Debounce pattern:** Large MKV files take time to copy. Check file size stability before enqueueing: poll size at T=0 and T+2s; if equal, file is ready. This prevents processing an incomplete file.

---

## Data Flow

### Job Submission (file path)

```
User types path → POST /jobs → FastAPI validates path exists → INSERT jobs (QUEUED) → 200 OK
Scheduler poll → finds QUEUED job → UPDATE jobs (RUNNING) → spawn PipelineRunner
```

### Job Submission (file upload)

```
Browser → multipart POST /upload → FastAPI streams to configured upload dir →
INSERT jobs (QUEUED) with saved path → 200 OK with job_id → same as above
```

### Progress streaming

```
PipelineRunner step starts → FfmpegSubprocess reads stderr line by line →
parse key=value → yield Progress → PipelineRunner builds event dict →
EventBus.publish(job_id, event) → asyncio.Queue per SSE client →
SSE generate() yields "data: {...}\n\n" → Browser EventSource receives →
UI updates progress bar / VMAF score / CRF display
```

### Cancel flow

```
User clicks Cancel → DELETE /jobs/{id} →
FastAPI: UPDATE jobs SET state=CANCELLED →
notify scheduler via in-process asyncio.Event or Queue →
Scheduler: set cancel_event for that job's PipelineRunner →
PipelineRunner: checks cancel_event between steps →
FfmpegSubprocess.cancel(): stdin 'q' → terminate() →
PipelineRunner: UPDATE jobs SET state=CANCELLED, cleanup temp files
```

### Pause/Resume flow

```
User clicks Pause → PATCH /jobs/{id} {state: PAUSED} →
FastAPI: UPDATE jobs SET state=PAUSED →
PipelineRunner checks flag after current step completes →
PipelineRunner enters asyncio.Event.wait() loop (does not kill subprocess mid-step) →
User clicks Resume → PATCH /jobs/{id} {state: RUNNING} →
FastAPI: UPDATE jobs SET state=RUNNING, set resume_event →
PipelineRunner wakes, continues with next step
```

**Design decision:** Pause waits for the current step to finish cleanly. Mid-step pause (killing ffmpeg mid-encode) is not supported in V1 — it produces corrupt output and the re-encode cost is the same. Steps can be long (FFV1 encode of a 2h film), so this is a known limitation.

### Restart recovery

```
Server starts → scan jobs WHERE state IN ('RUNNING', 'QUEUED') →
RUNNING jobs: set state=QUEUED (interrupted mid-run) →
Scheduler picks them up and re-runs from the beginning of the failed step →
(Optimization: track completed steps; restart from last completed step — V2 feature)
```

---

## Suggested Build Order

Build order is driven by dependency: each layer depends on the one below it.

### Phase 1: Core Subprocess + Progress
Build `FfmpegSubprocess` first. This is the foundation everything else depends on. Validate cross-platform subprocess spawning, `-progress pipe:2` parsing, graceful cancellation, and error handling before building anything on top.

**Deliverable:** A CLI script that runs a single ffmpeg command and prints structured progress to stdout.

### Phase 2: SQLite State Layer
Define the schema. Build the DB access layer (can use SQLAlchemy Core or raw sqlite3 + WAL pragma). Write job CRUD, step tracking, event insertion. This layer must be correct before the scheduler depends on it.

**Deliverable:** Python module with testable DB functions, no web server yet.

### Phase 3: PipelineRunner (no web)
Implement the 10-step pipeline using Phase 1's subprocess wrapper and Phase 2's DB layer. Build the VMAF feedback loop. Test end-to-end with a real video file from a Python script. This validates the entire encoding pipeline before adding web complexity.

**Deliverable:** CLI that encodes a single file end-to-end with progress logged to SQLite.

### Phase 4: FastAPI + SSE
Add the web server. Implement REST endpoints for job CRUD (creation, pause, cancel, reorder). Implement the SSE endpoint reading from EventBus. Implement the Job Scheduler asyncio background task. Start the WatchFolder monitor.

**Deliverable:** Working API with curl-testable endpoints; SSE visible in browser DevTools.

### Phase 5: Web UI
Build the browser interface against the Phase 4 API. Queue view, per-job progress display (current step, chunk N/M, VMAF, CRF), job controls (add via path/upload/watch folder, pause, cancel, reorder).

**Deliverable:** Working end-to-end application.

### Phase 6: Polish + Reliability
Restart recovery (requeue interrupted jobs). Event replay on SSE reconnect. Error handling edge cases (ffmpeg crash, disk full, missing ffprobe). Configuration persistence. Platform-specific packaging (Windows .bat / Linux systemd unit).

---

## Cross-Platform Considerations

| Concern | Linux | Windows | Mitigation |
|---------|-------|---------|------------|
| asyncio subprocess | SelectorEventLoop + child watcher | ProactorEventLoop (default Python 3.8+) | No action needed — Python 3.10+ handles automatically |
| Process termination | SIGTERM | TerminateProcess | Use `proc.terminate()` + stdin 'q' fallback — both platforms handled |
| File paths | forward slashes | backslashes common | Use `pathlib.Path` throughout; never string concatenation |
| File locking (watchdog debounce) | File may still be open during copy | Same; Windows holds exclusive lock during copy | On Windows, try `open(path, 'rb')` as readiness probe; on Linux, check size stability |
| ffmpeg binary name | `ffmpeg` | `ffmpeg.exe` | Use `shutil.which('ffmpeg')` at startup; fail fast with clear error |
| Temp directories | `/tmp` or configured | `%TEMP%` or configured | `tempfile.gettempdir()` or user-configured path |
| Case-sensitive paths | Yes | No (usually) | Always store paths as-entered; compare with `Path.resolve()` |
| SQLite file locking | POSIX advisory locks | Windows mandatory locks | WAL mode reduces contention; single writer pattern eliminates conflict |
| Line endings in ffmpeg output | LF | CR+LF possible | Use `universal_newlines=True` or read bytes and decode with `errors='replace'` |
| Signal handling | SIGINT, SIGTERM | SIGINT only (SIGTERM = terminate) | Catch `KeyboardInterrupt` + `signal.SIGINT` for clean shutdown |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shell=True Subprocess
**What:** `subprocess.Popen("ffmpeg " + args, shell=True)`
**Why bad:** Path injection risk; different shell behavior on Windows (cmd.exe) vs Linux (bash); harder to kill child processes — `terminate()` kills the shell, not ffmpeg.
**Instead:** `asyncio.create_subprocess_exec(*cmd_list)` always. Build the command as a `list[str]`.

### Anti-Pattern 2: Threading for Subprocess I/O
**What:** Using `threading.Thread` to read subprocess stdout/stderr.
**Why bad:** Thread-per-process doesn't scale; harder to integrate with asyncio for SSE; Windows ProactorEventLoop already handles async subprocess I/O natively.
**Instead:** `asyncio.create_subprocess_exec` with `asyncio.StreamReader` on stdout/stderr.

### Anti-Pattern 3: External Broker for Single-Server Deployment
**What:** Adding Redis + Celery for a queue that runs one job at a time on one machine.
**Why bad:** External dependency; harder installation; Celery's worker model doesn't map cleanly to streaming progress back to the web server; overkill for this use case.
**Instead:** SQLite + asyncio background tasks in the same process.

### Anti-Pattern 4: FastAPI BackgroundTasks for Long Jobs
**What:** Using FastAPI's built-in `BackgroundTasks` to run encoding jobs.
**Why bad:** BackgroundTasks has no state, no retry, no pause/cancel, no persistence. If the request completes, the task is still tied to the request lifecycle in some implementations.
**Instead:** Custom asyncio background task started via FastAPI lifespan, with state in SQLite.

### Anti-Pattern 5: Polling for Progress in the Browser
**What:** Browser calls `GET /jobs/{id}` every second to check progress.
**Why bad:** 1-second granularity; unnecessary DB reads under load; poor UX for fast VMAF loops.
**Instead:** SSE endpoint with sub-second push from FfmpegSubprocess stderr reader.

### Anti-Pattern 6: Storing File Content in SQLite
**What:** Saving uploaded video bytes as BLOBs in the database.
**Why bad:** SQLite performs poorly for large BLOBs; no streaming; defeats WAL performance.
**Instead:** Stream uploads to disk (configured upload directory). Store only the path in DB.

### Anti-Pattern 7: Hardcoded Paths
**What:** `D:/Videos/TEMP/` or `/tmp/encode/` in source code.
**Why bad:** Breaks cross-platform; breaks deployment flexibility.
**Instead:** All paths from configuration (loaded from a `config.json` or env vars at startup, settable via UI).

---

## Scalability Considerations

This application is intentionally single-server, single-user. The architecture below reflects where it sits today and where it could go.

| Concern | At 1 user (target) | At 5-10 users | At 100+ users |
|---------|-------------------|---------------|---------------|
| Concurrency | 1 job at a time (CPU-bound) | Configurable N parallel jobs, limited by CPU cores | Separate worker pool, external queue |
| DB | SQLite WAL, single writer | SQLite still fine | Postgres migration |
| SSE clients | Unlimited (asyncio queues are cheap) | Still fine | Still fine |
| File storage | Local disk | NFS/SMB mount | Object storage (S3) |
| Auth | None (local tool) | HTTP Basic Auth | Proper auth layer |

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Web framework | FastAPI | Async-native; SSE support built-in; auto OpenAPI docs |
| DB / queue | SQLite + WAL | Zero external dependencies; survives restart; adequate for 1 concurrent job |
| Subprocess execution | `asyncio.create_subprocess_exec` | Cross-platform; integrates with asyncio event loop natively |
| Progress parsing | FFmpeg `-progress pipe:2` + raw stderr reader | Direct, no extra library dependency; gives frame/time/fps |
| Progress delivery | SSE (Server-Sent Events) | Unidirectional, browser auto-reconnect, no WebSocket overhead |
| File watching | watchdog library | Cross-platform (inotify/ReadDirectoryChanges); actively maintained |
| In-process pub/sub | asyncio.Queue per subscriber | Zero dependency; sufficient for single-server |
| Path handling | pathlib.Path everywhere | Correct cross-platform separator handling |

---

## Sources

- Python asyncio subprocess documentation: https://docs.python.org/3/library/asyncio-subprocess.html
  (HIGH confidence — official docs; confirms ProactorEventLoop default on Windows 3.8+)
- FFmpeg `-progress` flag key=value format: https://ffmpeg.org/pipermail/ffmpeg-user/2016-July/032897.html
  (MEDIUM confidence — mailing list; format is stable and used by many libraries)
- ffmpeg-progress-yield library (Python >=3.9, updated Feb 2026): https://pypi.org/project/ffmpeg-progress-yield/
  (HIGH confidence — PyPI official page, version-verified)
- FastAPI SSE documentation: https://fastapi.tiangolo.com/tutorial/server-sent-events/
  (HIGH confidence — official FastAPI docs)
- SQLite WAL mode: https://sqlite.org/wal.html
  (HIGH confidence — official SQLite docs)
- SQLite concurrency patterns: https://charlesleifer.com/blog/going-fast-with-sqlite-and-python/
  (MEDIUM confidence — authoritative community source, Charles Leifer = peewee author)
- watchdog library: https://pypi.org/project/watchdog/ and https://github.com/gorakhargosh/watchdog
  (HIGH confidence — PyPI + GitHub; cross-platform confirmed in docs)
- Python subprocess termination cross-platform: https://docs.python.org/3/library/subprocess.html
  (HIGH confidence — official docs; confirms terminate() behavior per OS)
- Web-Queue-Worker pattern: https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker
  (MEDIUM confidence — authoritative pattern reference, adapted for single-server)
- FFmpeg stdin 'q' graceful stop: https://camratus.com/blog/_Python__Graceful_stop_FFMPEG_recording_process_on_Windows-55
  (MEDIUM confidence — community source, widely referenced pattern)
