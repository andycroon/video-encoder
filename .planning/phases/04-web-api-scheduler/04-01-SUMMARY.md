---
phase: 04-web-api-scheduler
plan: 01
subsystem: web-api
tags: [fastapi, settings, sqlite, rest-api]
dependency_graph:
  requires: [03-pipeline-runner]
  provides: [fastapi-app, settings-rest-api, settings-db-layer]
  affects: [04-02, 04-03, 04-04]
tech_stack:
  added: [fastapi>=0.111,<0.120, uvicorn[standard]>=0.29,<0.35]
  patterns: [lifespan-startup, asynccontextmanager, CORSMiddleware, INSERT-OR-IGNORE-seed]
key_files:
  created: [src/encoder/main.py, tests/test_settings_db.py]
  modified: [src/encoder/db.py, pyproject.toml]
decisions:
  - "Settings stored as TEXT in SQLite with Python-side type coercion — avoids SQLite type affinity ambiguity"
  - "INSERT OR IGNORE seed pattern preserves existing user values across app restarts"
  - "SETTINGS_DEFAULTS and type-map constants at module level for single source of truth"
  - "put_settings silently ignores unknown keys — API is forgiving by design"
metrics:
  duration: "2 minutes"
  completed_date: "2026-03-08"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
requirements_satisfied: [CONF-05, CONF-06]
---

# Phase 4 Plan 01: FastAPI Bootstrap + Settings Persistence Summary

**One-liner:** FastAPI app with lifespan startup, CORS, and /settings GET/PUT endpoints backed by a SQLite key-value settings table seeded with nine encoder defaults.

## What Was Built

The FastAPI application foundation for the video encoder web API. Settings (VMAF range, CRF bounds, audio codec, output/temp/watch-folder paths) are readable and writable via REST and survive application restarts via SQLite.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Add failing tests for settings DB | 6bb877d | tests/test_settings_db.py |
| 1 (GREEN) | settings table + get_settings + put_settings | 94400a9 | src/encoder/db.py |
| 2 | FastAPI app + /settings endpoints | c8988fe | src/encoder/main.py, pyproject.toml |

## Verification Results

- `python -m pytest tests/test_settings_db.py -x -q` — 4/4 tests passed
- `python -m pytest tests/test_db.py -x -q` — 7/7 existing tests still pass (no regressions)
- `python -c "from encoder.main import app; print('app import OK')"` — exits 0
- `GET /` returns `{"status": "ok"}` — confirmed via curl
- `GET /settings` returns all nine keys with typed values — confirmed via curl
- `PUT /settings` with `{"vmaf_min": 94.0}` returns updated value — confirmed via curl
- Settings persist across connection opens (test_put_settings_persists passes)

## API Contract

```
GET  /          → {"status": "ok"}
GET  /settings  → {vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, output_path, temp_path, watch_folder_path}
PUT  /settings  → accepts partial dict, returns full updated settings
```

## Decisions Made

1. **TEXT storage with Python coercion** — Settings stored as TEXT in SQLite, coerced to float/int by `_coerce_setting()`. Avoids SQLite type affinity surprises and keeps schema simple.

2. **INSERT OR IGNORE seed** — Defaults inserted with `INSERT OR IGNORE` on every `init_db()` call. User-saved values are never overwritten by code changes to defaults.

3. **`put_settings` silently ignores unknown keys** — API is forgiving. Clients can send extra fields without breaking persistence.

4. **Module-level constants** — `SETTINGS_DEFAULTS`, `_SETTINGS_FLOAT_KEYS`, `_SETTINGS_INT_KEYS` defined at module level as single source of truth for both DDL seeding and type coercion.

## Deviations from Plan

None - plan executed exactly as written.

## Next Plans

- **04-02**: Job queue REST endpoints (POST /jobs, GET /jobs, GET /jobs/{id}, DELETE /jobs/{id}/cancel)
- **04-03**: SSE progress streaming endpoint
- **04-04**: Watch folder scheduler + disk space checks
