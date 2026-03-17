# Phase 7: Job Management - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Backend and frontend work to let users delete individual jobs, bulk-clear terminal-state jobs, and browse completed work in a dedicated history view separate from the active queue. No new pipeline stages. Auto-cleanup removes old completed jobs on a configurable schedule.

</domain>

<decisions>
## Implementation Decisions

### History view layout
- Tab/toggle switcher with two views: **Queue** and **History**
- Switcher lives in a sub-navigation row below the top bar (path field + Add button stay in top bar, unchanged)
- Tab labels show counts: `Queue (3)   History (12)`
- Queue tab: QUEUED and RUNNING jobs only (existing JobList behavior, filtered)
- History tab: DONE and FAILED jobs only
- History is one-time fetch on tab open + manual refresh (no second poll loop — existing Zustand jobs array filtered by status)

### Bulk-action buttons
- "Clear completed" and "Clear failed" buttons appear in the sub-nav row, visible only when the History tab is active
- Both buttons show a confirmation dialog before executing: "Remove all N completed jobs? [Cancel] [Clear]"

### Individual delete
- [Delete] button appears on history rows (DONE and FAILED) only — not on active queue rows
- Clicking [Delete] opens a confirmation dialog: "Remove {filename}? [Cancel] [Delete]"
- On confirm: calls `DELETE /api/jobs/{id}` (the purge variant), removes the row from the UI

### Running job delete
- Delete button is NOT exposed on running or queued jobs in the UI
- Users cancel active jobs using the existing [Cancel] button (unchanged)
- Backend `DELETE /api/jobs/{id}` still supports cancel-then-delete internally (required by success criteria), but the UI never calls it for running jobs

### Auto-cleanup config
- New `auto_cleanup_days` setting (stored internally as `auto_cleanup_hours = days * 24`)
- UI label: "Auto-remove completed jobs after: [7] days" — displays in days, converts to hours internally
- Default: 7 days (168 hours)
- Set to 0 to disable
- Location: new **Retention** section at the bottom of SettingsModal
- Background task runs on a schedule to remove jobs older than the configured threshold

### Claude's Discretion
- Visual styling for the Queue/History tab switcher (pill toggle, underline tabs, etc.) — consistent with existing app aesthetic
- Exact confirmation dialog component (reuse existing modal pattern or inline popover)
- History row layout for DONE/FAILED rows (based on Phase 5 collapsed row spec: filename, status badge, avg VMAF, avg CRF, total duration, [Retry] [Delete])
- How to render [Clear completed] / [Clear failed] when count is 0 (disable vs hide)
- Background task schedule interval for auto-cleanup (e.g., every hour)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — JMGMT-01 (delete individual), JMGMT-02 (bulk-clear), JMGMT-03 (history view), JMGMT-04 (auto-cleanup); exact success criteria for each

### Roadmap
- `.planning/ROADMAP.md` §"Phase 7: Job Management" — Success criteria (5 items), plan outlines for 07-01, 07-02

### Prior phase context (established UI patterns)
- `.planning/phases/05-react-ui/05-CONTEXT.md` — Collapsed row spec for DONE jobs (filename, DONE badge, avg VMAF, avg CRF, total duration, [Retry]); layout and component patterns
- `.planning/phases/06-pipeline-reliability/06-CONTEXT.md` — `DELETE /api/jobs/{id}` currently cancels (not DB-deletes); existing StatusBadge, JobRow patterns

No external ADRs — requirements are fully captured above and in the files listed.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/components/JobRow.tsx` — existing collapsed row; add [Delete] button for history rows
- `frontend/src/components/JobList.tsx` — existing list; will split into queue-filtered view (Queue tab) and `HistoryList.tsx` (History tab)
- `frontend/src/components/StatusBadge.tsx` — already handles DONE, FAILED, RUNNING, QUEUED, RESUMING
- `frontend/src/components/SettingsModal.tsx` — add Retention section with auto-cleanup days input
- `frontend/src/store/jobsStore.ts` — Zustand store; filter `jobs` array by status for each tab (no second fetch)
- `src/encoder/db.py` — add `PRAGMA foreign_keys = ON` to `get_db()` + `delete_job()`, `delete_jobs_by_status()`, `auto_cleanup_jobs()` functions; add `auto_cleanup_hours` to `SETTINGS_DEFAULTS`

### Established Patterns
- `DELETE /api/jobs/{job_id}` currently calls `scheduler.cancel(job_id)` and returns `{"cancelled": job_id}` — needs to be extended to also delete from DB for terminal-state jobs, or a separate purge path added
- All DB access via aiosqlite — new delete functions follow same async pattern
- `PRAGMA foreign_keys = ON` must be added to `get_db()` so `DELETE FROM jobs` cascades to steps, chunks, logs
- Background tasks already exist (watch folder watcher) — auto-cleanup follows same startup/asyncio pattern

### Integration Points
- New `DELETE /api/jobs/bulk` endpoint in `main.py` — accepts `{ status: "DONE" | "FAILED" }` body, calls `delete_jobs_by_status()`
- `DELETE /api/jobs/{id}` extended: terminal-state jobs → DB delete; running/queued jobs → cancel (existing behavior preserved or routed separately)
- Frontend `api/jobs.ts` — add `deleteJob(id)` and `deleteJobsBulk(status)` API calls
- Tab state: simple React `useState` in App/JobList parent — `"queue" | "history"`, no router needed (single-page app)

</code_context>

<specifics>
## Specific Ideas

- Tab counts should be live (update as jobs complete/get deleted) — sourced from Zustand store length, not a separate count fetch
- History tab is a filtered read of the same Zustand array that the queue tab uses — single source of truth, no second poll
- Confirmation dialog for individual delete should show the filename so the user knows what they're removing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-job-management*
*Context gathered: 2026-03-17*
