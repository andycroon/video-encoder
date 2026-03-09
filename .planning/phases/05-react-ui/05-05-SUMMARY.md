---
phase: 05-react-ui
plan: "05"
subsystem: ui
tags: [react, typescript, tailwind, fastapi, sse, sqlite, vite, frontend-design]

requires:
  - phase: 05-03
    provides: TopBar, JobRow, JobList, CancelDialog, StatusBadge, JobCard components
  - phase: 05-04
    provides: useJobStream, StageList, ChunkTable, LogPanel wired into JobCard

provides:
  - Broadcast-precision dark UI aesthetic with cohesive color system and typography
  - File browser component (server-side, SVG icons, folder/file navigation modes)
  - Settings modal (output/temp/watch folder config with integrated folder picker)
  - Full ProfileModal with CRUD (create, rename, delete, select profiles)
  - /api prefix on all FastAPI routes with matching Vite proxy config
  - Real-time ffmpeg progress streaming to log panel via SSE for all pipeline stages
  - PySceneDetect tqdm progress captured via stderr redirect and surfaced in log
  - Human-friendly stage labels consistent across UI and pipeline backend
  - Stages and chunks persisted in DB REST response (survive page refresh)
  - Chunk counter, avg VMAF/CRF, passes column all functional
  - Log clears per stage with in-place progress line updates
  - Chunk table auto-scrolls to latest entry

affects:
  - 05-06 (ProfileModal form implementation, README Phase 5 section)

tech-stack:
  added: []
  patterns:
    - frontend-design skill: broadcast-precision industrial aesthetic for media tools
    - /api prefix routing: all FastAPI routes prefixed, Vite proxy points to /api
    - SSE log streaming: ffmpeg stderr piped through SSE log events to LogPanel
    - PySceneDetect stderr capture: tqdm output redirected and forwarded as SSE log events
    - DB-persisted UI state: stages and chunks in REST response, no SSE dependency for refresh

key-files:
  created:
    - frontend/src/components/FileBrowser.tsx
    - frontend/src/components/SettingsModal.tsx
  modified:
    - frontend/src/App.tsx
    - frontend/src/index.css
    - frontend/src/components/TopBar.tsx
    - frontend/src/components/StatusBadge.tsx
    - frontend/src/components/JobRow.tsx
    - frontend/src/components/JobCard.tsx
    - frontend/src/components/StageList.tsx
    - frontend/src/components/ChunkTable.tsx
    - frontend/src/components/LogPanel.tsx
    - frontend/src/components/CancelDialog.tsx
    - frontend/src/components/ProfileModal.tsx
    - encoder/main.py
    - encoder/pipeline.py

key-decisions:
  - "All FastAPI routes prefixed with /api — Vite proxy targets /api base path, no rewrite needed"
  - "Stages and chunks stored in DB returned in REST response — UI state survives page refresh without SSE"
  - "ffmpeg stderr forwarded unfiltered as SSE log events — client replaces progress lines in-place by matching tqdm/ffmpeg progress patterns"
  - "PySceneDetect tqdm captured via sys.stderr redirect inside run_in_executor — avoids blocking event loop"
  - "Human-friendly STAGE_LABELS dict shared between frontend JobRow and backend — single source of truth for display names"
  - "Chunk avg VMAF and avg CRF computed in ChunkTable from completed chunks — not stored separately in DB"

patterns-established:
  - "broadcast-precision aesthetic: neutral-950 base, blue-500 accent, amber-500 active indicator, generous whitespace"
  - "SVG inline icons: no icon library dependency, icons defined as components in FileBrowser"
  - "In-place log line replacement: LogPanel replaces last line matching progress regex instead of appending"
  - "Auto-scroll: ChunkTable scrolls to bottom ref on chunk list change"

requirements-completed:
  - QUEUE-01
  - QUEUE-02
  - QUEUE-03
  - QUEUE-04
  - PROG-01
  - PROG-02
  - PROG-03
  - PROG-04

duration: ~4h
completed: 2026-03-08
---

# Phase 5 Plan 05: Design Polish and UI Fixes Summary

**Full UI redesign via frontend-design skill (broadcast-precision aesthetic) with file browser, settings modal, full ProfileModal CRUD, /api routing fix, real-time ffmpeg/PySceneDetect progress streaming, and DB-persisted stage/chunk state that survives page refresh**

## Performance

- **Duration:** ~4 hours
- **Started:** 2026-03-08
- **Completed:** 2026-03-08
- **Tasks:** 1 auto task + approved human-verify checkpoint
- **Files modified:** 13+

## Accomplishments

- Complete UI redesign via frontend-design skill using broadcast-precision industrial aesthetic — neutral-950 base, blue-500 primary accent, amber-500 for active states, generous spacing, clear typographic hierarchy with monospace data values
- File browser (server-side directory listing, SVG icons, separate folder picker and file picker modes) and Settings modal with output/temp/watch folder config wired to GET/PUT /settings
- Full ProfileModal CRUD — create, rename, duplicate, delete, and select encoding profiles; /api prefix added to all FastAPI routes with Vite proxy updated to match
- Real-time ffmpeg progress streaming to LogPanel via SSE for all pipeline stages including audio transcode, concat, and mux; PySceneDetect tqdm progress captured via stderr redirect and forwarded as SSE log events
- Stage names fixed to match UI labels using shared STAGE_LABELS dict; stages and chunks persisted in DB and returned in REST response so UI survives page refresh without SSE dependency
- Chunk counter, avg VMAF/CRF display, passes column, in-place progress line replacement, and chunk table auto-scroll all functional

## Task Commits

The plan had one auto task and an approved checkpoint. Work was iterative with multiple fix commits:

- `b7c26b4` — fix: TS build errors, LogPanel style prop, erasableSyntaxOnly, vitest/config
- `5a2c70a` — fix: /api prefix on all routes, remove proxy rewrite, improve text contrast
- `01a3bbc` — feat: file browser, settings modal, full profile CRUD, fix all critical UX gaps
- `fc8b2f2` — fix: remove unused imports from TopBar.test.tsx
- `4433b4a` — fix: show Up button at drive root for drives list navigation
- `2209008` — fix: show .. folder entry in file list for navigating up
- `fb0b42b` — fix: folder picker shows only directories and selects current folder
- `b99fdaa` — design: full UI redesign via frontend-design skill — industrial precision aesthetic
- `7b819d2` — fix: text contrast — txt-2 #c4c4d4, txt-3 #8888a0
- `646b4ec` — fix: text contrast — txt-2 #d8d8e6, txt-3 #a8a8bc
- `5b405f9` — feat: stream ffmpeg progress lines to log panel via SSE log events
- `94a2ddf` — fix: stage names to match UI, preserve SSE state across polls, replace progress lines in log
- `da7dd58` — fix: stages from DB in REST response, human-friendly labels, log during all pipeline steps
- `d506634` — fix: chunk_progress/complete field names, emit chunk_progress, capture total_chunks from stage event
- `cc85336a` — feat: display avg VMAF and avg CRF in chunk section header
- `b6a00c6` — fix: shared STAGE_LABELS in JobRow — consistent human-friendly names
- `19804b1` — fix: time-based throttle + final line emit, ffmpeg progress for all steps
- `c85336a` — feat: capture PySceneDetect tqdm progress via stderr redirect and stream to log
- `d424f70` — fix: update passes column from chunk_complete iterations field
- `3b7cff1` — fix: clear log on stage change, in-place replacement for tqdm and ffmpeg progress lines
- `015dfab` — fix: chunk counter uses completed chunks count not stage entries
- `6259a5e` — fix: add ChunkEncode and Cleanup steps to DB so they tick off in the pipeline
- `2a92447` — fix: audio/copy progress in log, chunks in REST, auto-scroll table, fix log restore for running jobs
- `465dbbc` — fix: pass all ffmpeg stderr lines unfiltered, update test to match
- `b7b514b` — design: complete broadcast-precision UI redesign — generous spacing, clear hierarchy, SVG icons

## Files Created/Modified

- `frontend/src/App.tsx` — Final layout shell with header logo mark, TopBar, JobList, ProfileModal trigger
- `frontend/src/index.css` — Design tokens: CSS custom properties for accent/running/active colors, font stacks
- `frontend/src/components/TopBar.tsx` — File browser trigger, settings button, profile picker
- `frontend/src/components/StatusBadge.tsx` — Color-coded status badges (QUEUED/RUNNING/PAUSED/DONE/FAILED/CANCELLED)
- `frontend/src/components/JobRow.tsx` — Job list row with shared STAGE_LABELS for human-friendly stage names
- `frontend/src/components/JobCard.tsx` — Expanded card: stage list + chunk table + log panel layout
- `frontend/src/components/StageList.tsx` — Active stage pulsing amber dot indicator
- `frontend/src/components/ChunkTable.tsx` — Chunk rows with avg VMAF/CRF header, passes column, auto-scroll
- `frontend/src/components/LogPanel.tsx` — Terminal-feel panel, in-place progress line replacement
- `frontend/src/components/CancelDialog.tsx` — Confirmation dialog, behavior unchanged
- `frontend/src/components/ProfileModal.tsx` — Full CRUD: create, rename, duplicate, delete profiles
- `frontend/src/components/FileBrowser.tsx` — Server-side file browser with SVG icons, folder/file modes
- `frontend/src/components/SettingsModal.tsx` — Output/temp/watch folder config with folder picker integration
- `encoder/main.py` — /api prefix on all routes, file browser endpoints, SSE log event emission
- `encoder/pipeline.py` — PySceneDetect stderr capture, stage name constants, chunk/stage DB persistence

## Decisions Made

- All FastAPI routes prefixed with /api — cleaner separation; Vite proxy targets /api base, no rewrite rule needed
- Stages and chunks stored in DB and returned in REST response — UI state survives page refresh without SSE; SSE adds live updates on top
- ffmpeg stderr forwarded unfiltered as SSE log events — client does pattern matching to replace progress lines in-place rather than filtering server-side
- PySceneDetect tqdm captured via sys.stderr redirect inside run_in_executor — avoids blocking the asyncio event loop while still capturing tqdm output
- Human-friendly STAGE_LABELS dict defined once, shared between frontend JobRow and backend stage name mapping — single source of truth

## Deviations from Plan

The plan described one design task plus a checkpoint. The checkpoint review and subsequent user testing revealed significant gaps requiring additional work:

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] /api prefix routing**
- **Found during:** Task 1 (initial integration testing)
- **Issue:** Frontend API calls had no /api prefix; backend routes had no prefix; Vite proxy rewrite config was broken
- **Fix:** Added /api prefix to all FastAPI routes; updated Vite proxy; fixed all frontend API call paths
- **Files modified:** encoder/main.py, vite.config.ts, frontend API wrappers
- **Committed in:** 5a2c70a

**2. [Rule 2 - Missing Critical] File browser and settings modal**
- **Found during:** Checkpoint review
- **Issue:** No way to browse the server filesystem to pick input files or configure output/temp paths
- **Fix:** Built FileBrowser component with server-side directory listing and SettingsModal wired to GET/PUT /settings
- **Files modified:** frontend/src/components/FileBrowser.tsx (new), frontend/src/components/SettingsModal.tsx (new), encoder/main.py
- **Committed in:** 01a3bbc

**3. [Rule 1 - Bug] Stage names mismatch between pipeline and UI**
- **Found during:** Post-checkpoint fixes
- **Issue:** Pipeline emitted internal stage names (e.g., ffv1_encode) while UI expected human-friendly labels; stages ticked inconsistently
- **Fix:** STAGE_LABELS dict maps internal names to display strings; shared between frontend JobRow and backend
- **Files modified:** frontend/src/components/JobRow.tsx, encoder/main.py
- **Committed in:** b6a00c6, da7dd58

**4. [Rule 1 - Bug] Chunks and stages not in REST response**
- **Found during:** Post-checkpoint fixes
- **Issue:** Stage and chunk data was SSE-only; page refresh lost all progress state
- **Fix:** Added stages and chunks arrays to GET /jobs/:id response from DB
- **Files modified:** encoder/main.py, encoder/db.py
- **Committed in:** da7dd58, 2a92447

**5. [Rule 1 - Bug] ffmpeg progress not streaming for all stages**
- **Found during:** Post-checkpoint fixes
- **Issue:** Only chunk encode stage had ffmpeg log streaming; audio transcode, concat, and mux were silent in log panel
- **Fix:** Added SSE log event emission in all pipeline stages that run ffmpeg
- **Files modified:** encoder/pipeline.py, encoder/main.py
- **Committed in:** 5b405f9, 19804b1

**6. [Rule 2 - Missing Critical] PySceneDetect progress not captured**
- **Found during:** Post-checkpoint fixes
- **Issue:** PySceneDetect tqdm output went to stderr with no visibility during scene detection (longest stage)
- **Fix:** sys.stderr redirect inside run_in_executor captures tqdm lines and emits as SSE log events
- **Files modified:** encoder/pipeline.py
- **Committed in:** c85336a

---

**Total deviations:** 6 auto-fixed (2 missing critical, 4 bugs)
**Impact on plan:** All fixes were necessary for the UI to be genuinely usable. The initial design task completed correctly; the additional work arose from integration testing during and after the checkpoint.

## Issues Encountered

- Text contrast required two iterations to reach readable levels on neutral-950 background
- Chunk table auto-scroll required a bottom-ref pattern with useEffect dependency on chunks array
- In-place log line replacement required regex heuristics matching tqdm percent pattern and ffmpeg frame= pattern to avoid appending duplicate progress lines
- Drive-letter navigation on Windows required special handling in the file browser (listing drives at filesystem root)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05-06 can implement ProfileModal form fields (CRUD shell is in place, form inputs are stubbed)
- All visual and functional groundwork is complete — 05-06 adds form content to ProfileModal and writes README Phase 5 section
- No blockers for 05-06

---
*Phase: 05-react-ui*
*Completed: 2026-03-08*
