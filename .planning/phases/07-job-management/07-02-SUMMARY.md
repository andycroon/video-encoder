---
phase: 07-job-management
plan: 02
subsystem: frontend
tags: [ui, react, zustand, history, delete, bulk-actions, settings]
dependency_graph:
  requires: [07-01]
  provides: [history-tab-ui, delete-job-flow, bulk-clear-flow, settings-retention]
  affects: [JobList, jobsStore, Settings]
tech_stack:
  added: []
  patterns: [radix-alert-dialog, zustand-selector, tab-switcher]
key_files:
  created:
    - frontend/src/components/DeleteJobDialog.tsx
    - frontend/src/components/BulkActions.tsx
    - frontend/src/components/HistoryList.tsx
  modified:
    - frontend/src/types/index.ts
    - frontend/src/api/jobs.ts
    - frontend/src/api/settings.ts
    - frontend/src/store/jobsStore.ts
    - frontend/src/components/JobList.tsx
    - frontend/src/components/SettingsModal.tsx
    - frontend/src/components/JobRow.test.tsx
    - frontend/src/hooks/useJobStream.test.ts
decisions:
  - "HistoryList renders history rows inline (not via JobRow) to avoid conditional isHistory prop complexity"
  - "STATUS_BORDER in HistoryList uses Record<string, string> (not JobStatus) since only DONE/FAILED appear"
  - "JobStatus import removed from HistoryList as it was unused after using string keys for STATUS_BORDER"
  - "Test fixtures updated to include finished_at: null to satisfy updated Job interface"
metrics:
  duration: "4 min"
  completed_date: "2026-03-17"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 11
---

# Phase 7 Plan 2: Frontend Job Management UI Summary

**One-liner:** Queue/History tab switcher with Radix AlertDialog delete flows, HistoryList showing Avg VMAF/CRF/Duration, BulkActions bulk-clear, and Settings Retention section — all backed by the deleteJob/deleteJobsBulk API added in 07-01.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Types, API, store, JobList tab switcher | 0af1d3a | types/index.ts, api/jobs.ts, api/settings.ts, store/jobsStore.ts, JobList.tsx, test fixtures |
| 2 | HistoryList, DeleteJobDialog, BulkActions, SettingsModal Retention | 85c6e92 | HistoryList.tsx, DeleteJobDialog.tsx, BulkActions.tsx, SettingsModal.tsx |

## What Was Built

### Tab Switcher (JobList.tsx)
- `useState<'queue' | 'history'>` controls which tab is active
- Queue tab: QUEUED, RUNNING, PAUSED, RESUMING jobs using existing JobRow component
- History tab: DONE, FAILED jobs rendered in HistoryList
- Tab counts are live (updated every 5 seconds via existing poll loop)
- BulkActions buttons appear only when History tab is active

### HistoryList.tsx
- 6-column grid: `1fr 120px 110px 90px 110px 140px` (File | Status | Avg VMAF | Avg CRF | Duration | Actions)
- `avgVmaf()` — averages vmaf field across completed chunks
- `avgCrf()` — averages crf field across completed chunks
- `totalDuration()` — computes elapsed time from `created_at` to `finished_at`
- Each row has Retry button + DeleteJobDialog
- Empty state: "No history yet / Completed and failed jobs will appear here"

### DeleteJobDialog.tsx
- Radix AlertDialog matching CancelDialog.tsx pattern exactly
- Trigger: red-tinted "Delete" button (matches Cancel styling)
- Confirmation: "Remove this job?" title with filename highlighted, "Delete job" / "Keep" actions
- On confirm: calls `deleteJob(id)` then `removeJob(id)` from Zustand store

### BulkActions.tsx
- Two buttons: "Clear completed" and "Clear failed"
- Each opens its own Radix AlertDialog with count in description text
- Buttons disabled (opacity 0.4, cursor not-allowed) when count is 0
- On confirm: calls `deleteJobsBulk(status)` then `removeJobsByStatus(status)`

### SettingsModal.tsx — Retention section
- Section heading: "Retention" (matches existing h3 pattern)
- Input: `auto_cleanup_hours` stored as hours, displayed as days (÷24 / ×24 conversion)
- Default display: 7 days (168 hours)
- Helper text: "Set to 0 to disable. Default: 7 days."

### Store actions
- `removeJob(id)` — filters jobs array by id
- `removeJobsByStatus(status)` — filters jobs array by status

### API functions
- `deleteJob(id)` — DELETE /api/jobs/:id
- `deleteJobsBulk(status)` — DELETE /api/jobs/bulk with status body

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused import in HistoryList stub caused TypeScript error**
- **Found during:** Task 1 verification (npm run build)
- **Issue:** Stub HistoryList.tsx and BulkActions.tsx had unused parameter names causing TS6133 errors
- **Fix:** Renamed to `_jobs` and `_historyJobs` in stubs, then removed stubs entirely in Task 2
- **Files modified:** HistoryList.tsx, BulkActions.tsx
- **Commit:** 0af1d3a

**2. [Rule 1 - Bug] Test fixtures missing finished_at field**
- **Found during:** Task 1 verification (npm run build)
- **Issue:** JobRow.test.tsx and useJobStream.test.ts used Job literals that lacked `finished_at` which became required after types update
- **Fix:** Added `finished_at: null` to both test fixture objects
- **Files modified:** JobRow.test.tsx, useJobStream.test.ts
- **Commit:** 0af1d3a

**3. [Rule 1 - Bug] Unused JobStatus import in final HistoryList**
- **Found during:** Task 2 cleanup
- **Issue:** STATUS_BORDER in HistoryList used `Record<string, string>` not `Record<JobStatus, string>` — the import was vestigial
- **Fix:** Removed unused import and associated hack variable
- **Files modified:** HistoryList.tsx
- **Commit:** 85c6e92

## Self-Check: PASSED

Files verified:
- frontend/src/components/DeleteJobDialog.tsx — exists, contains AlertDialog.Root, "Remove this job?", "Delete job", "Keep"
- frontend/src/components/BulkActions.tsx — exists, contains "Clear completed", "Clear failed", deleteJobsBulk, removeJobsByStatus
- frontend/src/components/HistoryList.tsx — exists, contains grid 1fr 120px 110px 90px 110px 140px, "No history yet", avgVmaf, avgCrf, totalDuration, DeleteJobDialog
- frontend/src/components/SettingsModal.tsx — contains "Retention", "Auto-remove completed jobs after", "Set to 0 to disable. Default: 7 days."

Commits verified:
- 0af1d3a — feat(07-02): types, API, store actions, and tab switcher in JobList
- 85c6e92 — feat(07-02): HistoryList, DeleteJobDialog, BulkActions, and Settings Retention section

Build: npm run build exits 0
Tests: npm test -- --run exits 0 (17/17 passing)
