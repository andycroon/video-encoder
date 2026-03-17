---
phase: 08-ui-enhancements
plan: "01"
subsystem: frontend
tags: [recharts, vmaf-chart, crf-convergence, chunk-table, job-card]
dependency_graph:
  requires: []
  provides: [VmafChart, ChunkTable-passbar]
  affects: [JobCard]
tech_stack:
  added: [recharts]
  patterns: [recharts-LineChart, ReferenceArea-target-band, mini-progress-bar]
key_files:
  created:
    - frontend/src/components/VmafChart.tsx
  modified:
    - frontend/package.json
    - frontend/package-lock.json
    - frontend/src/components/ChunkTable.tsx
    - frontend/src/components/JobCard.tsx
    - frontend/src/components/ChunkTable.test.tsx
decisions:
  - "recharts formatter types widened (no explicit number cast) to satisfy strict TS generics"
  - "test uses getAllByText('1') not getByText('1') because chunk index column also shows '1'"
metrics:
  duration: "8 min"
  completed_date: "2026-03-17"
  tasks: 2
  files: 5
---

# Phase 8 Plan 1: VMAF Chart and CRF Convergence Bars Summary

**One-liner:** recharts LineChart with shaded VMAF target band plus colored mini progress bars showing CRF pass count per chunk.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Install recharts and create VmafChart component | a8c17fe | VmafChart.tsx, package.json, package-lock.json |
| 2 | Update ChunkTable Passes column and wire VmafChart into JobCard | daf8e74 | ChunkTable.tsx, JobCard.tsx, ChunkTable.test.tsx |

## What Was Built

**VmafChart.tsx** — recharts ResponsiveContainer (height 160) wrapping a LineChart with:
- ReferenceArea shading the vmafMin–vmafMax target window in `#4080ff20` (translucent blue)
- XAxis by chunk number, YAxis clamped to `[max(88, vmafMin-2), min(100, vmafMax+2)]` with ticks at vmafMin and vmafMax only
- Line in `#4080ff` with dot markers; Tooltip shows "Chunk N / XX.XX VMAF"
- Filters to chunks where `vmaf !== null`; returns null if no completed chunks (no render)
- Section heading "VMAF" matching sectionHead style from JobCard

**ChunkTable.tsx** — Passes column replaced with:
- 60px wide, 6px tall bar track with `rgba(255,255,255,0.08)` background
- Fill width = `(passes/10)*100%` capped at 100%, colored by passColor(): green (1 pass), amber (2-3), red (4+)
- Pass count number as mono text next to bar
- Old `#fcd34d` amber highlight removed

**JobCard.tsx** — VmafChart wired between two-column grid and LogPanel:
- `vmafMin`/`vmafMax` extracted from `job.config` with fallback defaults (96.2/97.6)
- VmafChart renders only when completed chunks exist (returns null otherwise, no gap in layout)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] recharts Tooltip formatter TypeScript types**
- **Found during:** Task 1 build
- **Issue:** recharts Tooltip `labelFormatter` and `formatter` props use generic `ReactNode` / `ValueType` — casting the argument to `number` in the signature caused TS2322 type incompatibility
- **Fix:** Removed explicit `number` type annotation from formatter parameters; used `typeof v === 'number'` guard for safe toFixed() call
- **Files modified:** frontend/src/components/VmafChart.tsx
- **Commit:** a8c17fe

**2. [Rule 1 - Bug] Test assertion used getByText('1') which matched two elements**
- **Found during:** Task 2 test run
- **Issue:** Chunk index column renders `chunkIndex + 1` = "1" at same time as pass count "1"; `getByText` throws "multiple elements" error
- **Fix:** Changed to `getAllByText('1').length > 0` assertion
- **Files modified:** frontend/src/components/ChunkTable.test.tsx
- **Commit:** daf8e74

## Verification

- `npm test -- --run`: 19/19 tests pass (7 test files)
- `npm run build`: exits 0 — TypeScript clean, Vite bundle produced
- VmafChart.tsx: `import type { ChunkData }`, `ReferenceArea fill="#4080ff20"`, `ResponsiveContainer height={160}`, `ticks={[vmafMin, vmafMax]}`, domain using `vmafMin - 2` / `vmafMax + 2`
- ChunkTable.tsx: `passColor()` present, `width: 60` / `height: 6` bar track, `Math.min((c.passes / 10) * 100, 100)` fill, no `#fcd34d`
- JobCard.tsx: `import VmafChart`, vmafMin/vmafMax from job.config, `<VmafChart` between grid and LogPanel

## Self-Check: PASSED
