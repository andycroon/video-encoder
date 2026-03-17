# Feature Research

**Domain:** Video encoding queue manager — v1.1 new capabilities (Quality & Manageability)
**Researched:** 2026-03-17
**Confidence:** HIGH (most features have well-established UX patterns; pipeline internals informed by existing codebase review)

> Note: v1.0 table-stakes features (job queue, pause/cancel/retry, real-time SSE progress, encoding profiles,
> global settings, watch folder) are already built. This document covers only v1.1 additions.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any job management tool provides. Missing them makes the product feel unfinished now that v1.0 exists.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Delete individual jobs | Every queue tool has delete; "I can't remove a done job" is an immediate annoyance | LOW | DB row delete + cascade to steps/chunks/logs. Hard-delete (no soft-delete) is correct for a local tool. |
| Bulk-clear completed jobs | Standard batch management affordance; grows critical as queue fills up | LOW | Single `DELETE WHERE status = 'DONE'`. Confirm dialog or undo toast. |
| Bulk-clear failed jobs | Pairs with completed clear; symmetry is expected | LOW | Same pattern, different status filter. |
| Separate history view for completed jobs | Active queue should show only jobs needing attention; completed jobs clutter it | MEDIUM | Tab or collapsible section. History is read-only — no retry from history (retry lives in active queue). |
| Smart CRF oscillation resolution | CRF loop currently picks the last CRF it landed on — quality outcome is non-deterministic on oscillating content | LOW | Pure algorithm change in pipeline.py. Track all (CRF, VMAF) pairs during the loop; at exit pick the pair closest to window center. Tiebreak: lower CRF. No UX change needed. |
| Job resume after crash | Long overnight encodes crashing = hours of lost work. Users of encoding tools expect crash resilience. | HIGH | DB already has step-level completion tracking. Pipeline needs to check step status at entry and skip completed steps. |

### Differentiators (Competitive Advantage)

Features that distinguish this tool from HandBrake/Tdarr and deliver v1.1's stated quality and manageability improvements.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Parallel chunk encoding with configurable concurrency | Chunks are independent post-split — this is free throughput. 2–4x speedup on multi-core machines. No comparable self-hosted tool does per-chunk parallelism with VMAF feedback. | HIGH | `asyncio.Semaphore(N)` gates concurrent chunk encodes. N is a configurable setting (default: 2). Each chunk encode is a subprocess on a ThreadPoolExecutor thread — existing Windows-compatible pattern. ETA math must account for parallelism. |
| VMAF score history chart per job | Direct visual proof of quality consistency across scenes. HandBrake offers no built-in VMAF chart. Shows which chunks were hard to encode. | MEDIUM | Line chart: x = chunk index, y = VMAF score. Reference lines at vmafMin / vmafMax. Color-fill target band. Data already in `chunks` table. Recharts is the natural React library choice. Lives in expanded JobCard alongside existing ChunkTable. |
| CRF convergence indicator (passes count) | Shows which chunks needed re-encodes — actionable diagnostic for tuning VMAF targets and CRF ranges. Already partially present (Passes column in ChunkTable, yellow when > 1). | LOW | Extend to be visible in history view post-completion, not just during active encoding. Tooltip explaining what re-encodes mean adds value for new users. |
| Auto-cleanup with configurable retention | Prevents unbounded history growth without forcing manual cleanup. Standard in enterprise job systems. | LOW | Configurable retention period (default: 30 days) in settings. Background task on startup + periodic interval deletes DONE/CANCELLED/FAILED jobs older than threshold. |
| Server-side directory browser for file selection | Reduces friction for local/NAS users who currently type long paths. Does not require upload — just browse and select. | MEDIUM | REST endpoint returning directory listing JSON. Modal tree/list in frontend. Security: scope to configurable allowed root paths. Do not expose arbitrary filesystem. |
| Browser file upload for source videos | Enables remote workflow: encode on a powerful server, upload from a laptop. | HIGH | Large files (10–100 GB) require chunked upload — browser slices file, POSTs slices with offset headers, server appends to staging file. FastAPI `UploadFile` is not suitable for large files (single-request body). tus protocol is full-featured but heavy; a manual slice+reassemble approach is simpler and sufficient for local-network use. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Parallel jobs (multiple files encoding simultaneously) | Power users want maximum throughput | CPU is fully saturated by one job with parallel chunk encoding enabled. Two jobs fight for CPU, both get slower. Serial job queue + parallel chunks is the correct model. | Parallel chunk encoding within a single job (PIPE-V2-01) |
| User-controlled resume (pick which chunk to restart from) | "Skip chunks 1–20, redo from 21" sounds useful | Creates consistency problems if profile changed since original encode. Existing encoded chunks may be stale. Auto-resume at last completed step is safe; manual chunk selection is not. | Automatic crash-resume from last completed step (PIPE-V2-02) |
| Upload progress shown as a job row | "Show upload status in the queue" feels unified | Upload and encode are different operations with different failure modes. Conflating them complicates cancel, error recovery, and status semantics. | Upload progress widget in the file input area only. Job row created after upload completes and encode begins. |
| Per-chunk retry (retry one bad chunk) | Fine-grained quality control | The VMAF-targeted CRF loop already handles quality variance per chunk automatically. Smart CRF oscillation resolution eliminates the remaining quality non-determinism. Manual per-chunk retry adds complexity with no benefit. | Smart CRF oscillation resolution (PIPE-V2-03) |
| Light mode as default | "Some users prefer light" | The existing app has a dark industrial aesthetic (DaVinci Resolve inspired). Changing the default inverts the design intent. Toggle gives users the choice without changing the baseline. | Dark mode toggle — dark is default, light is opt-in. Persist in localStorage. |

---

## Feature Dependencies

```
Parallel chunk encoding
    └──requires──> asyncio.Semaphore concurrency gate in pipeline.py inner loop
    └──requires──> Per-chunk progress already working correctly (done in v1.0)
    └──enhances──> ETA display (ETA formula must account for parallel throughput)
    └──complicates──> Job resume (resume must reconstruct which parallel chunks completed)

Job resume from crash
    └──requires──> Step-level completion status in DB (already exists: steps table)
    └──requires──> Pipeline entry point checks step DB status and skips DONE steps
    └──requires──> Chunk-level DONE tracking (already exists: chunks table status)
    └──enhances when combined with──> Parallel chunk encoding (implement resume first, parallelism second)

Smart CRF oscillation resolution
    └──requires──> Existing VMAF scoring loop in pipeline.py (already exists)
    └──enhances──> VMAF score history chart (chart shows the "winning" VMAF more accurately)
    └──no UI changes required

VMAF score history chart
    └──requires──> Per-chunk VMAF data persisted post-job (already in chunks table)
    └──requires──> Chart library (Recharts — add to frontend dependencies)
    └──enhances──> CRF convergence indicator (colocate chart and passes data in JobCard)

CRF convergence indicator (passes count)
    └──requires──> Pass count per chunk in DB (already stored as passes column)
    └──enhances──> VMAF score history chart (shown alongside chart or as chart overlay)

Delete individual jobs
    └──requires──> Cascade delete for steps, chunks, logs rows in DB
    └──requires──> SQLite foreign key enforcement (PRAGMA foreign_keys = ON at connection time)
    └──enables──> Bulk-clear operations (bulk = batch deletes)

Bulk-clear operations
    └──requires──> Delete individual jobs (same underlying operation, batched)
    └──no new UI pattern — standard "Clear completed" / "Clear failed" buttons

History view
    └──requires──> Status-based list filtering (DONE/CANCELLED/FAILED vs QUEUED/RUNNING/PAUSED)
    └──requires──> Delete individual jobs (history rows need a delete action)
    └──enables──> Auto-cleanup (users can see what gets cleaned before trusting auto-cleanup)

Auto-cleanup
    └──requires──> History view (user trust)
    └──requires──> Retention period setting (new settings field in settings modal)
    └──requires──> Background task on startup to delete expired history rows

Browser file upload
    └──requires──> Chunked upload endpoint in FastAPI (new route: /api/upload)
    └──requires──> Upload staging directory (configurable, separate from watch folder)
    └──conflicts-with──> Server-side directory browser (distinct input modes; keep UI separate)

Server-side directory browser
    └──requires──> Directory listing REST endpoint (/api/browse?path=...)
    └──requires──> Allowed-paths security scope (settings: browseable_roots list)
    └──enhances──> Existing path entry (browser replaces typing for local files)

Dark mode toggle
    └──requires──> Verify CSS custom properties are already the theming mechanism (they are — var(--bg), var(--txt-2), etc.)
    └──requires──> data-theme attribute on <html> or <body>, toggled by JS
    └──requires──> Persist choice in localStorage
    └──no conflicts
```

### Dependency Notes

- **Job resume + parallel chunk encoding:** Implement resume first, then layer in parallelism. When both are active, the resume logic must reconstruct which chunks in a parallel batch completed (status = 'DONE') vs which were interrupted mid-encode (status = 'RUNNING' at crash time, treated as incomplete on restart). The safe rule: only chunks with status 'DONE' are skipped on resume; anything else re-encodes.
- **Browser upload requires chunked upload, not FastAPI UploadFile:** FastAPI's built-in `UploadFile` reads the full request body — fine for small files, OOM risk for 10–100 GB video. Chunked approach: browser `File.slice()` posts 10–50 MB chunks with `Content-Range` / `X-Upload-Offset` headers; server appends to a staging file; final chunk triggers job creation. No tus dependency needed.
- **Bulk-clear and delete require cascade:** The SQLite schema has `steps`, `chunks`, and `logs` related to `jobs` by foreign key. Delete must cascade or rows orphan. Verify `PRAGMA foreign_keys = ON` is set in the `get_db()` context manager (currently it is not — must be added).
- **Dark mode CSS readiness:** The existing app uses CSS custom properties (`var(--bg)`, `var(--txt-2)`, `var(--border)`, etc.) already. Dark mode toggle only needs to swap a `data-theme` attribute and define a `[data-theme="light"]` override block. This is a LOW effort change given the existing architecture.

---

## MVP Definition for v1.1

This is a subsequent milestone. "MVP" = minimum to deliver the milestone's stated goals.

### Launch With (v1.1 core — all must ship together)

- [ ] Smart CRF oscillation resolution — zero UX complexity, pure quality correctness fix. No reason to defer.
- [ ] Job resume from crash — reliability guarantee for long encodes. Core promise of the milestone.
- [ ] Parallel chunk encoding — headlining performance feature. Validate with concurrency=2 default.
- [ ] Delete individual jobs + bulk-clear completed/failed — basic hygiene that's been missing since v1.0.
- [ ] History view (completed jobs separated from active queue) — pairs with delete; required for the queue to stay usable.

### Add in v1.1 (polish and extended input)

- [ ] VMAF score history chart — high diagnostic value, depends on Recharts being added.
- [ ] CRF convergence indicator in history view — minimal effort once chart is in place.
- [ ] Auto-cleanup with configurable retention — straightforward after history view exists.
- [ ] Dark mode toggle — independent, low effort, good polish.
- [ ] Server-side directory browser — reduces friction for local users; medium effort.

### Defer to v1.2 (high implementation cost)

- [ ] Browser file upload — chunked upload protocol is a meaningful engineering lift (new upload route, staging dir management, frontend upload widget, progress display, error recovery). Delivers value primarily for remote-access use cases. Defer until remote access is validated as a real user need.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Smart CRF oscillation resolution | HIGH | LOW | P1 |
| Job resume from crash | HIGH | HIGH | P1 |
| Parallel chunk encoding | HIGH | HIGH | P1 |
| Delete individual jobs | HIGH | LOW | P1 |
| Bulk-clear completed / failed jobs | HIGH | LOW | P1 |
| History view (active vs completed) | HIGH | MEDIUM | P1 |
| VMAF score history chart | MEDIUM | MEDIUM | P2 |
| CRF convergence indicator in history | MEDIUM | LOW | P2 |
| Auto-cleanup with retention setting | MEDIUM | LOW | P2 |
| Dark mode toggle | MEDIUM | LOW | P2 |
| Server-side directory browser | MEDIUM | MEDIUM | P2 |
| Browser file upload | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must ship in v1.1 — core milestone deliverable
- P2: Should ship in v1.1 — polish and extended input; defer to v1.2 if capacity is tight
- P3: Future consideration — high cost relative to value for this user base

---

## Complexity Deep-Dives

### Parallel Chunk Encoding

The existing `Scheduler` is intentionally serial (`ThreadPoolExecutor(max_workers=1)`). The serial boundary is correct at the job level — no parallel jobs. The change is inside `pipeline.py`: the inner chunk encode loop currently processes chunks sequentially. Replace with `asyncio.gather` (or equivalent) with a `Semaphore(N)` gate.

Key constraints:
- Each chunk encode is a subprocess (ffmpeg). On Windows, subprocess management is via `ThreadPoolExecutor` threads (existing pattern). Parallel chunks = multiple concurrent threads, each running a subprocess.
- Memory pressure: VMAF scoring reads FFV1 source frames per chunk. With 4 parallel chunks, RAM can spike significantly on large sources. Default concurrency of 2 is conservative and safe for most machines.
- Progress reporting: SSE `chunk_complete` events are already per-chunk. Out-of-order events are safe — the frontend ChunkTable keyed on `chunkIndex` handles them correctly.
- ETA recalculation: current formula is `(elapsed / chunks_done) * chunks_remaining`. With parallelism, use `(elapsed / chunks_done) * chunks_remaining / concurrency_limit` as an approximation.

**Confidence:** HIGH — pattern is well-established (asyncio.Semaphore), existing codebase is structurally ready.

### Job Resume from Crash

The DB already supports this:
- `steps` table has per-step status (PENDING, RUNNING, DONE, FAILED)
- `recover_stale_jobs()` resets RUNNING jobs to QUEUED on startup
- `chunks` table has per-chunk status

What `pipeline.py` needs:
- At entry: query step statuses for this job
- For each pipeline step: if step DB status is 'DONE', skip execution
- For chunk encoding: skip chunks where status = 'DONE' in the chunks table
- Idempotency check for file-producing steps: FFV1 intermediate, scene CSV, chunk files, audio file — test `Path.exists()` before re-running

The crash recovery path: app restarts → `recover_stale_jobs()` → RUNNING job becomes QUEUED → Scheduler picks it up → `run_pipeline()` with resume-aware logic → skips completed steps.

**Confidence:** HIGH — DB schema already supports this. No schema changes needed.

### Browser File Upload

FastAPI's `UploadFile` is a single-request upload. For 10–100 GB video files, a chunked approach is required:
1. Browser: `File.slice(offset, offset + chunkSize)` → POST `/api/upload/chunk` with `X-Upload-Id`, `X-Upload-Offset`, `X-Upload-Total` headers
2. Server: append slice to staging file at offset, track received bytes
3. Final chunk: when `offset + chunk_size >= total`, reassemble is complete → create job

Simpler alternative: just increase FastAPI's max upload size and use streaming to disk. Works for moderate files (<10 GB) but blocks the request thread for large files. Not recommended.

Full tus protocol (`tuspy` library) handles all edge cases but adds a significant dependency and protocol surface. Not warranted for a local-network tool.

**Recommendation:** Manual slice+reassemble. Accept that browser-side upload resume (if tab closes mid-upload) is not supported in v1.1.

**Confidence:** MEDIUM — implementation is clear but requires validation of memory/disk behavior at scale.

### VMAF Score History Chart

Data is already available in the `chunks` table (`vmaf_score` per chunk). No DB changes needed. The chart:
- X axis: chunk index (0…N)
- Y axis: VMAF score (scale: ~93 to 100 for typical quality targets)
- Reference lines: `vmafMin` and `vmafMax` (horizontal dashed lines)
- Color fill: light tint between the reference lines (the target window)
- Data points: actual VMAF score per chunk (line with dots)

Recharts is the natural choice: mature, React-native, declarative, small-ish bundle (~100 KB gzipped). The chart lives inside the expanded JobCard below or alongside the existing ChunkTable.

For live display during encoding: accumulate chunk data in Zustand as `chunk_complete` SSE events arrive — already in the store. Chart updates reactively.

**Confidence:** HIGH — data pipeline is already in place, library is mature.

---

## Competitor Feature Analysis

| Feature | HandBrake | Tdarr | Our Approach |
|---------|-----------|-------|--------------|
| Parallel encoding | Multi-threaded within a single encode, not chunk-parallel | Worker-based parallel jobs (different files) | Semaphore-limited parallel chunks within one job |
| VMAF targeting | No built-in feedback loop | Plugin-based | Native feedback loop: CRF adjusts until VMAF lands in window |
| VMAF chart | Not built-in (users use external FFMetrics) | Not built-in | Native per-job chart showing chunk-by-chunk scores |
| Job resume after crash | Restart from zero | Partial (depends on plugin) | Native: step-level checkpoint in SQLite |
| Job history | Last session only, no persistence | Persistent history | SQLite-backed history with auto-cleanup |
| File input | Local file picker only | Watch folder + library scan | Watch folder + path entry + directory browser + upload |
| Delete / bulk-clear history | Yes | Yes | Yes (v1.1) |
| Dark mode | System-follow only | Yes | Toggle (dark default, light opt-in) |

---

## Sources

- Existing codebase: `src/encoder/pipeline.py`, `src/encoder/scheduler.py`, `src/encoder/db.py`, `frontend/src/components/ChunkTable.tsx`, `frontend/src/components/JobRow.tsx` — complexity assessments for pipeline features
- [Controlling Concurrency in Python: Semaphores and Pool Workers](https://dev.to/ctrix/controlling-concurrency-in-python-semaphores-and-pool-workers-56d7) — asyncio.Semaphore pattern for parallel chunk encoding (HIGH confidence)
- [Limit concurrency with semaphore in Python asyncio](https://rednafi.com/python/limit-concurrency-with-semaphore/) — confirmed standard pattern (HIGH confidence)
- [How to Upload Large Video Files Efficiently Using Chunking](https://www.fastpix.io/blog/how-to-upload-large-video-files-efficiently-using-chunking) — browser upload complexity analysis (MEDIUM confidence)
- [Optimizing online file uploads with chunking and parallel uploads](https://transloadit.com/devtips/optimizing-online-file-uploads-with-chunking-and-parallel-uploads/) — chunked upload UX requirements (MEDIUM confidence)
- [Checkpoint-Based Recovery for Long-Running Data Transformations](https://dev3lop.com/checkpoint-based-recovery-for-long-running-data-transformations/) — job resume checkpoint patterns (MEDIUM confidence)
- [Bulk action UX: 8 design guidelines with examples for SaaS](https://www.eleken.co/blog-posts/bulk-actions-ux) — bulk-clear UX (confirmation, undo toast) (MEDIUM confidence)
- [The Quest for the Perfect Dark Mode](https://www.joshwcomeau.com/react/dark-mode/) — dark mode implementation with CSS variables + localStorage (HIGH confidence)
- [Visual Quality Metrics HandBrake Issue #5857](https://github.com/HandBrake/HandBrake/issues/5857) — HandBrake lacks native VMAF chart, confirms differentiator value (HIGH confidence)
- [Introducing VMAF percentiles for video quality measurements](https://blog.x.com/engineering/en_us/topics/infrastructure/2020/introducing-vmaf-percentiles-for-video-quality-measurements) — VMAF visualization precedents from Twitter/X (MEDIUM confidence)

---
*Feature research for: VibeCoder Video Encoder — v1.1 Quality & Manageability milestone*
*Researched: 2026-03-17*
