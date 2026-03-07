# Roadmap: VibeCoder Video Encoder

## Overview

The build order is strictly bottom-up: validate cross-platform subprocess execution first, then add durable state, then build the full encoding pipeline as a CLI, then expose it through a web API with SSE progress streaming, and finally deliver the browser UI that makes it all user-accessible. Each phase produces something independently testable that the next phase depends on. Cutting corners on this order produces foundational rewrites — the Windows subprocess pitfalls must be solved before anything runs on top of them.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Subprocess Foundation** - Cross-platform ffmpeg subprocess wrapper with progress parsing and graceful cancellation
- [ ] **Phase 2: SQLite State Layer** - Durable job state schema with WAL mode and tested CRUD functions
- [ ] **Phase 3: Pipeline Runner** - Complete 10-step encoding pipeline as a CLI with VMAF CRF feedback loop
- [ ] **Phase 4: Web API + Scheduler** - FastAPI REST + SSE endpoints, asyncio job scheduler, watch folder, global config
- [ ] **Phase 5: React UI** - Browser interface surfacing all queue management, progress, and configuration capabilities

## Phase Details

### Phase 1: Subprocess Foundation
**Goal**: Cross-platform ffmpeg and ffprobe subprocess execution is proven correct on Windows and Linux before any other code depends on it
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-10
**Success Criteria** (what must be TRUE):
  1. A single ffmpeg command runs successfully on both Windows and Linux via the subprocess wrapper, with structured progress output yielded to the caller
  2. A running ffmpeg encode can be cancelled gracefully (stdin 'q' then terminate) without killing the Python parent process on Windows
  3. The VMAF model path escaping utility produces a filter-string-safe path on both platforms, validated against a known Windows drive-letter path
  4. The subprocess wrapper raises a clear, typed error when ffmpeg exits non-zero, including the captured stderr content
**Plans**: TBD

### Phase 2: SQLite State Layer
**Goal**: All job lifecycle state can be written and read durably, surviving application restarts, before the scheduler or API depend on it
**Depends on**: Phase 1
**Requirements**: QUEUE-05
**Success Criteria** (what must be TRUE):
  1. A job written to the database with state QUEUED survives a Python process restart and is readable with the same fields
  2. WAL mode is active on the database connection (verifiable via `PRAGMA journal_mode`)
  3. Jobs left in RUNNING state are detectable at startup via the heartbeat_at column, enabling recovery without data loss
  4. All step records, VMAF scores, CRF values, and ffmpeg log events are writable and queryable through the DB access layer
**Plans**: TBD

### Phase 3: Pipeline Runner
**Goal**: A real source MKV file can be encoded end-to-end — FFV1 intermediate, scene detection, chunking, audio transcode, per-chunk x264 encode with VMAF CRF feedback loop, concat, mux, and cleanup — entirely from the command line
**Depends on**: Phase 2
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09, CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. Running the CLI on a test MKV produces a final output MKV with all pipeline steps completing without error, and no temp files left on disk after cleanup
  2. The VMAF CRF feedback loop converges: each chunk's final VMAF score lands within the configured [vmafMin, vmafMax] range, or the loop terminates at CRF bounds with the best available result (max 10 iterations per chunk)
  3. Per-chunk VMAF scores and final CRF values are stored in the steps table and readable after job completion
  4. Audio is transcoded to the configured codec (EAC3, AAC, FLAC, or copy) and present in the final MKV
  5. The pipeline runs identically on Windows and Linux with configurable VMAF range, CRF bounds, audio codec, and x264 preset parameters
**Plans**: TBD

### Phase 4: Web API + Scheduler
**Goal**: All pipeline capabilities are accessible via HTTP — job submission, pause, cancel, retry, watch folder auto-enqueueing, SSE progress streaming, and global configuration — testable with curl and browser DevTools before the React UI exists
**Depends on**: Phase 3
**Requirements**: QUEUE-06, CONF-05, CONF-06, PROG-05
**Success Criteria** (what must be TRUE):
  1. A job submitted via POST /jobs with a valid file path is picked up by the scheduler and begins encoding; its SSE stream is visible in browser DevTools with named stage events
  2. Global defaults (VMAF range, CRF bounds, audio codec, output path, temp path) are readable and writable via the settings API and persist across restarts
  3. New MKV files dropped into the configured watch folder are automatically added to the job queue within a debounce window
  4. A pre-flight disk space check runs before a job starts and the API returns a warning response if available space is below 3x the source file size
**Plans**: TBD

### Phase 5: React UI
**Goal**: Every queue management action, progress indicator, and configuration option is accessible in the browser without any command-line interaction
**Depends on**: Phase 4
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, PROG-01, PROG-02, PROG-03, PROG-04
**Success Criteria** (what must be TRUE):
  1. A user can add a job by typing a file path in the UI, see it appear in the queue with QUEUED status, and watch it transition through named pipeline stages (FFV1 encode, scene detect, chunk split, audio transcode, chunk encode N/total, merge, mux, cleanup) in real time
  2. Per-chunk VMAF scores and final CRF values appear live in the UI as each chunk completes, without a page refresh
  3. A user can pause an active job, cancel it (with confirmation), and retry a failed job — all from the job list — and see the job state update immediately
  4. A user can expand the ffmpeg log panel for any job and read the full captured stderr output
  5. Estimated time remaining is displayed for active jobs and updates as chunk throughput data accumulates
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Subprocess Foundation | 0/? | Not started | - |
| 2. SQLite State Layer | 0/? | Not started | - |
| 3. Pipeline Runner | 0/? | Not started | - |
| 4. Web API + Scheduler | 0/? | Not started | - |
| 5. React UI | 0/? | Not started | - |
