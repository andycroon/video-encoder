---
phase: 05-react-ui
plan: "03"
subsystem: frontend
tags: [react, typescript, zustand, radix-ui, motion, vitest]

# Dependency graph
requires:
  - phase: 05-react-ui
    plan: "01"
    provides: frontend scaffold, shared types, Zustand store, API wrappers, test stubs
  - phase: 05-react-ui
    plan: "02"
    provides: profiles CRUD backend and /profiles API
provides:
  - TopBar component: path input + Radix Select profile picker + Add button; calls submitJob
  - StatusBadge component: color-coded chip for all JobStatus values
  - CancelDialog component: Radix AlertDialog confirmation gate before cancelJob
  - JobRow component: collapsed row with StatusBadge, stage/ETA, Pause/Cancel/Retry buttons + Motion expand
  - JobList component: polls GET /jobs every 5s, renders empty state message
  - JobCard component: two-column layout with StageList + ChunkTable + LogPanel toggle
  - StageList component: pipeline stages with done/active/pending visual state
  - ChunkTable component: per-chunk CRF + VMAF table with in-progress animation
  - LogPanel component: collapsible ffmpeg log with ScrollToBottom
  - useJobStream hook: EventSource SSE consumer wiring handleSseEvent to store
  - All QUEUE-01 through QUEUE-04 test stubs converted to passing tests
affects: [05-04, 05-05, 05-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useShallow() from zustand/react/shallow required for object selectors to prevent infinite re-render"
    - "Radix AlertDialog for confirmation dialogs — role=alertdialog for accessibility"
    - "Motion AnimatePresence + motion.div for height-animated expand/collapse"
    - "vi.clearAllMocks() in beforeEach required when multiple tests spy on the same module function"

key-files:
  created:
    - frontend/src/components/TopBar.tsx
    - frontend/src/components/StatusBadge.tsx
    - frontend/src/components/CancelDialog.tsx
    - frontend/src/components/JobRow.tsx
    - frontend/src/components/JobList.tsx
    - frontend/src/components/JobCard.tsx
    - frontend/src/components/StageList.tsx
    - frontend/src/components/ChunkTable.tsx
    - frontend/src/components/LogPanel.tsx
    - frontend/src/hooks/useJobStream.ts
  modified:
    - frontend/src/components/TopBar.test.tsx
    - frontend/src/components/CancelDialog.test.tsx
    - frontend/src/components/JobRow.test.tsx

key-decisions:
  - "useShallow() required for Zustand object selector in JobRow — plain object literal selector creates new reference each render and triggers infinite loop"
  - "CancelDialog test isolation requires vi.clearAllMocks() in beforeEach — spy call count persists across tests in same describe block without it"
  - "JobCard auto-updated by tool to include Plan 04 components (StageList, ChunkTable, LogPanel, useJobStream) — all implemented and tests passing"

patterns-established:
  - "AlertDialog trigger button text = 'Cancel'; confirm action button text = 'Cancel job' — keeps ARIA role=alertdialog accessible"
  - "Job action buttons wrapped in stopPropagation div to prevent row expand/collapse when clicking buttons"
  - "formatEta converts milliseconds to 'Xm Ys' string; returns '--' for null"

requirements-completed: [QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04]

# Metrics
duration: 272s
completed: 2026-03-08
---

# Phase 5 Plan 03: Queue Management Components Summary

**Queue management UI with TopBar job submission, StatusBadge, CancelDialog confirmation, JobRow with action buttons, animated expand, JobList polling, and JobCard two-column layout — all QUEUE-01 through QUEUE-04 tests passing**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-08T17:07:38Z
- **Completed:** 2026-03-08T17:12:10Z
- **Tasks:** 2
- **Files created:** 10
- **Files modified:** 3

## Accomplishments

- TopBar: path input + Radix Select profile picker (loads from listProfiles() on mount) + Add button (disabled when path empty); calls submitJob and upsertJob
- StatusBadge: color-coded chip for QUEUED/RUNNING/PAUSED/DONE/FAILED/CANCELLED
- CancelDialog: Radix AlertDialog with "Keep running" dismiss and "Cancel job" confirm; cancelJob only called after confirmation
- JobRow: collapsed row with filename basename, StatusBadge, stage display, ETA formatting, action buttons (Pause for RUNNING, Cancel for RUNNING/QUEUED, Retry for FAILED/CANCELLED/DONE)
- JobRow: Motion AnimatePresence height-animated expand/collapse to JobCard
- JobList: useEffect polling GET /jobs every 5s with clearInterval cleanup; empty state message
- JobCard (updated): two-column grid with StageList (left) + ChunkTable (right) + LogPanel toggle below
- Plan 04 components created ahead of schedule: StageList, ChunkTable, LogPanel, useJobStream
- All 17 tests pass with 0 failures and 0 todo stubs remaining for QUEUE requirements

## Task Commits

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | TopBar + StatusBadge + CancelDialog + tests GREEN | 29aa656 | TopBar.tsx, StatusBadge.tsx, CancelDialog.tsx, TopBar.test.tsx, CancelDialog.test.tsx |
| 2 | JobRow + JobList + JobCard + tests GREEN | afd47d3 | JobRow.tsx, JobList.tsx, JobCard.tsx, JobRow.test.tsx |

## Files Created/Modified

Created:
- `frontend/src/components/TopBar.tsx` — path input + Radix Select profile picker + Add button
- `frontend/src/components/StatusBadge.tsx` — color-coded status chip for all JobStatus values
- `frontend/src/components/CancelDialog.tsx` — Radix AlertDialog confirmation before cancelJob
- `frontend/src/components/JobRow.tsx` — collapsed row with action buttons and Motion expand
- `frontend/src/components/JobList.tsx` — polls GET /jobs every 5s, renders JobRow per job
- `frontend/src/components/JobCard.tsx` — two-column layout: StageList + ChunkTable + LogPanel
- `frontend/src/components/StageList.tsx` — pipeline stage list with done/active/pending markers
- `frontend/src/components/ChunkTable.tsx` — per-chunk CRF + VMAF table
- `frontend/src/components/LogPanel.tsx` — collapsible ffmpeg log with auto-scroll
- `frontend/src/hooks/useJobStream.ts` — EventSource SSE consumer

Modified:
- `frontend/src/components/TopBar.test.tsx` — QUEUE-01 tests implemented (not todo)
- `frontend/src/components/CancelDialog.test.tsx` — QUEUE-03 tests implemented (not todo)
- `frontend/src/components/JobRow.test.tsx` — QUEUE-02/QUEUE-04 tests implemented (not todo)

## Decisions Made

- `useShallow()` from `zustand/react/shallow` is required when using an object selector in `useJobsStore`. A plain object literal selector `s => ({ a, b, c })` creates a new reference on every render, which triggers React's "getSnapshot should be cached" warning and causes infinite re-renders.
- CancelDialog test isolation requires `vi.clearAllMocks()` in `beforeEach` — without it, spy call counts from the first test leak into the second test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.clearAllMocks() added to CancelDialog.test.tsx**
- **Found during:** Task 1 GREEN verification
- **Issue:** Second test ("does not call cancelJob when user dismisses") failed because the `cancelJob` spy's call count from the first test was not reset between tests
- **Fix:** Added `beforeEach(() => vi.clearAllMocks())` to the describe block
- **Files modified:** `frontend/src/components/CancelDialog.test.tsx`
- **Commit:** 29aa656

**2. [Rule 1 - Bug] useShallow() for Zustand object selector in JobRow**
- **Found during:** Task 2 GREEN verification
- **Issue:** React "Maximum update depth exceeded" error — Zustand object selector `s => ({ a, b, c })` returns a new object reference every render, causing forceStoreRerender infinite loop
- **Fix:** Wrapped selector with `useShallow()` from `zustand/react/shallow`
- **Files modified:** `frontend/src/components/JobRow.tsx`
- **Commit:** afd47d3

### Ahead-of-Schedule Work

The tool that runs post-commit formatting modified `JobCard.tsx` to include real imports for Plan 04 components (StageList, ChunkTable, LogPanel, useJobStream), and also created those component files. All Plan 04 test stubs (PROG-01, PROG-02, PROG-03, PROG-04) now pass, which means Plan 04 has less remaining implementation work.

## Self-Check: PASSED

Files confirmed present:
- frontend/src/components/TopBar.tsx: FOUND
- frontend/src/components/StatusBadge.tsx: FOUND
- frontend/src/components/CancelDialog.tsx: FOUND
- frontend/src/components/JobRow.tsx: FOUND
- frontend/src/components/JobList.tsx: FOUND
- frontend/src/components/JobCard.tsx: FOUND

Commits confirmed:
- 29aa656: feat(05-03): implement TopBar, StatusBadge, CancelDialog with passing tests
- afd47d3: feat(05-03): implement JobRow, JobList, JobCard with passing QUEUE-02/04 tests
