# Roadmap: VibeCoder Video Encoder

## Milestones

- ✅ **v1.0 MVP** - Phases 1-5 (shipped 2026-03-09)
- 🚧 **v1.1 Quality & Manageability** - Phases 6-8 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) - SHIPPED 2026-03-09</summary>

### Phase 1: Subprocess Foundation
**Goal**: Cross-platform ffmpeg and ffprobe subprocess execution is proven correct on Windows and Linux before any other code depends on it
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-10
**Success Criteria** (what must be TRUE):
  1. A single ffmpeg command runs successfully on both Windows and Linux via the subprocess wrapper, with structured progress output yielded to the caller
  2. A running ffmpeg encode can be cancelled gracefully (stdin 'q' then terminate) without killing the Python parent process on Windows
  3. The VMAF model path escaping utility produces a filter-string-safe path on both platforms, validated against a known Windows drive-letter path
  4. The subprocess wrapper raises a clear, typed error when ffmpeg exits non-zero, including the captured stderr content
  5. README.md exists with: system prerequisites (Python version, ffmpeg install, scenedetect install), VMAF model setup (assets/ directory), and how to run the app
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffold + TDD test specifications (RED state)
- [x] 01-02-PLAN.md — Implement ffmpeg.py wrapper (GREEN all four tests)
- [x] 01-03-PLAN.md — Write README.md Phase 1 prerequisites section

### Phase 2: SQLite State Layer
**Goal**: All job lifecycle state can be written and read durably, surviving application restarts, before the scheduler or API depend on it
**Depends on**: Phase 1
**Requirements**: QUEUE-05
**Success Criteria** (what must be TRUE):
  1. A job written to the database with state QUEUED survives a Python process restart and is readable with the same fields
  2. WAL mode is active on the database connection (verifiable via `PRAGMA journal_mode`)
  3. Jobs left in RUNNING state are detectable at startup via the heartbeat_at column, enabling recovery without data loss
  4. All step records, VMAF scores, CRF values, and ffmpeg log events are writable and queryable through the DB access layer
  5. README.md updated with: database file location, how job state persists, and how to reset/wipe the job database
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Install aiosqlite, write test_db.py specs (RED state), create db.py skeleton
- [x] 02-02-PLAN.md — Implement db.py (GREEN all 7 tests), update README.md with Phase 2 section

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
  6. README.md updated with: all pipeline configuration parameters (VMAF range, CRF bounds, audio codec options, full x264 preset parameter reference, output/temp path config)
**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md — Test scaffold (14 RED stubs) + pipeline.py skeleton + scenedetect dep
- [x] 03-02-PLAN.md — Implement steps 1-4: FFV1 encode, scene detect, chunk split, audio transcode (6 GREEN)
- [x] 03-03-PLAN.md — Implement steps 5-7: x264 encode, VMAF scoring, CRF feedback loop (11 GREEN)
- [x] 03-04-PLAN.md — Implement steps 8-10: concat, mux, cleanup + run_pipeline orchestrator + CLI + README

### Phase 4: Web API + Scheduler
**Goal**: All pipeline capabilities are accessible via HTTP — job submission, pause, cancel, retry, watch folder auto-enqueueing, SSE progress streaming, and global configuration — testable with curl and browser DevTools before the React UI exists
**Depends on**: Phase 3
**Requirements**: QUEUE-06, CONF-05, CONF-06, PROG-05
**Success Criteria** (what must be TRUE):
  1. A job submitted via POST /jobs with a valid file path is picked up by the scheduler and begins encoding; its SSE stream is visible in browser DevTools with named stage events
  2. Global defaults (VMAF range, CRF bounds, audio codec, output path, temp path) are readable and writable via the settings API and persist across restarts
  3. New MKV files dropped into the configured watch folder are automatically added to the job queue within a debounce window
  4. A pre-flight disk space check runs before a job starts and the API returns a warning response if available space is below 3x the source file size
  5. README.md updated with: how to start the server, API port/host config, watch folder configuration, and global defaults settings reference
**Plans**: 4 plans

Plans:
- [x] 04-01-PLAN.md — FastAPI scaffold + settings table (GET/PUT /settings)
- [x] 04-02-PLAN.md — Asyncio scheduler + job REST endpoints (POST/GET/PATCH/DELETE/retry)
- [x] 04-03-PLAN.md — SSE stream endpoint + disk preflight warning event
- [x] 04-04-PLAN.md — Watch folder background task + README Phase 4 section

### Phase 5: React UI
**Goal**: Every queue management action, progress indicator, and configuration option is accessible in the browser without any command-line interaction; README.md finalized as the complete reference
**Depends on**: Phase 4
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, PROG-01, PROG-02, PROG-03, PROG-04, DOC-01
**Success Criteria** (what must be TRUE):
  1. A user can add a job by typing a file path in the UI, see it appear in the queue with QUEUED status, and watch it transition through named pipeline stages (FFV1 encode, scene detect, chunk split, audio transcode, chunk encode N/total, merge, mux, cleanup) in real time
  2. Per-chunk VMAF scores and final CRF values appear live in the UI as each chunk completes, without a page refresh
  3. A user can pause an active job, cancel it (with confirmation), and retry a failed job — all from the job list — and see the job state update immediately
  4. A user can expand the ffmpeg log panel for any job and read the full captured stderr output
  5. Estimated time remaining is displayed for active jobs and updates as chunk throughput data accumulates
  6. README.md is complete: getting-started walkthrough, UI feature overview, troubleshooting section, and all sections from previous phases are accurate and up to date
**Plans**: 6 plans

Plans:
- [x] 05-01-PLAN.md — Vite scaffold + types + Zustand store + API wrappers + test stubs (Wave 1)
- [x] 05-02-PLAN.md — Backend /profiles CRUD + DB table + FastAPI static serving (Wave 1, parallel)
- [x] 05-03-PLAN.md — TopBar + JobRow + JobList + CancelDialog + StatusBadge + JobCard (Wave 2)
- [x] 05-04-PLAN.md — useJobStream + StageList + ChunkTable + LogPanel wired into JobCard (Wave 2, parallel)
- [x] 05-05-PLAN.md — frontend-design skill: visual polish pass on all components (Wave 3, has checkpoint)
- [x] 05-06-PLAN.md — ProfileModal + README Phase 5 section + final checkpoint (Wave 3, has checkpoint)

</details>

### v1.1 Quality & Manageability (In Progress)

**Milestone Goal:** Improve pipeline correctness and throughput (parallel encoding, crash resume, smart CRF), add job history management (delete, bulk-clear, history view, auto-cleanup), and polish the UI (VMAF chart, dark mode, CRF convergence indicator).

#### Phase 6: Pipeline Reliability
**Goal**: The encoding pipeline selects the correct quality target, survives application crashes, and saturates available CPU cores through parallel chunk encoding
**Depends on**: Phase 5
**Requirements**: PIPE-V2-01, PIPE-V2-02, PIPE-V2-03
**Success Criteria** (what must be TRUE):
  1. A chunk whose CRF feedback loop oscillates (e.g. bounces between CRF 17 and CRF 18) exits with the encode whose VMAF score is closest to the center of the configured window, not whichever encode the loop happened to terminate on
  2. A job that was RUNNING when the application crashed or was restarted resumes from its last fully completed pipeline step — steps already marked DONE in the database are skipped and not re-executed
  3. Chunks whose DB status was not DONE at crash time are re-encoded from scratch (their partially written output files are deleted before re-encode begins)
  4. With concurrency set to 2 or higher, multiple chunks encode simultaneously and wall-clock time for a multi-chunk job decreases measurably compared to serial encoding
  5. Cancelling a job with parallel chunks in flight signals all active ffmpeg processes; no orphaned ffmpeg processes remain after cancel completes
**Plans**: 3 plans

Plans:
- [ ] 06-01-PLAN.md — CRF oscillation fix: replace visited_crfs set with VMAF history list, select midpoint-closest encode on exit
- [ ] 06-02-PLAN.md — Job resume: add completed_steps gate to each pipeline step block; trust DB status not filesystem
- [ ] 06-03-PLAN.md — Parallel chunk encoding: inner ThreadPoolExecutor, asyncio.run_coroutine_threadsafe DB bridge, PRAGMA busy_timeout, cancel-all-workers handle list; max_parallel_chunks setting in SettingsModal

#### Phase 7: Job Management
**Goal**: Users can remove jobs they no longer need and find completed work in a dedicated history view without cluttering the active queue
**Depends on**: Phase 6
**Requirements**: JMGMT-01, JMGMT-02, JMGMT-03, JMGMT-04
**Success Criteria** (what must be TRUE):
  1. A user can delete a single completed or failed job from the history view; the job row and all associated steps, chunks, and logs are removed from the database
  2. A user can bulk-clear all completed jobs or all failed jobs with a single button click; the active queue (QUEUED and RUNNING jobs) is unaffected
  3. The UI shows a separate history view containing only terminal-state jobs (DONE and FAILED), keeping the active queue free of completed work
  4. Attempting to delete a currently RUNNING job cancels it first and waits for the pipeline to exit before removing the database row; no ffmpeg processes are left running after deletion
  5. When auto-cleanup is enabled (retention hours > 0 in settings), completed jobs older than the configured threshold are automatically removed without user action
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — Backend: PRAGMA foreign_keys, delete_job/delete_jobs_by_status/auto_cleanup_jobs in db.py, DELETE endpoints, AutoCleanup background task
- [x] 07-02-PLAN.md — Frontend: Queue/History tab switcher, HistoryList, DeleteJobDialog, BulkActions, SettingsModal Retention section

#### Phase 8: UI Enhancements
**Goal**: Completed jobs display visual quality evidence through a VMAF chart and CRF convergence indicators, and the interface supports a dark/light theme preference that persists across sessions
**Depends on**: Phase 7
**Requirements**: UI-V2-01, UI-V2-02, UI-V2-03
**Success Criteria** (what must be TRUE):
  1. Expanding a completed job in the history view reveals a line chart showing the final VMAF score for each chunk in encode order, with the configured VMAF target window rendered as a shaded reference band
  2. The chunk table for a completed job shows a re-encode count per chunk (how many CRF iterations were needed), with visual differentiation between chunks that converged immediately versus those that required multiple passes
  3. A theme toggle in the top bar switches between dark and light mode; the selected theme is saved to localStorage and applied on the next page load before first paint (no flash of wrong theme)
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md — VmafChart.tsx (recharts LineChart + ReferenceArea) + CRF convergence progress bar in ChunkTable + JobCard layout update
- [ ] 08-02-PLAN.md — useTheme hook + dark/dim CSS variable overrides + flash-prevention inline script + TopBar theme toggle button

#### Phase 9: Remote Access Auth
**Goal**: The web UI and all API endpoints are protected by JWT authentication so the app can be safely exposed over a network; credentials are stored as bcrypt hashes in the existing SQLite database with a first-run onboarding wizard and login page
**Depends on**: Phase 8
**Requirements**: UI-V2-04
**Success Criteria** (what must be TRUE):
  1. Accessing any `/api/*` endpoint without a valid JWT returns 401 with a `WWW-Authenticate: Bearer` header
  2. Accessing the frontend static files without a valid JWT returns 401 (no page rendered for unauthenticated users)
  3. When no user exists in the database, auth is disabled and the app behaves as before (local-only default); first-run shows an onboarding wizard to create credentials
  4. A browser shows a login page when a user exists but no valid JWT is stored; entering correct credentials grants full access for 30 days
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md — Backend: users table, bcrypt + JWT auth helpers, auth API routes (status/login/register), JWT middleware
- [ ] 09-02-PLAN.md — Frontend: authStore, auth API wrappers, 401 interceptor, LoginPage, OnboardingWizard, App.tsx routing, README auth section

#### Phase 10: File Browser
**Goal**: A dedicated Files tab provides full-featured file management with dual-panel directory navigation, file metadata display, multi-select move/copy between directories, inline rename, context menu actions, and Add to Queue integration
**Depends on**: Phase 9
**Requirements**: D-01 through D-19 (from CONTEXT.md decisions)
**Success Criteria** (what must be TRUE):
  1. A Files tab in the header switches between the encoder view and a full-width dual-panel file browser
  2. Each panel navigates directories independently with its own breadcrumb, showing file size and last-modified date for each file
  3. Users can select multiple files with checkboxes, then move or copy them to the other panel's directory with conflict detection (overwrite/skip/cancel)
  4. Right-click context menu on any file shows Rename, Move, Copy, and Add to Queue options
  5. Inline rename turns the filename into an editable input; Enter confirms, Escape cancels
  6. Add to Queue from context menu submits the file as a new encoding job using the default profile
**Plans**: 3 plans

Plans:
- [x] 10-01-PLAN.md — Backend: extend /api/browse with size+modified_at, add /api/files/rename, /api/files/move, /api/files/copy endpoints; frontend API types and functions
- [x] 10-02-PLAN.md — FileBrowser dual-panel component with navigation, file metadata, multi-select, move/copy action bar, conflict dialog; Files tab wiring in App.tsx
- [x] 10-03-PLAN.md — Context menu (Rename, Move, Copy, Add to Queue), inline rename with pencil icon, job submission integration; human verification checkpoint

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subprocess Foundation | v1.0 | 3/3 | Complete | 2026-03-07 |
| 2. SQLite State Layer | v1.0 | 2/2 | Complete | 2026-03-07 |
| 3. Pipeline Runner | v1.0 | 3/4 | In Progress | - |
| 4. Web API + Scheduler | v1.0 | 4/4 | Complete | 2026-03-08 |
| 5. React UI | v1.0 | 6/6 | Complete | 2026-03-09 |
| 6. Pipeline Reliability | v1.1 | 3/3 | Complete | 2026-03-17 |
| 7. Job Management | v1.1 | 2/2 | Complete | 2026-03-17 |
| 8. UI Enhancements | v1.1 | 2/2 | Complete | 2026-03-17 |
| 9. Remote Access Auth | v1.1 | 2/2 | Complete | 2026-03-18 |
| 10. File Browser | v1.1 | 3/3 | Complete    | 2026-03-22 |
