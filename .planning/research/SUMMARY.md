# Project Research Summary

**Project:** VibeCoder Video Encoder
**Domain:** Python video encoding web application — v1.1 Quality & Manageability milestone
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

This is a v1.1 milestone update to an existing, working application. The v1.0 stack (FastAPI + asyncio + SQLite WAL + React 19 + Zustand 5 + Tailwind 4) is validated in production. The research scope is narrowly focused: add parallel chunk encoding, job resume after crash, smart CRF oscillation resolution, job deletion and history management, and a set of quality-of-life UI improvements (VMAF chart, dark mode toggle, auto-cleanup). No new infrastructure is required — all backend additions use Python stdlib, and the only new frontend dependency is `recharts@^3.8.0` for the VMAF line chart.

The recommended approach is strictly evolutionary. The eight new capabilities map cleanly onto the existing architecture with surgical modifications to `pipeline.py`, `db.py`, `main.py`, and several frontend components. The most critical implementation risk is parallel chunk encoding: the concurrency boundary must sit inside `pipeline.py` (a job-scoped inner `ThreadPoolExecutor`), not at the scheduler level. Cross-thread DB writes from parallel chunk workers must route through `asyncio.run_coroutine_threadsafe` to avoid creating competing event loops. SQLite must have `PRAGMA busy_timeout = 5000` added to survive concurrent write bursts from parallel workers.

The clear recommended build order is: CRF oscillation fix first (zero risk, no dependencies), then job resume (restructures the pipeline step loop), then parallel chunk encoding (builds on the restructured loop), then deletion and history management (independent backend work), then UI enhancements. Browser file upload is deferred to v1.2 — the chunked upload protocol is a meaningful engineering lift and primarily serves remote-access workflows not yet validated as a core user need.

---

## Key Findings

### Recommended Stack

The v1.0 stack requires no new Python packages for any of the v1.1 features. All backend additions use Python stdlib: `asyncio.Semaphore`, `concurrent.futures.ThreadPoolExecutor`, `asyncio.create_task`, `pathlib`, and `aiofiles` (already installed). The only new dependency is one frontend package.

**Core technologies:**

- `concurrent.futures.ThreadPoolExecutor` (stdlib, inner pool): parallel chunk encoding — job-scoped inner pool inside `run_pipeline`, distinct from the scheduler's executor which stays at `max_workers=1`
- `asyncio.run_coroutine_threadsafe` (stdlib): cross-thread DB write bridge — chunk worker threads post aiosqlite calls back to the pipeline event loop without creating competing loops
- `asyncio.create_task` + `asyncio.sleep` loop (stdlib): auto-cleanup background task — periodic sweep deletes old terminal jobs; APScheduler adds a dependency for what is a single `while True` pattern
- `recharts@^3.8.0` (new frontend dep): per-job VMAF line chart — React 19 compatible, declarative component API, ~100 KB gzipped; the only new package in the entire milestone
- Tailwind CSS v4 `@custom-variant dark` (already installed at ^4.2.1): class-based dark mode via one CSS directive and a `localStorage` toggle — no `next-themes` or SSR-flash mitigation needed for a Vite SPA

**Critical version note:** Use `recharts@^3.8.0` specifically. Version 2.x had alpha-level React 19 support. Version 3 is the full-support release; TypeScript types are included, no `@types/recharts` needed.

**See:** `.planning/research/STACK.md`

---

### Expected Features

All v1.0 table-stakes (job queue, pause/cancel/retry, SSE progress, encoding profiles, global settings, watch folder, server-side directory browser) are already built. v1.1 addresses the gaps that make the tool feel unfinished after sustained use.

**Must have — v1.1 core (P1):**
- Smart CRF oscillation resolution — quality correctness fix; zero UX complexity; ships alone with no risk
- Job resume from crash — overnight encodes depend on this; DB schema already supports it; `pipeline.py` needs step-gate guards
- Parallel chunk encoding — headlining throughput feature; default concurrency=2; configurable via SettingsModal
- Delete individual jobs + bulk-clear completed/failed — basic hygiene missing since v1.0; cascade delete requires `PRAGMA foreign_keys = ON`
- History view (active vs completed queue) — separates jobs needing attention from finished jobs; pairs with delete

**Should have — v1.1 polish (P2):**
- VMAF score history chart — visual proof of quality consistency; Recharts `LineChart` over existing `chunks` table data; no backend changes needed
- CRF convergence indicator in history view — shows which chunks needed re-encodes; minor `ChunkTable` color threshold extension
- Auto-cleanup with configurable retention — prevents unbounded history growth; `asyncio.sleep` loop, default disabled (0 hours)
- Dark mode toggle — dark default, light opt-in; persisted in `localStorage`; CSS custom properties already in place
- Server-side directory browser — **already implemented** as `/api/browse` + `FilePicker.tsx`; no v1.1 work required

**Defer to v1.2 (P3):**
- Browser file upload — chunked upload protocol (browser `File.slice()` + server append-at-offset) is a meaningful lift; primarily serves remote-access use cases not yet validated as core need

**Anti-features to explicitly avoid:**
- Parallel jobs (multiple files simultaneously) — CPU is already saturated by one job with parallel chunks; serial job queue + parallel chunks is the correct model
- Manual chunk-resume selection — creates consistency problems if profile changed between runs; auto-resume from last completed step is safe
- Light mode as default — inverts the DaVinci Resolve industrial aesthetic design intent

**See:** `.planning/research/FEATURES.md`

---

### Architecture Approach

All changes are evolutionary modifications to existing modules — no new backend modules are needed. The architecture has four change areas: (1) `pipeline.py` gets parallel chunk dispatch, resume checkpoints, and CRF oscillation fix; (2) `db.py` gets delete/bulk-delete/cleanup functions plus missing `PRAGMA foreign_keys = ON`; (3) `main.py` gets new DELETE endpoints and the auto-cleanup background task; (4) the frontend gains four new components and targeted modifications to existing ones.

**Major components and their v1.1 changes:**

1. `pipeline.py` — replace serial chunk `for`-loop with inner `ThreadPoolExecutor` dispatch; add `completed_steps` set gate at each step block (including `create_step`); replace `visited_crfs` set with `history: list[tuple[int, float]]` for midpoint-selection on oscillation exit
2. `db.py` — add `delete_job`, `delete_jobs_by_status`, `auto_cleanup_jobs`; add `PRAGMA busy_timeout = 5000` and `PRAGMA foreign_keys = ON` to `get_db()`; add `max_parallel_chunks` and `auto_cleanup_hours` to `SETTINGS_DEFAULTS`
3. `main.py` — `DELETE /api/jobs/{id}` (terminal: hard delete; running: cancel-then-delete); `DELETE /api/jobs/bulk?status=DONE`; register auto-cleanup `asyncio.create_task` in lifespan
4. `VmafChart.tsx` (new) — recharts `LineChart`; data already in `job.chunks` from existing REST response; lives inside expanded `JobCard`
5. `HistoryList.tsx` + `BulkActions.tsx` (new) — filter existing `jobs[]` Zustand array to terminal statuses; no second poll loop needed
6. `ThemeToggle.tsx` (new) — reads/writes `localStorage.theme`; sets `document.documentElement.dataset.theme`; applied in `useLayoutEffect` before first paint

**Key patterns to follow:**

- Parallel chunks use `asyncio.run_coroutine_threadsafe` (Option A) for cross-thread DB writes — keeps all DB access through `db.py`; do not open a second event loop per thread
- History view is a filtered view over the existing jobs array, not a separate store or poll interval — active queue polls `/api/jobs?status=QUEUED,...`; history does a one-time fetch on mount plus manual refresh
- Dark mode: `localStorage` is source of truth; `useLayoutEffect` in `App.tsx` applies theme before first paint; Zustand mirrors it optionally for reactive components but does not own it
- Delete of running job: cancel first (set `cancel_event`), confirm pipeline exits, then remove the DB row — never hard-delete while the pipeline thread is active

**See:** `.planning/research/ARCHITECTURE.md`

---

### Critical Pitfalls

1. **Parallel concurrency at the wrong level (N1)** — Raising `ThreadPoolExecutor(max_workers=N)` on the scheduler gives parallel jobs, not parallel chunks. The inner pool must be scoped inside `run_pipeline`. Keep the scheduler's executor at `max_workers=1`.

2. **SQLite BUSY under parallel chunk writes (N2)** — WAL mode allows one writer at a time; default busy timeout is 0 ms. N parallel chunk workers hitting `update_chunk` simultaneously get `OperationalError: database is locked`. Fix: add `PRAGMA busy_timeout = 5000` in `get_db()`.

3. **Cancel stops only the active worker in parallel mode (N3)** — In-flight ffmpeg processes are not signalled when `cancel_event` is set. Maintain a job-scoped `list[FfmpegProcess]` protected by a `threading.Lock`; iterate and call `.cancel()` on all handles when cancel fires.

4. **Resume creates duplicate step rows (N4)** — Guard the entire step block including `create_step` with `if "StepName" not in completed_steps`. Skipping only the step body while still calling `create_step` produces duplicate rows that break `_attach_stages` and the StageList UI.

5. **Resume trusts filesystem instead of DB status (N5)** — A crash between file write and `update_chunk(..., status="DONE")` leaves a physically present but DB-incomplete chunk. Trust the DB: a chunk is complete only if its row has `status="DONE"`. Delete and re-encode any chunk file whose DB row is not DONE.

6. **Cascade delete without foreign key pragma (N10)** — `PRAGMA foreign_keys = ON` is currently not set in `get_db()`. Without it, `DELETE FROM jobs WHERE id=?` leaves orphaned rows in `steps`, `chunks`, and `logs`. Either add the pragma or delete child rows explicitly in order within one transaction.

7. **Deleting a running job leaves orphaned ffmpeg processes (N9)** — The delete endpoint must cancel the job first, wait for the pipeline to exit, then remove the DB row. Hard-deleting a RUNNING job without cancellation leaves ffmpeg processes consuming CPU indefinitely.

**See:** `.planning/research/PITFALLS.md` for the full catalog including CRF selection logic (N6), upload memory exhaustion (N7), directory traversal (N8), and Zustand anti-patterns (N11, N12).

---

## Implications for Roadmap

Based on combined research, the architecture recommends a 3-phase build order for v1.1.

### Phase 1: Pipeline Reliability

**Rationale:** CRF oscillation fix, job resume, and parallel chunk encoding all modify the same loop inside `pipeline.py`. Doing them together avoids restructuring the loop twice. Resume must come before parallelism because the resume logic must also handle partially-completed parallel batches — implementing parallelism first and adding resume second is a second refactor of the same code. The CRF oscillation fix is zero-risk and ships first within the phase.

**Delivers:** Correct quality selection on oscillating content; crash-resilient overnight encodes; 2x+ throughput on multi-core machines; `max_parallel_chunks` setting in SettingsModal.

**Features addressed:** Smart CRF oscillation resolution (P1), Job resume from crash (P1), Parallel chunk encoding (P1)

**Pitfalls to avoid:** N1 (wrong concurrency level), N2 (SQLite BUSY), N3 (cancel all parallel workers), N4 (duplicate step rows on resume), N5 (filesystem vs DB trust), N6 (CRF midpoint selection)

**Research flag:** Standard patterns — well-documented in ARCHITECTURE.md with concrete code sketches. No phase research needed.

---

### Phase 2: Job Management

**Rationale:** Job delete, bulk-clear, history view, and auto-cleanup are fully independent of pipeline changes. They share a common foundation: the `delete_job` and `delete_jobs_by_status` functions in `db.py`. Build these together once the pipeline is stable. The `PRAGMA foreign_keys = ON` fix must be the first task in this phase.

**Delivers:** Users can delete individual jobs and bulk-clear completed/failed history. Active queue shows only jobs needing attention. Optional auto-cleanup prevents unbounded history growth. `HistoryList` and `BulkActions` frontend components.

**Features addressed:** Delete individual jobs (P1), Bulk-clear completed/failed (P1), History view (P1), Auto-cleanup (P2)

**Pitfalls to avoid:** N9 (orphaned ffmpeg processes from deleting running job), N10 (cascade delete without foreign key pragma)

**Research flag:** Standard patterns. No phase research needed.

---

### Phase 3: UI Enhancements

**Rationale:** VMAF chart, CRF convergence indicator, dark mode toggle, and optionally browser file upload are additive UI improvements over already-persisted data. They carry zero pipeline risk. The VMAF chart is pure Recharts over existing `chunks` data. Dark mode requires only CSS + `localStorage`. File upload is the one high-complexity item and should be evaluated for deferral to v1.2.

**Delivers:** Visual VMAF quality history per job; dark/light theme toggle; improved CRF diagnostic display in history view. Optionally: browser upload for remote workflow.

**Features addressed:** VMAF score history chart (P2), CRF convergence indicator (P2), Dark mode toggle (P2), Browser file upload (P3 — recommend deferring to v1.2)

**Pitfalls to avoid:** N7 (upload reads entire file into memory — stream with `aiofiles` 1 MB chunks), N8 (directory traversal in browse endpoint — verify `allowed_roots` path guard), N11 (Zustand object selectors causing infinite re-renders — use individual selectors), N12 (theme flash — apply in `useLayoutEffect` before first paint)

**Research flag:** VMAF chart and dark mode are standard patterns (skip research). If browser file upload is included in this phase, research the chunked upload protocol details and staging directory lifecycle before committing scope.

---

### Phase Ordering Rationale

- Pipeline changes come first because resume and parallelism restructure the same `for`-loop; either order forces a second pass through the same code.
- Job management is independent of pipeline changes and can start in parallel with Phase 1 if capacity allows, but should not block on Phase 1 completion.
- UI enhancements come last because they are purely additive over stable backend data; the VMAF chart has no value until reliable per-chunk data exists from Phase 1.
- Browser upload is deferred because it introduces a new upload protocol surface (chunked slice+reassemble with no built-in tus support) that is independent of all other v1.1 work and whose use case is not yet validated.

---

### Research Flags

**Needs deeper research during planning:**
- **Phase 3 (Browser file upload only):** Chunked upload implementation details — `File.slice()` chunk size selection, `X-Upload-Offset` header semantics, server-side append atomicity, upload session cleanup after job completion. The FEATURES.md assessment is MEDIUM confidence. Research before committing to v1.1 scope.

**Standard patterns (skip research-phase):**
- **Phase 1:** `asyncio.run_coroutine_threadsafe`, inner `ThreadPoolExecutor` scoped to job, checkpoint-based resume with `completed_steps` set — fully specified with code sketches in ARCHITECTURE.md.
- **Phase 2:** SQLite cascade delete semantics, REST DELETE endpoint behavior for running vs terminal jobs, `asyncio.create_task` background cleanup — straightforward.
- **Phase 3 (excluding upload):** Recharts `LineChart` + `ReferenceArea`, CSS `[data-theme]` dark mode, `localStorage` persistence — all HIGH confidence with official documentation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All new additions use stdlib or a single well-verified npm package. Verified against current npm registry (recharts 3.8.0), Python docs, and Tailwind v4 docs. |
| Features | HIGH | P1/P2/P3 priority split is clear and well-reasoned. One MEDIUM gap: browser upload protocol behavior at >10 GB has not been validated. |
| Architecture | HIGH | Based on direct code inspection of all existing modules on 2026-03-17. Integration points per feature are fully specified with concrete code patterns. No speculation. |
| Pitfalls | HIGH | v1.1 pitfalls derived from direct code analysis of the existing application + official Python docs + ffmpeg docs. SQLITE_BUSY and cancel-all-parallel-workers are the most likely to be hit if not addressed proactively. |

**Overall confidence: HIGH**

### Gaps to Address

- **`PRAGMA foreign_keys = ON` current state:** ARCHITECTURE.md explicitly notes this pragma is missing from `get_db()`. Confirm before building Phase 2. If it has been added since the last code audit, cascade delete may already work.

- **Resume + parallel interaction edge case:** When a parallel-encoded job is resumed, chunks that were mid-encode at crash time have `status='RUNNING'` in the DB (not DONE). The safe rule is: treat any non-DONE chunk as incomplete, delete its output file, and re-encode. Validate this edge case explicitly during Phase 1 testing with a simulated mid-chunk crash.

- **Browser upload at scale:** The 1 MB chunk streaming approach is documented for moderate files. Behavior at 50+ GB has not been validated. If upload is included in v1.1, test with a 20+ GB file before shipping.

- **Recharts bundle size impact:** recharts@3.8 is approximately 100 KB gzipped. The current frontend bundle size is not documented. Measure before and after adding the dependency and confirm acceptable for the target use case.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/encoder/{main,pipeline,scheduler,db,sse,ffmpeg}.py` (2026-03-17) — architecture and pitfall assessments
- Direct codebase inspection: `frontend/src/{store/jobsStore,types/index,components/*}.ts(x)` (2026-03-17) — frontend architecture
- recharts npm registry (3.8.0 confirmed): https://www.npmjs.com/package/recharts
- Tailwind CSS v4 dark mode official docs: https://tailwindcss.com/docs/dark-mode
- asyncio.Semaphore stdlib docs: https://docs.python.org/3/library/asyncio-sync.html
- asyncio.run_coroutine_threadsafe docs: https://docs.python.org/3/library/asyncio-task.html#asyncio.run_coroutine_threadsafe
- FastAPI UploadFile streaming docs: https://fastapi.tiangolo.com/tutorial/request-files/

### Secondary (MEDIUM confidence)
- asyncio Semaphore concurrency control: https://rednafi.com/python/limit-concurrency-with-semaphore/
- Recharts React 19 compatibility tracking: https://github.com/recharts/recharts/issues/6857
- Recharts 3.0 migration guide: https://github.com/recharts/recharts/wiki/3.0-migration-guide
- Dark mode with CSS variables + localStorage: https://www.joshwcomeau.com/react/dark-mode/
- Bulk action UX guidelines: https://www.eleken.co/blog-posts/bulk-actions-ux
- asyncio periodic task pattern: https://superfastpython.com/asyncio-periodic-task/

### Tertiary (MEDIUM confidence — implementation details not validated at scale)
- Chunked upload browser pattern: https://www.fastpix.io/blog/how-to-upload-large-video-files-efficiently-using-chunking
- Checkpoint-based recovery patterns: https://dev3lop.com/checkpoint-based-recovery-for-long-running-data-transformations/

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
