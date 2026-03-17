---
phase: 06-pipeline-reliability
plan: 03
subsystem: pipeline, api, frontend
tags: [parallel, concurrency, cancel, ThreadPoolExecutor, settings]
dependency_graph:
  requires: [06-01, 06-02]
  provides: [parallel-chunk-encoding, handle-cancel, system-endpoint, max-parallel-setting]
  affects: [pipeline.py, main.py, settings.ts, SettingsModal.tsx, test_pipeline.py]
tech_stack:
  added: [concurrent.futures.ThreadPoolExecutor, threading.Lock, asyncio.run_coroutine_threadsafe]
  patterns: [parallel-worker-with-cancel-handle, event-loop-bridge, on_started-callback]
key_files:
  created: []
  modified:
    - src/encoder/pipeline.py
    - src/encoder/main.py
    - frontend/src/api/settings.ts
    - frontend/src/components/SettingsModal.tsx
    - tests/test_pipeline.py
decisions:
  - Serial path uses await directly (no run_coroutine_threadsafe) to avoid deadlock when called from async coroutine
  - _worker_encode_chunk is pure CPU — DB writes moved to caller to cleanly separate serial/parallel paths
  - on_started fires on first stderr event (not process creation) — acceptable for cancel registration since instant-completing processes need no cancel
  - Parallel path pre-creates chunk DB rows via await before ThreadPoolExecutor to avoid bridge deadlock on create_chunk
metrics:
  duration: 7 min
  completed: 2026-03-17
  tasks_completed: 3
  files_modified: 5
---

# Phase 6 Plan 03: Parallel Chunk Encoding Summary

Parallel x264 chunk encoding via inner ThreadPoolExecutor with cancellable FfmpegProcess handle registration and configurable concurrency in SettingsModal.

## What Was Built

### Task 1: Parallel chunk encoding + /api/system (pipeline.py, main.py)

Added `concurrent.futures` and `threading` imports to pipeline.py. Modified the chunk encode section of `run_pipeline` to:

- Define `_register_handle`, `_unregister_handle`, `_cancel_all_handles` closures with `threading.Lock` protection
- Add `on_started` parameter to `_run_ffmpeg_cancellable`, `_encode_chunk_x264`, and `_encode_chunk_with_vmaf` — fires with the `FfmpegProcess` after first stderr event
- Define `_worker_encode_chunk` (pure encoding, no DB) and `_worker_encode_chunk_threaded` (wraps worker with event-loop bridge DB writes for parallel path)
- Serial path (`max_parallel <= 1`): runs in async coroutine, uses `await` for all DB calls — no `run_coroutine_threadsafe` needed
- Parallel path (`max_parallel > 1`): pre-creates chunk DB rows via `await`, submits workers to `ThreadPoolExecutor(max_workers=max_parallel)`, collects results via `as_completed`, bridges ETA updates via `run_coroutine_threadsafe`
- Cancel during parallel path: `_cancel_all_handles()` calls `.cancel()` on all registered `FfmpegProcess` objects (graceful: stdin `q\n`, then terminate, then kill)
- `encoded_chunks.sort(key=lambda p: p.name)` ensures correct concat order after parallel completion

Added `max_parallel_chunks` to `config_snapshot` in `submit_job`. Added `GET /api/system` returning `{"cpu_count": os.cpu_count() or 1}`.

### Task 2: Frontend settings (settings.ts, SettingsModal.tsx)

Added `max_parallel_chunks: number` to the `Settings` interface. Added `cpuCount` state and `/api/system` fetch on modal open. Added "Performance" section with a number input for "Max parallel encoders" capped at `cpuCount` via `max` attribute.

### Task 3: Integration tests (test_pipeline.py)

- `test_parallel_cancel_no_orphans`: Replicates the `_register_handle`/`_unregister_handle`/`_cancel_all_handles` contract in isolation using `MagicMock` — verifies `.cancel()` called on all registered handles and dict is empty after unregisters
- `test_parallel_faster_than_serial`: Standalone `ThreadPoolExecutor` timing test with `time.sleep(0.3)` tasks — asserts `max_workers=4` completes 4 tasks at least 25% faster than `max_workers=1`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test_crf_oscillation_reencodes_winner mock signature**
- **Found during:** Task 1 test run
- **Issue:** `_fake_x264` mock in existing test didn't accept `on_started` keyword arg added to `_encode_chunk_x264`
- **Fix:** Added `on_started=None` to mock signature
- **Files modified:** tests/test_pipeline.py
- **Commit:** f16ff7d

**2. [Rule 1 - Bug] Fixed serial path asyncio deadlock**
- **Found during:** Task 1 verification (test_resume_deletes_partial_chunk timeout)
- **Issue:** Serial path called `_worker_encode_chunk` which used `asyncio.run_coroutine_threadsafe(create_chunk(...), loop)` from within the async coroutine — deadlocked because the loop was already running
- **Fix:** Split into `_worker_encode_chunk` (pure CPU, no DB) and `_worker_encode_chunk_threaded` (adds event-loop bridge for parallel path). Serial path uses `await` directly. Parallel path pre-creates chunk rows via `await` before submitting workers.
- **Files modified:** src/encoder/pipeline.py
- **Commit:** f16ff7d

## Commits

- `f16ff7d` feat(06-03): parallel chunk encoding with handle registration + /api/system
- `a35735e` feat(06-03): add max_parallel_chunks to Settings + SettingsModal Performance section
- `58e3fcc` test(06-03): add parallel cancel and parallelism timing integration tests

## Verification Results

- All 54 Python tests pass (`pytest tests/ -x -q`)
- Frontend build succeeds (`npm run build`)
- Frontend 17 tests pass (`npm test -- --run`)
