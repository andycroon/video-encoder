---
phase: 10-file-browser-with-directory-browsing-file-rename-move-and-copy
plan: 03
subsystem: ui
tags: [react, typescript, file-browser, context-menu, inline-rename, zustand]

# Dependency graph
requires:
  - phase: 10-02
    provides: "Dual-panel FileBrowser with move/copy action bar and conflict dialog"
provides:
  - "Context menu on file rows with Rename, Move to, Copy to, Add to Queue"
  - "Inline rename with Enter to confirm and Escape to cancel"
  - "Pencil icon on row hover triggers context menu for rename"
  - "Add to Queue submits job using default encoding profile"
affects:
  - phase 10 verification, future file management features

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Context menu state: { x, y, entry } in parent, closed by document click listener in useEffect"
    - "Inline rename: renamingPath/renameValue state lifted to FileBrowser parent, passed to FilePanel as props"
    - "Pencil icon: opacity 0/1 toggled via hoveredRow state, pointerEvents none when hidden"

key-files:
  created: []
  modified:
    - frontend/src/components/FileBrowser.tsx

key-decisions:
  - "Rename state lifted to FileBrowser parent so both panels share the same rename lifecycle without cross-panel confusion"
  - "Pencil icon click opens context menu at icon position (reuses context menu flow) rather than invoking startRename directly — one interaction model"
  - "Context Move/Copy determines destination as the OTHER panel's current path using string prefix check"

patterns-established:
  - "Individual Zustand selectors: useJobsStore(s => s.upsertJob) — never object selector"
  - "type-only imports: import type { BrowseEntry } — verbatimModuleSyntax compliance"

requirements-completed: [D-14, D-15, D-16, D-17, D-18, D-19]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 10 Plan 03: Context Menu, Inline Rename, and Add to Queue Summary

**Right-click context menu with Rename/Move/Copy/Add-to-Queue, Enter/Escape inline rename, pencil icon on hover, and job submission from the file browser.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T08:53:37Z
- **Completed:** 2026-03-22T08:56:09Z
- **Tasks:** 1 of 2 (paused at human-verify checkpoint)
- **Files modified:** 1

## Accomplishments

- Added right-click context menu on all file rows in both panels with Rename, Move to, Copy to, and Add to Queue options
- Implemented inline filename editing: Enter confirms rename via /api/files/rename, Escape cancels without API call
- Pencil icon appears on row hover and opens the context menu at the icon position
- Add to Queue finds the default encoding profile and calls submitJob, upserts result into Zustand store
- Context Move/Copy sends the single file to the other panel's current directory (reuses existing conflict resolution flow)

## Task Commits

1. **Task 1: Add context menu and inline rename to FileBrowser** - `f7957b4` (feat)

## Files Created/Modified

- `frontend/src/components/FileBrowser.tsx` - Added context menu, inline rename, pencil icon, add-to-queue; FilePanel now receives rename state as props from parent

## Decisions Made

- Rename state (`renamingPath`, `renameValue`) lifted to FileBrowser parent — both panels share it but only one file renames at a time; avoids duplicate state
- Pencil icon click triggers `onContextMenu` handler (same as right-click) rather than calling `startRename` directly — single interaction model, menu appears at icon position
- Context Move/Copy uses string prefix to determine which panel the file belongs to, then picks the other panel's path as destination

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three plans of Phase 10 implemented
- Human verification checkpoint pending: user must confirm full file browser works end-to-end
- After approval, Phase 10 is complete and STATE.md can be marked done

---
*Phase: 10-file-browser-with-directory-browsing-file-rename-move-and-copy*
*Completed: 2026-03-22*
