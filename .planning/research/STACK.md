# Technology Stack

**Project:** VibeCoder Video Encoder
**Researched:** 2026-03-07
**Confidence:** HIGH (all recommendations verified against current docs/sources)

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| FastAPI | 0.115.x (latest stable) | HTTP API + WebSocket + SSE + static file serving | Async-native, built-in WebSocket support (3,200 concurrent connections benchmarked), SSE via StreamingResponse/EventSourceResponse, serves static SPA build. Far better than Flask for this use case (no async, no WS), and far less overhead than Django (overkill, no async WS without Channels). |
| Uvicorn | 0.32.x | ASGI server | FastAPI's reference server. Works identically on Windows and Linux. Use `--reload` in development; bare uvicorn in production (this app is single-user/local, no Gunicorn needed). |
| Pydantic v2 | 2.x | Request/response validation, job model schemas | Ships with FastAPI, fast Rust-backed validation, excellent TypeScript schema generation for the frontend. |

**Not Flask:** No async, no native WebSocket, requires Flask-SocketIO kludge.
**Not Django:** Async WebSocket requires Django Channels + Daphne + Redis. Huge overhead for a local tool.

---

### Job Queue / Task Runner

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| asyncio.Queue + asyncio.create_subprocess_exec | stdlib | In-process job queue and subprocess management | The right tool for this problem. No Redis, no broker, no separate worker process, no Windows prefork issues. A single asyncio.Queue with a worker coroutine handles sequential/concurrent ffmpeg jobs. Job state lives in SQLite. Progress streams via SSE directly from the running coroutine. |

**Why NOT Celery:**
Celery's default prefork pool is broken on Windows (no fork support, only spawn — this was removed from Billiard and never restored). The only Windows-safe Celery pools are `solo` (single-threaded) and `threads`, both of which lose Celery's main advantage. Celery also requires a broker (Redis or RabbitMQ) — an external dependency for what is a local desktop-class app. The complexity is unjustified.

**Why NOT ARQ:**
ARQ is async-native and simpler than Celery, but it still requires Redis. Adding Redis as a required service for a local single-user tool is unnecessary infrastructure burden.

**Why NOT FastAPI BackgroundTasks:**
FastAPI's built-in `BackgroundTasks` has no status tracking, no job queue ordering, no pause/cancel, and no persistence across restarts. This is insufficient.

**The actual pattern:**
```python
# On startup: asyncio.Queue feeds a worker coroutine
# worker calls asyncio.create_subprocess_exec() for each ffmpeg stage
# stderr is read line-by-line, progress parsed, published to per-job SSE queues
# job state (status, progress, error) persisted to SQLite via SQLAlchemy async
```

This is exactly what asyncio was designed for. CPU-bound concern does not apply — ffmpeg runs in a subprocess, not the event loop.

---

### Real-Time Progress (WebSocket vs SSE)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Server-Sent Events (SSE) via FastAPI StreamingResponse | FastAPI built-in | Push progress updates from server to browser | SSE is unidirectional (server → client), which is all that's needed for job progress. No library required. Built into FastAPI via async generator + `StreamingResponse` with `media_type="text/event-stream"`. Browser reconnects automatically on disconnect. Simpler than WebSocket for this use case. |

**SSE vs WebSocket decision:**
SSE is the correct choice here. The browser never needs to send data mid-stream — it initiates a job via REST (POST), then subscribes to a progress event stream (GET /jobs/{id}/events). SSE handles this with zero additional libraries. WebSocket adds bidirectional complexity that isn't used.

**Pattern:**
```
POST /jobs          → enqueue job, return job_id
GET  /jobs/{id}/events  → SSE stream of progress events
GET  /jobs          → list all jobs (REST poll or on-load)
WS   /ws            → optional: global notification channel for queue-level events
```

If a global notification channel (job completed, queue changed) proves useful, add a single FastAPI WebSocket endpoint — it's built in with no extra library.

---

### Job State Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SQLAlchemy 2.0 (async) | 2.0.43+ | ORM / query layer | Async-native in 2.0, works with aiosqlite driver, Pydantic-compatible models, easy schema migration path if PostgreSQL is ever needed. |
| aiosqlite | 0.20.x | Async SQLite driver | Zero-config embedded database, no server, cross-platform, sufficient for single-user job state. |
| SQLite | 3.x (stdlib) | Storage engine | No server process, no port conflicts, file-based, trivially backed up, appropriate for local app. |

**Connection string:** `sqlite+aiosqlite:///./jobs.db`

**Why NOT raw sqlite3:** Synchronous — would block the event loop.
**Why NOT PostgreSQL:** Overkill for a local tool. SQLAlchemy makes migration trivial if needed later.
**Why NOT Redis for state:** Redis is an in-memory store with no default persistence guarantees. SQLite persists restarts and is easier to inspect.

---

### Frontend

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React 19 | 19.x | UI component library | Dominates ecosystem (70K+ GitHub stars for React ecosystem tools, widest hiring pool, best SSE/WebSocket hook libraries). This app has real state complexity: job list, per-job progress bars, VMAF chart, configuration forms — HTMX is not sufficient for this. |
| TypeScript | 5.x | Type safety | FastAPI + Pydantic can auto-generate TypeScript types (via openapi-ts or json-schema-to-typescript), making the API contract typed end-to-end. |
| Vite | 6.x | Build tool / dev server | Standard for React in 2025. Hot module replacement, fast cold starts, optimized production builds. FastAPI serves the `dist/` output via `StaticFiles`. |
| TanStack Query | 5.x | Server state / SSE subscription | Best-in-class data fetching with automatic cache invalidation. SSE subscription via `EventSource` integrates cleanly. |
| Zustand or React context | 5.x | Client state | Lightweight global state for queue management UI (selected job, active filters). |

**Why NOT HTMX:**
HTMX is excellent for content-heavy server-rendered apps. This app has complex client-side state: real-time VMAF score history, per-chunk progress charts, job reordering, cancellation with optimistic UI. HTMX requires server round-trips for all of this. The tradeoffs go the wrong way.

**Why NOT Vue:**
React is the right call when the team has no stated Vue preference. The ecosystem advantage (tooling, hooks, component libraries) favors React for a utility app where UI productivity matters.

**Served by FastAPI:**
```python
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
```
No separate static server needed for local deployment.

---

### ffmpeg Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| asyncio.create_subprocess_exec | stdlib | Launch and monitor ffmpeg/scenedetect subprocesses | Direct process control, stderr streaming via `asyncio.StreamReader`, cross-platform (Windows ProactorEventLoop, Linux SelectorEventLoop). No wrapper library needed for this level of control. |
| ffmpeg-progress-yield | 0.7.x+ | Parse ffmpeg stderr progress lines | Lightweight library that yields structured progress dicts from ffmpeg's `-progress pipe:1` output. Avoids reimplementing the stderr parser. |

**Why NOT python-ffmpeg or ffmpeg-python:**
These wrapper libraries are convenient for simple ffmpeg command construction but add abstraction over the exact subprocess control this pipeline needs (per-chunk execution, CRF feedback loop, conditional re-encoding). Direct subprocess gives full control with no impedance mismatch.

**ffmpeg stderr parsing pattern:**
Use `ffmpeg -progress pipe:1 -nostats` which writes structured `key=value` lines to stdout. Parse in async loop, emit progress events to job's SSE queue.

---

### PySceneDetect Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| scenedetect | 0.6.7.1 | Scene boundary detection | Already mandated by the project. Use Python API (not CLI subprocess) for better control and scene list access. Run in a thread via `asyncio.run_in_executor(None, detect_scenes, ...)` since scenedetect is synchronous. |

**PySceneDetect is synchronous** — it uses OpenCV under the hood and has no async API. The correct integration pattern is `asyncio.run_in_executor(None, ...)` to offload to a thread pool, keeping the event loop unblocked.

**Pin version:** `scenedetect>=0.6.7,<0.7` — the API is noted as unstable across minor versions.

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| python-multipart | 0.0.x | File upload support | Required by FastAPI for `UploadFile` / multipart form handling. Always needed if browser upload is supported. |
| aiofiles | 23.x | Async file I/O | Writing uploaded files, reading watch folder contents without blocking event loop. |
| watchfiles | 0.x | Watch folder monitoring | Async-native file system watcher, cross-platform (uses native OS events: ReadDirectoryChangesW on Windows, inotify on Linux). Drop-in with asyncio. |
| loguru | 0.7.x | Structured logging | Simpler than stdlib logging, sinks to file + stdout, timestamps, level filtering. |

---

## Cross-Platform Considerations

**Windows-specific:**
- asyncio on Windows uses `ProactorEventLoop` by default (Python 3.8+). This is required for `asyncio.create_subprocess_exec()` on Windows — do not override to `SelectorEventLoop`.
- Do not use Celery prefork pool — it is broken on Windows. This stack avoids the issue entirely.
- File paths: always use `pathlib.Path` — never string concatenation with `/` or `\`.
- `watchfiles` uses `ReadDirectoryChangesW` on Windows natively — no manual polling needed.

**Linux-specific:**
- Uvicorn worker count can be increased for multi-core use (not relevant for single-user local app but documented).
- `watchfiles` uses inotify on Linux.
- No changes needed to the application code — the asyncio + pathlib stack is genuinely cross-platform.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Web framework | FastAPI | Flask | No async, no native WebSocket, requires extensions |
| Web framework | FastAPI | Django | Requires Django Channels + Daphne + Redis for async WS; massive overhead |
| Task queue | asyncio.Queue | Celery | Broken prefork on Windows; requires Redis broker; overkill for local app |
| Task queue | asyncio.Queue | ARQ | Requires Redis; async but still external broker dependency |
| Task queue | asyncio.Queue | FastAPI BackgroundTasks | No status tracking, no queue ordering, no pause/cancel |
| Real-time | SSE | WebSocket | Not needed — communication is unidirectional (server pushes progress) |
| Database | SQLite + SQLAlchemy async | PostgreSQL | Overkill; no server required for local tool |
| Database | SQLite + SQLAlchemy async | Raw sqlite3 | Synchronous; blocks event loop |
| Frontend | React + Vite | HTMX | Insufficient for complex real-time state (per-chunk VMAF charts, job reordering) |
| Frontend | React + Vite | Vue | No stated preference; React ecosystem advantage for utility apps |
| ffmpeg subprocess | asyncio.create_subprocess_exec | python-ffmpeg wrapper | Wrapper hides control needed for CRF feedback loop pattern |
| Progress parsing | ffmpeg-progress-yield | Custom stderr parser | Saves reimplementing; well-tested library |

---

## Installation

```bash
# Core backend
pip install fastapi uvicorn[standard] pydantic sqlalchemy aiosqlite aiofiles

# Job support
pip install ffmpeg-progress-yield watchfiles

# scenedetect (pin minor version for API stability)
pip install "scenedetect[opencv]>=0.6.7,<0.7"

# File upload
pip install python-multipart

# Logging
pip install loguru

# Frontend (in frontend/ subdirectory)
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install @tanstack/react-query zustand
```

---

## Sources

- FastAPI WebSocket benchmarks and framework comparison: [JetBrains PyCharm Blog 2025](https://blog.jetbrains.com/pycharm/2025/02/django-flask-fastapi/), [FastLaunchAPI comparison 2025](https://fastlaunchapi.dev/blog/fastapi-vs-django-vs-flask/)
- SSE vs WebSocket for progress: [WebSocket vs SSE vs Long Polling 2025](https://potapov.me/en/make/websocket-sse-longpolling-realtime), [FastAPI SSE official docs](https://fastapi.tiangolo.com/tutorial/server-sent-events/)
- Celery Windows broken prefork: [celery.school/celery-on-windows](https://celery.school/celery-on-windows), [Celery issue #5738](https://github.com/celery/celery/issues/5738)
- ARQ requires Redis: [FastAPI BackgroundTasks vs ARQ](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/)
- asyncio subprocess for ffmpeg: [asyncio-subprocess-ffmpeg](https://github.com/scivision/asyncio-subprocess-ffmpeg), [ffmpeg-progress-yield](https://pypi.org/project/ffmpeg-progress-yield/)
- SQLAlchemy 2.0 async with aiosqlite: [SQLAlchemy asyncio docs](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html), [FastAPI async SQLAlchemy guide](https://towardsdatascience.com/build-an-async-python-service-with-fastapi-sqlalchemy-196d8792fa08/)
- PySceneDetect 0.6.7.1 current release: [PyPI scenedetect](https://pypi.org/project/scenedetect/)
- React + Vite + FastAPI static serving: [FastAPI and React in 2025](https://www.joshfinnie.com/blog/fastapi-and-react-in-2025/), [Serving React with FastAPI](https://medium.com/@c.tasca.1971/how-to-serve-a-react-frontend-with-fastapi-36a96663b3cb)
- watchfiles cross-platform: [watchfiles PyPI](https://pypi.org/project/watchfiles/)
