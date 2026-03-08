---
phase: 04-web-api-scheduler
plan: 03
subsystem: sse
tags: [sse, streaming, event-bus, fastapi, asyncio]
dependency_graph:
  requires: [04-02]
  provides: [SSE event streaming, /jobs/{id}/stream endpoint, EventBus pub/sub]
  affects: [05-react-ui]
tech_stack:
  added: [asyncio.Queue per-job pub/sub, fastapi StreamingResponse, text/event-stream]
  patterns: [singleton EventBus, keepalive ping generator, named SSE events]
key_files:
  created:
    - src/encoder/sse.py
    - tests/test_sse.py
    - tests/test_sse_debug.py
    - tests/test_task2_verify.py
  modified:
    - src/encoder/scheduler.py
    - src/encoder/main.py
decisions:
  - "EventBus termination check uses SSE wire format (event: name) not JSON data content — _format_sse produces 'event: job_complete\\ndata: ...' so check is startswith('event: job_complete\\n')"
  - "publish() is synchronous so it can be called from both async and thread contexts without call_soon_threadsafe (scheduler._run_job is async, so direct call is fine)"
  - "event_bus.close() called in finally block of _run_job to always clean up subscriber queues even on cancellation"
  - "Stage/chunk events from inside pipeline are Phase 5 enhancement — Phase 4 publishes stage=starting, job_complete, error at job boundaries"
metrics:
  duration_seconds: 896
  completed_date: "2026-03-08"
  tasks_completed: 2
  files_changed: 6
---

# Phase 4 Plan 3: SSE Event Streaming Summary

**One-liner:** In-process asyncio.Queue EventBus with named SSE events (stage/job_complete/error/warning) streamed via GET /jobs/{id}/stream with 15s keepalive pings.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create src/encoder/sse.py EventBus | 69a606d | src/encoder/sse.py, tests/test_sse.py |
| 2 | Wire event_bus into scheduler + /stream endpoint | d81a257 | src/encoder/scheduler.py, src/encoder/main.py, tests/test_task2_verify.py |

## What Was Built

### EventBus (src/encoder/sse.py)
- Per-job `asyncio.Queue` subscriber registry (maxsize=256)
- `publish(job_id, event_type, data)` — synchronous, safe from async or thread context
- `subscribe(job_id)` — async generator yielding SSE-formatted strings
- Keepalive pings (`: ping\n\n`) every 15 seconds via `asyncio.wait_for` timeout
- Auto-terminates after `job_complete` or `error` events
- `close(job_id)` — pushes None sentinel to cleanly drain subscribers
- Singleton `event_bus` exported for use across modules

### Scheduler SSE Integration (src/encoder/scheduler.py)
- Imports `event_bus` singleton
- Publishes `stage` event (name=starting) before pipeline starts
- Publishes `job_complete` after pipeline succeeds (status from DB)
- Publishes `error` on exception; always calls `event_bus.close()` in `finally`
- `_disk_preflight` now publishes `warning` SSE event when disk is low

### Stream Endpoint (src/encoder/main.py)
- `GET /jobs/{job_id}/stream` returns `StreamingResponse`
- `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`
- 404 if job not found
- Async generator delegates to `event_bus.subscribe(job_id)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SSE stream termination check**
- **Found during:** Task 1 test writing
- **Issue:** Plan's original termination check used `'"job_complete"' in message` which looks for the JSON-quoted string in the message body. But `_format_sse("job_complete", data)` produces `event: job_complete\ndata: {...}\n\n` — the event type is in the SSE `event:` line, not JSON-quoted in the data. The check never matched so streams never self-terminated.
- **Fix:** Changed to `message.startswith("event: job_complete\n") or message.startswith("event: error\n")` which matches the actual SSE wire format.
- **Files modified:** src/encoder/sse.py (line 49-50)
- **Commit:** 69a606d

## SSE Wire Format (Spec Compliance)

Named events follow the SSE spec:
```
event: stage
data: {"name": "starting", "started_at": "2026-03-08T09:41:30Z"}

event: job_complete
data: {"status": "DONE", "duration": 0.0}

: ping

```

Browser DevTools Network tab will show `Content-Type: text/event-stream` for `/jobs/{id}/stream`.

## Self-Check

### Files exist:
- src/encoder/sse.py: FOUND
- tests/test_sse.py: FOUND
- tests/test_task2_verify.py: FOUND

### Commits exist:
- 69a606d: FOUND
- d81a257: FOUND

### Tests passing: 43 passed (excluding 4 pre-existing test_settings_db failures)

## Self-Check: PASSED
