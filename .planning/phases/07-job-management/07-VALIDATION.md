---
phase: 7
slug: job-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x + vitest (via vite.config.ts test config) |
| **Config file** | `pyproject.toml` [tool.pytest.ini_options], `vite.config.ts` test section |
| **Quick run command** | `cd C:/VibeCoding/video-encoder && python -m pytest tests/test_db.py -x -q` |
| **Full suite command** | `cd C:/VibeCoding/video-encoder && python -m pytest -v && cd frontend && npm test -- --run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/test_db.py -x -q`
- **After every plan wave:** Run `python -m pytest -v && cd frontend && npm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | JMGMT-01 | unit | `pytest tests/test_db.py::test_delete_job_cascades -x` | ❌ W0 | ⬜ pending |
| 7-01-02 | 01 | 1 | JMGMT-01 | integration | `pytest tests/test_api_delete.py -x` | ❌ W0 | ⬜ pending |
| 7-01-03 | 01 | 1 | JMGMT-02 | unit | `pytest tests/test_db.py::test_delete_jobs_by_status -x` | ❌ W0 | ⬜ pending |
| 7-01-04 | 01 | 1 | JMGMT-02 | integration | `pytest tests/test_api_delete.py::test_bulk_delete -x` | ❌ W0 | ⬜ pending |
| 7-01-05 | 01 | 1 | JMGMT-04 | unit | `pytest tests/test_db.py::test_auto_cleanup_jobs -x` | ❌ W0 | ⬜ pending |
| 7-01-06 | 01 | 1 | JMGMT-04 | unit | `pytest tests/test_db.py::test_auto_cleanup_disabled -x` | ❌ W0 | ⬜ pending |
| 7-02-01 | 02 | 2 | JMGMT-03 | manual | Visual verification — Queue tab shows QUEUED/RUNNING/PAUSED/RESUMING | N/A | ⬜ pending |
| 7-02-02 | 02 | 2 | JMGMT-03 | manual | Visual verification — History tab shows DONE/FAILED only | N/A | ⬜ pending |
| 7-02-03 | 02 | 2 | JMGMT-01 | manual | Visual verification — Delete dialog + row exits with animation | N/A | ⬜ pending |
| 7-02-04 | 02 | 2 | JMGMT-02 | manual | Visual verification — Bulk clear confirmation + count updates | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_db.py` — append new test functions: `test_delete_job_cascades`, `test_delete_job_not_found`, `test_delete_jobs_by_status`, `test_auto_cleanup_jobs`, `test_auto_cleanup_disabled`
- [ ] `tests/test_api_delete.py` — new file covering `DELETE /api/jobs/{id}` and `DELETE /api/jobs/bulk` integration tests

*Frontend tab/history tests are visual/manual — no automated test gap for JMGMT-03 UI rendering.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Queue tab shows only QUEUED/RUNNING/PAUSED/RESUMING jobs | JMGMT-03 | React component rendering, no vitest coverage | Encode a job, open Queue tab, verify active jobs visible; complete a job, verify it disappears from Queue |
| History tab shows only DONE/FAILED jobs | JMGMT-03 | React component rendering, no vitest coverage | Complete a job, switch to History tab, verify it appears; verify QUEUED jobs do not appear |
| Delete confirmation dialog opens on [Delete] click | JMGMT-01 | UI interaction flow | Click Delete on a DONE row, verify dialog shows filename, click Cancel, verify row intact |
| Delete removes row with exit animation | JMGMT-01 | Animation + async state | Click Delete on a DONE row, confirm, verify row animates out and disappears from History view |
| Bulk clear removes all rows of selected status | JMGMT-02 | UI interaction flow | With 3 DONE jobs, click "Clear completed", confirm, verify all 3 disappear |
| Auto-cleanup setting saves and persists | JMGMT-04 | Settings UI round-trip | Open Settings, change Auto-remove days to 1, save, reopen Settings, verify value is 1 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
