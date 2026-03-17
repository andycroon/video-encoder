---
phase: 06-pipeline-reliability
plan: 01
subsystem: pipeline
tags: [vmaf, crf, x264, encoding, feedback-loop]

requires: []
provides:
  - "_encode_chunk_with_vmaf using vmaf_history list for oscillation-aware best-CRF selection"
  - "Midpoint selection: closest VMAF to window center wins, lower CRF tiebreak"
  - "Re-encode step fires when best entry was not the last file written to disk"
affects:
  - 06-pipeline-reliability plan 02 (resume)
  - 06-pipeline-reliability plan 03 (parallel encoding)

tech-stack:
  added: []
  patterns:
    - "vmaf_history list accumulates (crf, vmaf) pairs each iteration, replacing visited_crfs set"
    - "Oscillation check: detect CRF revisit AFTER encoding to capture the repeated score"
    - "Best selection via min(vmaf_history, key=lambda h: (abs(h[1]-center), h[0]))"

key-files:
  created: []
  modified:
    - src/encoder/pipeline.py
    - tests/test_pipeline.py

key-decisions:
  - "Oscillation is detected after encoding (not before), so the repeated CRF entry is recorded in history before breaking — this ensures all relevant candidates are available for best-selection"
  - "Lower CRF tiebreak (not higher) because lower CRF = higher bitrate = safer for perceptual quality"

patterns-established:
  - "CRF feedback loop: record history, break on convergence or oscillation, then pick winner by distance to center"

requirements-completed:
  - PIPE-V2-03

duration: 3min
completed: 2026-03-17
---

# Phase 6 Plan 01: CRF Oscillation Best-Selection Summary

**CRF oscillation resolution now selects the encode closest to the VMAF window center (lower CRF tiebreak), with automatic re-encode when the winner was not the last file written**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-17T09:59:51Z
- **Completed:** 2026-03-17T10:02:30Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 2

## Accomplishments

- Added two failing unit tests (RED) covering oscillation best-selection and re-encode behavior
- Replaced `visited_crfs: set[int]` with `vmaf_history: list[tuple[int, float]]` in `_encode_chunk_with_vmaf`
- Implemented midpoint selection: `min(vmaf_history, key=lambda h: (abs(h[1] - center), h[0]))`
- Re-encode fires when `best_crf != vmaf_history[-1][0]` so the output file always matches the selected CRF
- All 16 pipeline tests pass, zero regressions

## Task Commits

1. **Task 1: Add CRF oscillation unit tests (RED)** - `f3d786d` (test)
2. **Task 2: Replace visited_crfs with vmaf_history and midpoint selection (GREEN)** - `1e3fcb7` (feat)

## Files Created/Modified

- `src/encoder/pipeline.py` - `_encode_chunk_with_vmaf` rewritten with vmaf_history pattern
- `tests/test_pipeline.py` - Added `test_crf_oscillation_best_selection` and `test_crf_oscillation_reencodes_winner`

## Decisions Made

- Oscillation is checked AFTER encoding (not before advancing to next_crf). The repeated CRF must be recorded in history before breaking so it participates in the best-selection min(). The previous approach of checking `next_crf in tried` before encoding would exit with only 2 iterations instead of 3 for the canonical oscillation pattern.
- Lower CRF wins tiebreaks because it produces higher bitrate which is the safer choice for perceptual quality targets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Oscillation check timing required after-encode placement**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** Plan description implied `next_crf in tried` guard before advancing; this exits after 2 iterations for the oscillation scenario, so the third VMAF score is never seen and the test expects 4 total `_encode_chunk_x264` calls (3 loop + 1 re-encode) but only 2 fired
- **Fix:** Moved oscillation detection to after encoding: check `any(h[0] == crf for h in vmaf_history)` before appending the new entry, append unconditionally, then break if `already_tried`. Removed `next_crf in tried` pre-check.
- **Files modified:** src/encoder/pipeline.py
- **Verification:** All 4 CRF tests pass including `test_crf_oscillation_reencodes_winner`
- **Committed in:** 1e3fcb7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - logic bug in oscillation check placement)
**Impact on plan:** Fix was necessary to make the re-encode test work correctly. No scope creep.

## Issues Encountered

The plan's pseudo-code placed the oscillation guard before advancing CRF (`next_crf in tried`). This is logically equivalent for preventing infinite loops, but it exits one iteration too early for the 3-iteration test scenario. Moving the check to after encoding produces the expected 3-iteration history before stopping.

## Next Phase Readiness

- CRF feedback loop is correct and fully tested — ready for Plan 02 (resume) and Plan 03 (parallel encoding)
- No schema or API changes; this is entirely internal to `_encode_chunk_with_vmaf`

## Self-Check: PASSED

- src/encoder/pipeline.py — FOUND
- tests/test_pipeline.py — FOUND
- 06-01-SUMMARY.md — FOUND
- commit f3d786d — FOUND
- commit 1e3fcb7 — FOUND

---
*Phase: 06-pipeline-reliability*
*Completed: 2026-03-17*
