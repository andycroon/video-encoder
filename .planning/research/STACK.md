# Technology Stack

**Project:** VibeCoder Video Encoder
**Researched:** 2026-03-17
**Confidence:** HIGH (all new additions verified against current sources)

---

## Context: What Already Exists

This is a v1.1 milestone update. The v1.0 stack is validated and in production:

- FastAPI 0.115.x + Uvicorn 0.32.x + Pydantic v2 (backend API + SSE)
- asyncio.Queue + ThreadPoolExecutor (job queue, Windows-safe subprocess execution)
- SQLite WAL + SQLAlchemy 2.0 async + aiosqlite (persistence)
- React 19 + TypeScript 5.9 + Vite 7 (frontend)
- Zustand 5, Tailwind CSS 4.2, Radix UI (UI layer)
- aiofiles, watchfiles, python-multipart (already installed)

**This document covers only additions and changes needed for v1.1.**

---

## New Stack Additions

### Backend: Parallel Chunk Encoding

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `asyncio.Semaphore` | stdlib | Concurrency gate for parallel chunk encoding | A semaphore acquired before launching each chunk subprocess limits parallelism without an external queue. `async with semaphore:` pattern is idiomatic asyncio, zero dependencies. The ThreadPoolExecutor already wraps each ffmpeg subprocess — the semaphore sits above it, controlling how many can run concurrently. |

**No new library needed.** The pattern is:

```python
sem = asyncio.Semaphore(concurrency_limit)

async def encode_chunk(chunk):
    async with sem:
        await loop.run_in_executor(executor, _run_ffmpeg_sync, chunk)
```

The semaphore limit is read from the job's profile config (default: 2). At concurrency=1, behavior is identical to v1.0 — sequential encoding. This is the correct default for most machines to avoid saturating I/O or thermal throttling.

**Windows note:** No change required. `ThreadPoolExecutor` + `ProactorEventLoop` is the existing Windows-safe pattern. Adding a semaphore above it is transparent to the event loop.

---

### Backend: Job Resume

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Existing SQLite schema | — | Track last completed step per job | Resume logic is pure application code, no new library. Read the job's step records from the DB on startup/retry, skip any step whose status is `DONE`, re-run from the first non-DONE step. |

**No new library needed.** The DB already stores per-step status (`create_step` / `update_step`). Resume is an `if step.status == "DONE": continue` guard at the top of each pipeline stage.

---

### Backend: Browser File Upload (Multipart)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `python-multipart` | 0.0.x (already installed) | FastAPI `UploadFile` parsing | Already in requirements from v1 research. FastAPI won't accept `UploadFile` parameters without it. |
| `aiofiles` | 23.x (already installed) | Stream upload to disk asynchronously | Write upload in chunks (`read(1MB)` loop) without blocking the event loop. For video files that can be 10–50 GB, do NOT use `UploadFile.read()` (loads entire file into memory). Use chunk streaming. |

**No new packages.** `python-multipart` and `aiofiles` are already installed. The implementation pattern:

```python
@app.post("/api/upload")
async def upload(file: UploadFile):
    dest = Path(upload_dir) / file.filename
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1_048_576):  # 1 MB
            await f.write(chunk)
    return {"path": str(dest)}
```

**Size limit:** Set `max_upload_size` in Uvicorn config or enforce it in the endpoint. Starlette's default is unbounded — enforce a limit (e.g., 50 GB) to avoid disk exhaustion.

---

### Backend: Server-Side Directory Browser

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `pathlib.Path` | stdlib | Directory enumeration | `Path.iterdir()` lists directory entries without loading them. Filter by suffix (`.mkv`, `.mp4`, etc.) and exclude hidden files. |

**No new library needed.** A GET endpoint takes an optional `path` query param (defaults to a configurable `browse_root`), walks one level of the tree, returns `{name, path, is_dir, size}` JSON.

**Security:** Path traversal is a real risk. The endpoint must:
1. Resolve the requested path to absolute: `Path(requested).resolve()`
2. Verify it is a subdirectory of `browse_root`: `resolved.is_relative_to(browse_root)`
3. Reject any path that escapes the root with a 403.

No sandboxing library is needed — this two-line check is sufficient for a local single-user tool.

---

### Backend: Job Auto-Cleanup Scheduling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `asyncio.create_task` + `asyncio.sleep` loop | stdlib | Periodic DB sweep to delete old completed/failed jobs | A background coroutine that runs `asyncio.sleep(interval)` then deletes jobs older than the configured retention period. This is the standard asyncio periodic-task pattern — zero dependencies, cancellable on shutdown. APScheduler would work but adds a dependency for a single cron-like sweep. |

**No new library needed.** Pattern:

```python
async def _auto_cleanup_loop(db_path, retention_seconds, interval_seconds=3600):
    while True:
        await asyncio.sleep(interval_seconds)
        cutoff = time.time() - retention_seconds
        await delete_old_jobs(db_path, before=cutoff, statuses=["DONE", "FAILED"])
```

Started as a lifespan task alongside the scheduler and watcher, cancelled on shutdown. Configuration: `auto_cleanup_after_hours` in global settings (default: 0 = disabled).

---

### Frontend: VMAF Line Chart

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `recharts` | `^3.8.0` | Per-chunk VMAF score line chart, CRF convergence indicator | Recharts is the dominant React charting library — 700K+ weekly downloads, D3-backed, declarative component API that fits naturally into React. Version 3.8.0 is current (March 2026). Verified React 19 compatible in standard React (non-Preact). The `ResponsiveContainer` + `LineChart` + `Line` pattern is a 20-line implementation for this use case. |

**Why Recharts over alternatives:**

| Library | Why Not |
|---------|---------|
| Chart.js (react-chartjs-2) | Imperative API, requires Canvas refs, feels like a bolt-on to React. Recharts is native React. |
| Victory | Excellent but heavier; strong dependency on D3 version coupling has caused upgrade pain. |
| Nivo | Beautiful defaults but larger bundle and more opinionated styling — overkill for two charts. |
| Visx (Airbnb) | Low-level D3 primitives. Too much work for a line chart. |
| Plain D3 | No React integration, requires manual DOM manipulation. |

**VMAF chart is simple:** A `LineChart` with chunk index on X-axis, VMAF score on Y-axis, and a reference band for `[vmafMin, vmafMax]`. Recharts' `ReferenceLine` and `ReferenceArea` components cover this exactly.

**CRF convergence indicator:** A `BarChart` or inline badge per chunk showing re-encode count. Recharts handles both. Alternatively, this can be a simple numeric badge — no chart library needed for the convergence count.

**Installation:**

```bash
cd frontend && npm install recharts
```

**TypeScript types:** Included in the recharts package since v3 — no `@types/recharts` needed.

---

### Frontend: Dark Mode

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tailwind CSS v4 `@custom-variant` | Already installed (^4.2.1) | Class-based dark mode toggle | Tailwind v4 ships with `prefers-color-scheme` media-based dark mode by default. To support a toggle (light/dark/system), override with `@custom-variant dark`. No new library needed. |

**No new package.** Tailwind v4 is already in `package.json` at `^4.2.1`. The configuration is a one-line CSS directive:

```css
/* in app.css, after @import "tailwindcss" */
@custom-variant dark (&:where(.dark, .dark *));
```

Toggle state is stored in Zustand (existing store) + `localStorage`. On mount, a small `useEffect` applies `.dark` to `<html>`. The `dark:` prefix in all component classes then activates automatically.

**Pattern for toggle:**

```typescript
// In Zustand store
const toggleDarkMode = () => {
  const next = !get().darkMode;
  set({ darkMode: next });
  document.documentElement.classList.toggle('dark', next);
  localStorage.setItem('theme', next ? 'dark' : 'light');
};
```

**No `next-themes` or `react-use-dark-mode`** — they solve Next.js SSR flash problems. This is a Vite SPA with no SSR, so a simple classList toggle is sufficient.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| APScheduler | Adds external dependency for a single periodic cleanup sweep | `asyncio.sleep` loop (stdlib) |
| streaming_form_data | Only needed when uploads exceed available temp disk space simultaneously | `UploadFile.read(1MB)` chunk loop with `aiofiles` |
| `@tanstack/react-query` | Not in existing package.json; SSE + Zustand already handle state | Keep existing Zustand + fetch pattern |
| `recharts@2.x` | React 19 support was alpha in v2; v3 is the full-support release | `recharts@^3.8.0` |
| `next-themes` | Solves SSR hydration mismatch; irrelevant for Vite SPA | `localStorage` + `classList.toggle` |
| D3 directly | Recharts wraps D3 internally; direct D3 adds complexity for a 20-line chart | `recharts` |
| ProcessPoolExecutor | For parallel chunk encoding; broken semaphore on Windows, and ffmpeg is not CPU-bound Python | `asyncio.Semaphore` + existing `ThreadPoolExecutor` |

---

## Installation Summary

All backend additions use stdlib — no new Python packages.

```bash
# No new backend packages required.
# Verify existing packages are present:
pip show python-multipart aiofiles  # must already be installed
```

```bash
# One new frontend package:
cd frontend && npm install recharts
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `recharts@^3.8.0` | React 19, React 18 | v3 rewrote state management; confirmed working with standard React 19. Preact users see issues — irrelevant here. |
| Tailwind CSS `@custom-variant` | Tailwind v4.x | This directive did not exist in v3; it replaces `darkMode: 'class'` in `tailwind.config.js`. |
| `asyncio.Semaphore` | Python 3.8+ | stdlib; no version concern. ProactorEventLoop on Windows is unaffected. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Charting | recharts 3.8 | Chart.js / react-chartjs-2 | Imperative Canvas API; poor fit for declarative React components |
| Charting | recharts 3.8 | Victory | Heavier; D3 version coupling has caused past upgrade pain |
| Parallel encoding | asyncio.Semaphore | ProcessPoolExecutor | Broken on Windows with multiprocessing semaphores; ffmpeg is external process, not Python CPU work |
| Auto-cleanup | asyncio sleep loop | APScheduler | APScheduler is correct for complex schedules; a single periodic delete is one `while True: await asyncio.sleep()` |
| Dark mode | Tailwind @custom-variant | react-use-dark-mode | External hook not needed; the toggle is 10 lines of JS against localStorage |
| Directory browse | pathlib + security check | flask-browseable or similar | Single-user local tool; a two-line path traversal guard is sufficient |

---

## Sources

- recharts npm (latest 3.8.0 confirmed): [https://www.npmjs.com/package/recharts](https://www.npmjs.com/package/recharts)
- Recharts React 19 compatibility issue and status: [https://github.com/recharts/recharts/issues/6857](https://github.com/recharts/recharts/issues/6857), [https://github.com/recharts/recharts/issues/4558](https://github.com/recharts/recharts/issues/4558)
- Recharts 3.0 migration guide: [https://github.com/recharts/recharts/wiki/3.0-migration-guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide)
- Tailwind CSS v4 dark mode (official docs): [https://tailwindcss.com/docs/dark-mode](https://tailwindcss.com/docs/dark-mode)
- asyncio.Semaphore stdlib docs: [https://docs.python.org/3/library/asyncio-sync.html](https://docs.python.org/3/library/asyncio-sync.html)
- FastAPI UploadFile streaming pattern: [https://fastapi.tiangolo.com/tutorial/request-files/](https://fastapi.tiangolo.com/tutorial/request-files/)
- asyncio periodic task pattern: [https://superfastpython.com/asyncio-periodic-task/](https://superfastpython.com/asyncio-periodic-task/)
- asyncio Semaphore concurrency control: [https://rednafi.com/python/limit-concurrency-with-semaphore/](https://rednafi.com/python/limit-concurrency-with-semaphore/)

---

*Stack research for: VibeCoder Video Encoder v1.1*
*Researched: 2026-03-17*
