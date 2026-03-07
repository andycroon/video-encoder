# Project Research Summary

**Project:** VibeCoder Video Encoder
**Domain:** Cross-platform Python video encoding queue web application
**Researched:** 2026-03-07
**Confidence:** HIGH (all four research areas verified against official docs and multiple sources)

---

## Executive Summary

The VibeCoder Video Encoder is a single-user, locally deployed web application that wraps a scene-aware x264 encoding pipeline behind a browser queue manager. The canonical architecture for this class of problem is Web-Queue-Worker: a FastAPI web server handles the API and SSE progress streaming, SQLite with WAL mode stores all job state durably, and an in-process asyncio background task manages the encoding queue. No external broker (Redis, Celery, RabbitMQ) is needed — the entire application starts from a single `python -m videoencoder` command, which is the right target for a local desktop-class tool.

The recommended approach is to build bottom-up: validate the ffmpeg subprocess layer first (cross-platform process spawning, progress parsing, graceful cancellation), then the database state layer, then the 10-step pipeline runner with the VMAF CRF feedback loop, and finally add the web API and browser UI on top. This order is non-negotiable — cross-platform subprocess and VMAF concerns must be solved at the foundation level. Attempting to build the UI or job queue before the subprocess layer is proven correct on Windows leads to foundational rewrites.

The dominant risk cluster is Windows-specific subprocess behavior: asyncio event loop selection, graceful ffmpeg cancellation across process groups, and VMAF model path escaping in ffmpeg filter strings. All three are well-understood problems with documented solutions, but they must be addressed at Phase 1, not retrofitted. The secondary risk is VMAF correctness — the CRF feedback loop depends on libvmaf returning valid scores, which requires explicit resolution/format normalization in the filter graph and a convergence guard in the loop logic. Both are low-risk if addressed proactively.

---

## Key Findings

### Recommended Stack

The backend is FastAPI + Uvicorn (async-native, built-in SSE via StreamingResponse, serves the React build as static files). Job state uses SQLite via SQLAlchemy 2.0 async + aiosqlite — zero external services, WAL mode for concurrent reads. The queue is `asyncio.Queue` + `asyncio.create_subprocess_exec` in-process — no Celery, no Redis, no separate worker. Celery's prefork pool is broken on Windows and would require Redis as an external dependency; both are unjustified for a local tool.

Real-time progress is delivered via Server-Sent Events (SSE), not WebSocket. Control actions (pause, cancel, reorder) go through regular REST endpoints. SSE is unidirectional (server to browser), has automatic browser reconnect, and requires no library beyond FastAPI's built-in `StreamingResponse`. ffmpeg progress is parsed from `-progress pipe:1 -nostats` structured key=value output, not from raw stderr. PySceneDetect runs via its Python API in a thread pool (`asyncio.run_in_executor`) since it is synchronous.

The frontend is React 19 + TypeScript + Vite, served by FastAPI from the `dist/` build output. The app has enough real-time state complexity (per-chunk VMAF charts, live CRF display, job reordering) that HTMX is insufficient. TanStack Query handles server state and SSE subscription; Zustand handles client-side UI state.

**Core technologies:**
- FastAPI 0.115.x: HTTP API + SSE + static file serving — async-native, no external async WS library needed
- asyncio.Queue + asyncio.create_subprocess_exec (stdlib): in-process job queue and ffmpeg subprocess management — no broker, no Windows compatibility issues
- SQLite + SQLAlchemy 2.0 async + aiosqlite: durable job state, WAL mode for concurrent reads — zero external services
- SSE via FastAPI StreamingResponse: real-time progress push — simpler than WebSocket for unidirectional use case
- React 19 + TypeScript + Vite: browser UI — required for complex real-time state (VMAF charts, live CRF adjustment)
- ffmpeg-progress-yield 0.7.x: structured progress parsing — avoids reimplementing the stderr parser
- scenedetect 0.6.7.x (pinned): scene boundary detection — must be pinned to minor version; API is unstable
- watchfiles: cross-platform watch folder monitoring — uses native OS events on both Windows and Linux
- pathlib.Path everywhere: cross-platform file path handling — never string concatenation

### Expected Features

**Must have (table stakes — v1 ships with all of these):**
- Job list with status (queued, running, done, failed, cancelled)
- Add job by file path (typed path entry, server-side validation)
- Global defaults (VMAF range, CRF bounds, audio codec) with per-job override
- Real-time stage-by-stage progress display (named pipeline stage + stage-level %)
- Per-chunk VMAF progress (chunk index, current VMAF score, current CRF, live-updated)
- Cancel individual job (cleans up temp files)
- Pause / resume queue (waits for current step to complete cleanly before pausing)
- Retry failed job (re-enqueue with same config)
- Encoding log per job (ffmpeg stderr captured, stored, displayed on demand)
- Output file size and compression ratio
- Configurable directory paths (input, output, temp)
- Job history / completion list

**Should have (differentiators — v1 if time allows, otherwise v2):**
- Watch folder input — drops files in configured directory, auto-queues
- Browser file upload — enables remote headless server workflows
- Server-side folder browse — tree/flat listing for picking source files without typing
- VMAF score history per job — per-chunk results as chart or table after completion
- Disk space warnings — check available temp space before starting; FFV1 intermediates can be 3-5x source size
- Estimated time remaining — requires baseline data from prior jobs
- CRF convergence indicator — surface oscillating CRF early as a problem signal
- Dark mode

**Defer (v2+, anti-features for v1):**
- Distributed / multi-node encoding
- GPU/NVENC/VAAPI hardware encoder support
- Library scanning / media management
- Multi-profile output (one source to many renditions)
- Plugin system
- User authentication / multi-user
- Cloud storage integration

**MVP priority order (from FEATURES.md):**
1. Global defaults + per-job config
2. Add job by file path
3. Job queue list + pause/cancel/retry
4. Stage-by-stage progress via SSE
5. Per-chunk VMAF progress
6. Encoding log per job

### Architecture Approach

The architecture is Web-Queue-Worker with an embedded process supervisor, all in a single Python process. The FastAPI web server is stateless beyond SQLite — restarts recover by reading DB state. The Job Scheduler is an asyncio background task started via FastAPI lifespan. PipelineRunner is one coroutine per active job, executing all 10 pipeline steps sequentially. FfmpegSubprocess is a thin wrapper around `asyncio.create_subprocess_exec` that parses `-progress pipe:1` output and supports cross-platform graceful cancellation. The SSE EventBus is an in-process `asyncio.Queue` per connected client — no external broker.

**Major components and responsibilities:**
1. FastAPI Web Server — HTTP REST endpoints, SSE streaming, static SPA serving; stateless beyond SQLite
2. SQLite (WAL mode) — durable job state, pipeline step state, SSE event replay ring buffer, configuration
3. Job Scheduler — asyncio background task; pulls QUEUED jobs, enforces concurrency limit (default: 1), polls for pause/cancel signals
4. PipelineRunner — one coroutine per active job; executes all 10 steps sequentially; manages the VMAF CRF feedback loop
5. FfmpegSubprocess — spawns one ffmpeg/ffprobe invocation; parses progress; supports cross-platform graceful cancel (stdin `q\n` then `terminate()`)
6. SSE EventBus — in-process pub/sub; asyncio.Queue per SSE client; PipelineRunner pushes in, SSE endpoint drains out
7. WatchFolder Monitor — optional asyncio background task using watchfiles; debounces file writes before enqueueing
8. React SPA — job queue view, per-job progress (stage, chunk, VMAF, CRF), job controls, VMAF score history

**Build order from ARCHITECTURE.md (dependency-driven):**
Phase 1 → FfmpegSubprocess (foundation), Phase 2 → SQLite state layer, Phase 3 → PipelineRunner (no web), Phase 4 → FastAPI + SSE, Phase 5 → React UI, Phase 6 → Polish and reliability

### Critical Pitfalls

**Critical (cause rewrites or data loss):**

1. **Subprocess pipe deadlock (C1)** — ffmpeg writes continuous progress to stderr; if the pipe is not actively drained, the OS pipe buffer fills and both processes deadlock permanently. Prevention: use `asyncio.create_subprocess_exec` with async stream readers draining both stdout and stderr concurrently. Never use `process.communicate()` for long-running encodes.

2. **Windows asyncio event loop cannot spawn subprocesses (C2)** — `asyncio.create_subprocess_exec()` raises `NotImplementedError` on Windows if the SelectorEventLoop is active (some uvicorn configurations do this). Prevention: explicitly assert `ProactorEventLoop` is active at startup on Windows, or run all ffmpeg subprocesses in a `ThreadPoolExecutor` with synchronous `subprocess.Popen`. Decide this strategy before writing any worker code.

3. **Windows ffmpeg cancellation kills Python parent process (C3)** — `os.kill(pid, signal.CTRL_C_EVENT)` broadcasts to the entire process group, killing the Python parent. Prevention: always spawn ffmpeg with `creationflags=subprocess.CREATE_NEW_PROCESS_GROUP` on Windows; use stdin `q\n` for graceful stop rather than signals.

4. **VMAF model path escaping on Windows (C4)** — Windows drive letter colons in ffmpeg filter strings are misinterpreted as escape characters. `C:/path` inside a libvmaf filter fails. Prevention: escape the colon as `C\:/path` inside filter strings. Write a dedicated `vmaf_model_path_for_filter()` utility at Phase 1 and validate at startup.

5. **VMAF returns zero or wrong score due to resolution/format mismatch (C5)** — libvmaf silently returns 0 if distorted and reference inputs differ in resolution or pixel format, or if PTS is not normalized to 0. Prevention: always include explicit `scale`, `format=yuv420p`, and `setpts=PTS-STARTPTS` in VMAF filter graphs.

**Moderate (correctness bugs, recoverable):**

6. **Ghost jobs after crash (M1)** — jobs left in RUNNING state after server crash are never picked up again. Prevention: add `heartbeat_at` timestamp column; on startup, transition RUNNING jobs older than 60s to FAILED and re-queue.

7. **ffmpeg carriage return progress parsing (M2)** — ffmpeg default stderr uses `\r` not `\n`; `readline()` blocks indefinitely. Prevention: use `-progress pipe:1 -nostats` for structured key=value output, parseable line-by-line.

8. **Concat list "unsafe file name" (M3)** — ffmpeg concat demuxer rejects paths with spaces or absolute paths in default safe mode. Prevention: always pass `-safe 0`; write concat list using `Path.as_posix()`.

9. **PySceneDetect API instability (M4)** — breaking changes between minor versions. Prevention: pin to `scenedetect>=0.6.7,<0.7`; wrap in adapter layer.

10. **CRF feedback loop non-convergence (m5)** — VMAF can oscillate around the target, causing an infinite loop. Prevention: track tried CRF values; add max iteration limit (10); accept best result at CRF bounds.

---

## Implications for Roadmap

### Phase 1: Core Subprocess Layer

**Rationale:** All other phases depend on proven cross-platform subprocess execution. Windows ProactorEventLoop, graceful cancellation, and progress parsing must be solved here — retrofitting is a full rewrite. This is the highest-leverage phase.

**Delivers:** A CLI module that runs a single ffmpeg command, streams structured progress to stdout, and supports graceful cross-platform cancellation. Validated on both Windows and Linux.

**Addresses:** Path entry input (file validation), ffprobe for duration extraction

**Avoids:**
- C1 (pipe deadlock) — async stream readers from day one
- C2 (Windows asyncio subprocess) — ProactorEventLoop assertion at startup
- C3 (Windows ffmpeg cancellation) — `CREATE_NEW_PROCESS_GROUP` + stdin `q\n` pattern
- C4 (VMAF model path escaping) — `vmaf_model_path_for_filter()` utility written and tested
- M2 (carriage return parsing) — `-progress pipe:1 -nostats` from the start
- m1 (pathlib convention) — `str()` vs `as_posix()` convention established

**Research flag:** No additional research needed. asyncio subprocess patterns are well-documented.

### Phase 2: SQLite State Layer

**Rationale:** The job scheduler, PipelineRunner, and web API all depend on a correct database schema. Schema must be right before anything writes to it — migrations on a running queue are painful.

**Delivers:** A Python module with tested DB functions: job CRUD, step tracking, event insertion, config storage. No web server yet.

**Schema includes:** `jobs`, `steps`, `events` tables; WAL mode + `busy_timeout` PRAGMAs; `heartbeat_at` column; `temp_files` JSON column for crash cleanup.

**Avoids:**
- M1 (ghost jobs) — heartbeat column and startup recovery query in schema from day one
- M6 (temp file orphans) — temp_files column in schema from day one
- m4 (SQLite blocking) — WAL mode in schema initialization

**Research flag:** No additional research needed. SQLAlchemy 2.0 async patterns are well-documented.

### Phase 3: Pipeline Runner (no web)

**Rationale:** The 10-step encoding pipeline is the core product. Validate it end-to-end with a real video file before adding web complexity. This is where VMAF correctness, CRF feedback loop convergence, and PySceneDetect integration are proven.

**Delivers:** A CLI that encodes a single file end-to-end: FFV1 intermediate → scene detect → split → audio extract → per-chunk encode with VMAF CRF loop → concat → mux → cleanup. Progress logged to SQLite. Validated on both platforms.

**Addresses:** Stage-by-stage progress (logged), per-chunk VMAF progress (stored), encoding log per job, VMAF score history (data model built here)

**Avoids:**
- C5 (VMAF format mismatch) — scale+format+setpts normalization in VMAF filter graph
- M3 (concat unsafe file names) — `-safe 0` in concat step
- M4 (PySceneDetect API instability) — adapter layer around PySceneDetect Python API
- m3 (scene CSV parsing) — use Python API scene objects, not CSV
- m5 (CRF non-convergence) — visited-CRF set and max-iteration guard in feedback loop

**Research flag:** Phase-level research may be useful for the VMAF filter graph construction and the specific x264 settings from PROJECT.md. The CRF feedback loop has no external reference implementation — this is novel territory.

### Phase 4: FastAPI API + SSE + Job Scheduler

**Rationale:** Add the web layer on top of the proven pipeline. REST endpoints for job lifecycle; SSE EventBus for progress; asyncio background task for the scheduler. All behavior is already tested in Phase 3.

**Delivers:** A working API with curl-testable endpoints. SSE progress visible in browser DevTools. Job submission, pause, cancel, reorder, and retry via HTTP. Scheduler running in FastAPI lifespan.

**Addresses:** Job queue list, pause/resume queue, cancel individual job, retry failed job, configurable directory paths (via config API), global defaults API

**Avoids:**
- M5 (lost events on SSE reconnect) — emit current job state on connect; use Last-Event-ID replay from events ring buffer; keepalive heartbeat every 15s
- Anti-Pattern 4 (FastAPI BackgroundTasks for encoding) — custom asyncio lifespan task with SQLite state

**Research flag:** No additional research needed. FastAPI SSE patterns are documented and covered in ARCHITECTURE.md.

### Phase 5: React UI

**Rationale:** Build the browser interface against the proven Phase 4 API. All data contracts are defined; all edge cases are handled in the backend.

**Delivers:** Job queue view with status badges; per-job progress panel (stage name, stage %, chunk N/M, live VMAF score, current CRF); job controls (add via path, pause, cancel, retry); VMAF score history table; settings page for global defaults and directory paths.

**Addresses:** All table-stakes features visible in the UI; stage-by-stage progress display; per-chunk VMAF progress display; encoding log (expandable panel)

**Research flag:** Standard React + TanStack Query + SSE patterns. No additional research needed.

### Phase 6: File Input Expansion

**Rationale:** Core pipeline is proven and UI is working. Add the secondary input methods that expand the tool's reach without touching the critical pipeline.

**Delivers:** Watch folder monitoring (watchfiles, debounced), browser file upload (multipart, python-multipart, aiofiles), server-side folder browse API.

**Addresses:** Watch folder input, browser file upload, server-side folder browse differentiator features

**Avoids:**
- Watch folder debounce pattern for large MKV files — size stability check before enqueue

**Research flag:** Standard patterns. No additional research needed.

### Phase 7: Polish and Reliability

**Rationale:** Hardening before regular use. Restart recovery, disk space warnings, ETA estimation, error message quality, dark mode.

**Delivers:** Startup recovery (re-queues interrupted RUNNING jobs), disk space pre-flight check, ETA display, improved error messages, dark mode CSS.

**Addresses:** Ghost job recovery on restart (heartbeat cleanup), disk space warnings, estimated time remaining, dark mode, temp file orphan cleanup on startup

**Research flag:** No additional research needed. Patterns are standard.

### Phase Ordering Rationale

The dependency chain from ARCHITECTURE.md is strict: subprocess wrapper must exist before PipelineRunner, PipelineRunner must exist before the scheduler, the scheduler must exist before the API, and the API must exist before the UI. Any shortcut produces an untested interface boundary that causes rewrites.

The critical cross-platform concerns (pitfalls C1 through C4) are all in Phase 1. Solving them early means every subsequent phase inherits correct behavior. Solving them late means the entire stack above them needs regression testing.

Separating the pipeline (Phase 3) from the web layer (Phase 4) is the single most important ordering decision. It makes the encoding logic independently testable and means the web API is specifying, not discovering, the data contracts.

Feature expansion (Phase 6) is deliberately after the UI (Phase 5) because watch folder and upload are input methods, not core pipeline features. They should not block the queue manager from reaching working state.

### Research Flags

**Needs phase-level research:**
- **Phase 3 (Pipeline Runner):** The VMAF filter graph construction with correct format normalization for the specific FFV1 → x264 chunk comparison case is worth a focused research spike. The x264 settings from PROJECT.md (custom partitions, trellis, deblock, subq, me_method) should be validated as valid libx264 options in current ffmpeg. The interaction between PySceneDetect scene boundary timestamps and ffmpeg `-ss` / `-to` split accuracy deserves a test with actual MKV content.

**Standard patterns (skip research-phase):**
- **Phase 1 (Subprocess):** Fully documented in ARCHITECTURE.md and PITFALLS.md. Patterns are established.
- **Phase 2 (SQLite):** SQLAlchemy 2.0 async is well-documented. Schema is fully specified in ARCHITECTURE.md.
- **Phase 4 (FastAPI + SSE):** SSE patterns fully specified in ARCHITECTURE.md and STACK.md.
- **Phase 5 (React UI):** Standard React + TanStack Query. No novel patterns.
- **Phase 6 (Input expansion):** watchfiles and python-multipart are straightforward.
- **Phase 7 (Polish):** Standard patterns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official docs and PyPI; alternatives explicitly eliminated with documented rationale |
| Features | MEDIUM-HIGH | Table stakes and differentiators derived from Tdarr, HandBrake, Unmanic comparisons; some reference sources are LOW confidence (third-party blogs) but core feature set is clear |
| Architecture | HIGH | Component design verified against official asyncio, FastAPI, SQLite docs; build order is dependency-driven, not speculative |
| Pitfalls | HIGH | Critical pitfalls verified against official Python docs, Netflix VMAF GitHub issues, and Windows-specific subprocess behavior docs |

**Overall confidence:** HIGH

### Gaps to Address

- **VMAF filter graph exact syntax for FFV1-to-x264 chunk comparison:** Pitfalls research gives the pattern; Phase 3 spike should validate with real content before the full feedback loop is built. Risk: VMAF returns wrong scores silently (C5), derailing the entire quality model.

- **x264 libx264 option compatibility:** The PROJECT.md x264 settings use ffmpeg libx264 option names that may have changed in recent ffmpeg versions (`partitions`, `me_method`, `b_strategy`, `sc_threshold`). Validate against `ffmpeg -h encoder=libx264` output on the target machine at Phase 3.

- **PySceneDetect VFR handling:** PITFALLS.md flags VFR sources as known-broken in PySceneDetect. The project should define at Phase 3 whether to reject VFR input at validation or attempt to convert to CFR during the FFV1 intermediate step.

- **Pause mid-step user expectation:** ARCHITECTURE.md documents that pause waits for the current step to finish (no mid-encode pause). This is a known UX limitation — particularly for FFV1 intermediate encoding of long films. This should be surfaced clearly in the UI (e.g., "Pausing after current step completes") to avoid user confusion.

- **Audio codec support scope:** PROJECT.md requires EAC3, AAC, FLAC, and copy. EAC3 encoding via ffmpeg requires a build with the eac3 encoder. Validate the target ffmpeg binary supports `acodec eac3` before Phase 3.

---

## Sources

### Primary (HIGH confidence)
- Python asyncio subprocess docs — subprocess cross-platform behavior, ProactorEventLoop
- FastAPI official docs — SSE, WebSocket, StaticFiles, lifespan
- SQLite WAL mode docs — concurrency, PRAGMA configuration
- SQLAlchemy 2.0 async docs — aiosqlite integration
- Netflix VMAF GitHub — libvmaf ffmpeg integration, known scoring issues
- ffmpeg official docs — `-progress` flag, concat demuxer, libx264 encoder options

### Secondary (MEDIUM confidence)
- PySceneDetect changelog and migration guide — API stability warnings, 0.6.x breaking changes
- Celery Windows issues (GitHub issue #5738, celery.school) — prefork pool broken on Windows
- Charles Leifer SQLite performance blog — WAL concurrency patterns
- Web-Queue-Worker pattern (Microsoft Azure Architecture Guide) — pattern reference
- Streaming Learning Center — VMAF Windows path escaping

### Tertiary (LOW confidence)
- ffdash GitHub project — VMAF display pattern reference (single project, limited validation)
- Third-party Tdarr/Unmanic comparison blog — feature landscape reference only

---

*Research completed: 2026-03-07*
*Ready for roadmap: yes*
