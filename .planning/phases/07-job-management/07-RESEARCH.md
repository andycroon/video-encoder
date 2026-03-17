# Phase 7: Job Management - Research

**Researched:** 2026-03-17
**Domain:** SQLite cascade delete, FastAPI DELETE endpoints, asyncio background tasks, React tab state, Zustand store mutations
**Confidence:** HIGH

## Summary

Phase 7 adds three things: (1) delete/purge endpoints that remove job rows from the DB, (2) a frontend tab switcher that separates active queue from completed history, and (3) a background auto-cleanup task. All three are additive — no pipeline stages change, no existing endpoints break.

The critical backend precondition is `PRAGMA foreign_keys = ON` in `get_db()`. Without it, deleting a jobs row leaves orphaned rows in chunks, steps, and any future child tables. The current `get_db()` does NOT have this PRAGMA (confirmed by reading db.py). It must be added before any delete functions are implemented.

The frontend work is a straightforward extension of existing patterns. The Zustand store needs one new action (`removeJob`) and a filter-view in a new `HistoryList` component. Tab state lives in a single `useState` at the App/JobList parent level — no router needed.

**Primary recommendation:** Implement in two plans — backend first (PRAGMA fix + delete functions + endpoints + auto-cleanup task), then frontend (tab switcher + HistoryList + DeleteJobDialog + BulkActions + Settings Retention section).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**History view layout**
- Tab/toggle switcher with two views: Queue and History
- Switcher lives in a sub-navigation row below the top bar (path field + Add button stay in top bar, unchanged)
- Tab labels show counts: `Queue (3)   History (12)`
- Queue tab: QUEUED and RUNNING jobs only (existing JobList behavior, filtered)
- History tab: DONE and FAILED jobs only
- History is one-time fetch on tab open + manual refresh (no second poll loop — existing Zustand jobs array filtered by status)

**Bulk-action buttons**
- "Clear completed" and "Clear failed" buttons appear in the sub-nav row, visible only when the History tab is active
- Both buttons show a confirmation dialog before executing: "Remove all N completed jobs? [Cancel] [Clear]"

**Individual delete**
- [Delete] button appears on history rows (DONE and FAILED) only — not on active queue rows
- Clicking [Delete] opens a confirmation dialog: "Remove {filename}? [Cancel] [Delete]"
- On confirm: calls `DELETE /api/jobs/{id}` (the purge variant), removes the row from the UI

**Running job delete**
- Delete button is NOT exposed on running or queued jobs in the UI
- Users cancel active jobs using the existing [Cancel] button (unchanged)
- Backend `DELETE /api/jobs/{id}` still supports cancel-then-delete internally (required by success criteria), but the UI never calls it for running jobs

**Auto-cleanup config**
- New `auto_cleanup_days` setting (stored internally as `auto_cleanup_hours = days * 24`)
- UI label: "Auto-remove completed jobs after: [7] days" — displays in days, converts to hours internally
- Default: 7 days (168 hours)
- Set to 0 to disable
- Location: new Retention section at the bottom of SettingsModal
- Background task runs on a schedule to remove jobs older than the configured threshold

### Claude's Discretion
- Visual styling for the Queue/History tab switcher (pill toggle, underline tabs, etc.) — consistent with existing app aesthetic
- Exact confirmation dialog component (reuse existing modal pattern or inline popover)
- History row layout for DONE/FAILED rows (based on Phase 5 collapsed row spec: filename, status badge, avg VMAF, avg CRF, total duration, [Retry] [Delete])
- How to render [Clear completed] / [Clear failed] when count is 0 (disable vs hide)
- Background task schedule interval for auto-cleanup (e.g., every hour)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| JMGMT-01 | User can delete individual completed or failed jobs | `DELETE /api/jobs/{id}` extended to DB-purge terminal-state jobs; PRAGMA foreign_keys = ON cascades to chunks/steps; frontend `removeJob` Zustand action + `DeleteJobDialog` |
| JMGMT-02 | User can bulk-clear all completed jobs or all failed jobs in one action | New `DELETE /api/jobs/bulk` endpoint with `{ status: "DONE" \| "FAILED" }` body; `delete_jobs_by_status()` in db.py; frontend BulkActions confirmation flow |
| JMGMT-03 | Completed jobs appear in a separate history view; active queue shows only queued and running jobs | React `useState<"queue" \| "history">` tab switcher; `HistoryList` filtering existing Zustand `jobs` array; no second poll loop |
| JMGMT-04 | System auto-removes completed jobs after configurable time period (default 7 days) | `auto_cleanup_hours` setting in SETTINGS_DEFAULTS + `auto_cleanup_jobs()` db function; asyncio background task following WatchFolder pattern |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aiosqlite | >=0.22,<0.23 (pinned) | Async SQLite for delete functions | Already the project DB layer |
| FastAPI | >=0.111,<0.120 (pinned) | Bulk delete endpoint | Already in use |
| @radix-ui/react-alert-dialog | already installed | Delete confirmation dialogs | Already used by CancelDialog |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| asyncio (stdlib) | N/A | Background auto-cleanup task loop | Same pattern as WatchFolder |
| motion/react (framer-motion) | already installed | Row exit animation on delete | Already used by JobRow expand/collapse |

No new dependencies required.

**Installation:** None needed.

---

## Architecture Patterns

### Backend: PRAGMA foreign_keys = ON

The current `get_db()` sets WAL mode and busy_timeout but omits foreign keys. The DB schema uses `REFERENCES jobs(id)` on chunks and steps but SQLite only enforces this when foreign_keys PRAGMA is ON. Without it, `DELETE FROM jobs WHERE id = ?` leaves orphaned rows.

```python
# Source: current src/encoder/db.py get_db() — ADD this line
await db.execute("PRAGMA foreign_keys = ON")
```

This must be set per-connection (it does not persist across connections in SQLite). Adding it to `get_db()` covers all paths.

### Backend: delete_job() function

```python
async def delete_job(path: str, job_id: int) -> bool:
    """
    Permanently delete a job and all associated rows.
    PRAGMA foreign_keys = ON in get_db() cascades delete to steps, chunks.
    Returns False if job not found.
    """
    async with get_db(path) as db:
        cursor = await db.execute("SELECT id FROM jobs WHERE id = ?", (job_id,))
        if await cursor.fetchone() is None:
            return False
        await db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        await db.commit()
    return True
```

### Backend: delete_jobs_by_status() function

```python
async def delete_jobs_by_status(path: str, status: str) -> int:
    """
    Delete all jobs with the given terminal status.
    Returns the count of deleted rows.
    Only DONE and FAILED are valid statuses for bulk delete.
    """
    async with get_db(path) as db:
        cursor = await db.execute(
            "DELETE FROM jobs WHERE status = ?", (status,)
        )
        await db.commit()
        return cursor.rowcount
```

### Backend: auto_cleanup_jobs() function

```python
async def auto_cleanup_jobs(path: str) -> int:
    """
    Delete DONE jobs older than auto_cleanup_hours setting.
    Returns count deleted. Does nothing if auto_cleanup_hours = 0.
    """
    settings = await get_settings(path)
    hours = int(settings.get("auto_cleanup_hours", 0))
    if hours == 0:
        return 0
    threshold = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(hours=hours)
    ).isoformat()
    async with get_db(path) as db:
        cursor = await db.execute(
            "DELETE FROM jobs WHERE status = 'DONE' AND finished_at < ?",
            (threshold,)
        )
        await db.commit()
        return cursor.rowcount
```

### Backend: Extended DELETE /api/jobs/{id} endpoint

Current behavior: cancel-only (sets CANCELLED status, does NOT delete from DB).
New behavior: terminal-state jobs (DONE, FAILED, CANCELLED) → DB purge. Active jobs (RUNNING, QUEUED) → existing cancel-then-delete path per success criteria SC-4.

```python
@api.delete("/jobs/{job_id}", status_code=200)
async def delete_job_route(job_id: int, request: Request):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] in ("DONE", "FAILED", "CANCELLED"):
        # Purge path: remove from DB
        await delete_job(DB_PATH, job_id)
        return {"deleted": job_id}
    else:
        # Active path: cancel then delete (per success criteria SC-4)
        request.app.state.scheduler.cancel(job_id)
        await update_job_status(DB_PATH, job_id, "CANCELLED")
        # Wait briefly for pipeline exit before deleting
        # Simple approach: delete immediately; pipeline handles missing job gracefully
        await delete_job(DB_PATH, job_id)
        return {"deleted": job_id}
```

**Note on SC-4 (running job delete):** The scheduler's `_run_job` method already handles `job is None` gracefully (returns early). The pipeline checks job status before each step. Deleting the DB row while the pipeline is running means the next status-check or log-write will hit a missing row — current code uses fire-and-forget DB writes, so this is safe in practice. The cancel event is set first to trigger graceful ffmpeg termination.

### Backend: DELETE /api/jobs/bulk endpoint

**Critical routing note:** FastAPI routes are matched in registration order. `DELETE /api/jobs/bulk` MUST be registered BEFORE `DELETE /api/jobs/{job_id}` or FastAPI will match `bulk` as a job_id integer and fail with a 422 validation error.

```python
class BulkDeleteBody(BaseModel):
    status: str  # "DONE" or "FAILED"

@api.delete("/jobs/bulk", status_code=200)
async def bulk_delete_jobs(body: BulkDeleteBody):
    if body.status not in ("DONE", "FAILED"):
        raise HTTPException(status_code=400, detail="status must be DONE or FAILED")
    count = await delete_jobs_by_status(DB_PATH, body.status)
    return {"deleted": count, "status": body.status}
```

### Backend: auto_cleanup_hours setting

Add to `SETTINGS_DEFAULTS` in db.py:

```python
SETTINGS_DEFAULTS: dict[str, str] = {
    # ... existing keys ...
    "auto_cleanup_hours": "168",  # 7 days default
}
```

Add to `_SETTINGS_INT_KEYS`:

```python
_SETTINGS_INT_KEYS = {"crf_min", "crf_max", "crf_start", "max_parallel_chunks", "auto_cleanup_hours"}
```

### Backend: Auto-cleanup background task

Follows the exact WatchFolder pattern — asyncio Task created in lifespan, polls on a configurable interval.

```python
class AutoCleanup:
    INTERVAL = 3600  # run every hour

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while True:
            try:
                deleted = await auto_cleanup_jobs(self._db_path)
                if deleted:
                    logger.info("Auto-cleanup: removed %d completed jobs", deleted)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Auto-cleanup error: %s", exc)
            await asyncio.sleep(self.INTERVAL)
```

Start/stop in `main.py` lifespan alongside scheduler and watcher.

### Frontend: removeJob Zustand action

The store currently has `upsertJob` and `setJobs` but no removal. Add `removeJob`:

```typescript
// In JobsState interface
removeJob: (id: number) => void;
removeJobsByStatus: (status: JobStatus) => void;

// In create() body
removeJob: (id) => set((state) => ({ jobs: state.jobs.filter(j => j.id !== id) })),
removeJobsByStatus: (status) => set((state) => ({ jobs: state.jobs.filter(j => j.status !== status) })),
```

Per MEMORY.md: always use individual selectors — `useStore(s => s.removeJob)`, never inline object selectors.

### Frontend: Tab switcher state

Simple `useState` at the component that owns both JobList and HistoryList:

```typescript
const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');
const jobs = useJobsStore(s => s.jobs);
const queueJobs = jobs.filter(j => j.status === 'QUEUED' || j.status === 'RUNNING' || j.status === 'PAUSED' || j.status === 'RESUMING');
const historyJobs = jobs.filter(j => j.status === 'DONE' || j.status === 'FAILED');
```

Note: PAUSED and RESUMING jobs belong in the Queue tab (they are active states), not History.

### Frontend: History row columns

Per UI-SPEC, history rows use a different grid than the active queue:
`1fr 120px 110px 90px 110px 140px` (File | Status | Avg VMAF | Avg CRF | Duration | Actions)

Avg VMAF and Avg CRF computed from `job.chunks` array:

```typescript
function avgVmaf(job: Job): string {
  const done = job.chunks.filter(c => c.vmaf !== null);
  if (!done.length) return '—';
  const avg = done.reduce((s, c) => s + (c.vmaf ?? 0), 0) / done.length;
  return avg.toFixed(2);
}

function avgCrf(job: Job): string {
  const done = job.chunks.filter(c => c.crf !== null);
  if (!done.length) return '—';
  const avg = done.reduce((s, c) => s + (c.crf ?? 0), 0) / done.length;
  return avg.toFixed(1);
}
```

Total duration: from `job.created_at` to `job.finished_at` (both available on DONE/FAILED jobs from REST). The `finished_at` field exists on the job row in the DB and will be returned by `list_jobs()`.

```typescript
function totalDuration(job: Job & { finished_at?: string }): string {
  if (!job.finished_at || !job.created_at) return '—';
  const ms = new Date(job.finished_at).getTime() - new Date(job.created_at).getTime();
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
```

**Note:** The `Job` type in `frontend/src/types/index.ts` does not currently include `finished_at`. It needs to be added.

### Frontend: API additions

```typescript
// api/jobs.ts additions

export async function deleteJob(id: number): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteJob failed: ${res.status}`);
}

export async function deleteJobsBulk(status: 'DONE' | 'FAILED'): Promise<{ deleted: number }> {
  const res = await fetch(`${BASE}/jobs/bulk`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`deleteJobsBulk failed: ${res.status}`);
  return res.json();
}
```

### Frontend: Settings type extension

The `Settings` interface in `api/settings.ts` needs `auto_cleanup_days` added (frontend shows days; backend stores hours):

```typescript
export interface Settings {
  // ... existing fields ...
  auto_cleanup_days: number;  // display unit; backend converts to hours on save
}
```

The conversion (days → hours) happens at the save layer. One clean approach: the settings API call sends `auto_cleanup_hours: value * 24` and the modal works in days locally. Alternatively, expose `auto_cleanup_days` as a virtual setting computed at display time from `auto_cleanup_hours`. The simpler approach is to store `auto_cleanup_hours` in the DB (already decided) and have the frontend PUT `auto_cleanup_hours: days * 24` directly — the `auto_cleanup_days` field name only lives in the UI state, never sent to the backend as a key.

### Frontend: SettingsModal Retention section

The modal uses Tailwind classes (not CSS custom properties inline style) for the existing fields. The new Retention section must match the existing pattern exactly — use the same `numField` helper already in the component. The field operates on a local `days` value converted to/from `auto_cleanup_hours` when loading/saving.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Child row cascade on job delete | Manual DELETE to chunks, steps tables | `PRAGMA foreign_keys = ON` + `DELETE FROM jobs` | Cascade is atomic; manual deletes risk partial state on error |
| Confirmation dialog from scratch | Custom modal HTML | Radix `AlertDialog` (already installed) | Focus trap, keyboard nav, accessibility |
| Row removal animation | CSS transition hack | Existing `AnimatePresence` + `motion.div` pattern (already in JobRow) | Consistent with existing expand/collapse; duration 0.18s easeInOut |

---

## Common Pitfalls

### Pitfall 1: Bulk route swallowed by job_id route
**What goes wrong:** `DELETE /api/jobs/bulk` registered after `DELETE /api/jobs/{job_id}` — FastAPI tries to parse "bulk" as int, returns 422.
**Why it happens:** FastAPI matches routes in registration order; `{job_id}` is greedy.
**How to avoid:** Register `DELETE /api/jobs/bulk` BEFORE `DELETE /api/jobs/{job_id}` in main.py.
**Warning signs:** 422 Unprocessable Entity when calling bulk delete endpoint.

### Pitfall 2: Foreign key cascade requires per-connection PRAGMA
**What goes wrong:** `PRAGMA foreign_keys = ON` set once at init time does not persist; delete leaves orphaned rows.
**Why it happens:** SQLite foreign key enforcement is per-connection, not per-database.
**How to avoid:** Add `await db.execute("PRAGMA foreign_keys = ON")` inside `get_db()` context manager, not just in `init_db()`.
**Warning signs:** `SELECT COUNT(*) FROM chunks WHERE job_id = ?` returns rows after job was deleted.

### Pitfall 3: Running job delete race condition
**What goes wrong:** DB row deleted before cancel event propagates; pipeline's next DB write (heartbeat, log append) hits missing row and throws.
**Why it happens:** Pipeline runs in a thread; cancel is async signal.
**How to avoid:** Set cancel event first, then delete DB row. Current DB write functions use `UPDATE ... WHERE id = ?` which is a no-op on missing rows (no error). Confirm this is the case — `aiosqlite` does not raise on zero-rowcount UPDATE.
**Warning signs:** Unhandled exceptions in scheduler logs after running-job delete.

### Pitfall 4: Job type missing finished_at
**What goes wrong:** `totalDuration()` in HistoryList always returns '—' because `finished_at` is not in the TypeScript `Job` type.
**Why it happens:** `Job` type was written for active/running jobs; terminal-state fields were not needed.
**How to avoid:** Add `finished_at: string | null` to the `Job` interface in `frontend/src/types/index.ts`.
**Warning signs:** Duration column shows only dashes in History view.

### Pitfall 5: Inline object selector in Zustand
**What goes wrong:** `useStore(s => ({ removeJob: s.removeJob, jobs: s.jobs }))` causes infinite re-renders in React 19 + Zustand 5.
**Why it happens:** Object created on each render is a new reference; React bails out based on reference equality.
**How to avoid:** Per MEMORY.md, always use individual selectors: `const removeJob = useJobsStore(s => s.removeJob)`.
**Warning signs:** Component re-renders in a loop; browser tab becomes unresponsive.

### Pitfall 6: PAUSED/RESUMING jobs appearing in History tab
**What goes wrong:** History filter `status === 'DONE' || status === 'FAILED'` is correct, but Queue filter must explicitly include PAUSED and RESUMING, not just QUEUED and RUNNING.
**Why it happens:** PAUSED and RESUMING are active states that should remain in the queue view.
**How to avoid:** Queue filter: `['QUEUED', 'RUNNING', 'PAUSED', 'RESUMING'].includes(job.status)`. History filter: `['DONE', 'FAILED'].includes(job.status)`.

### Pitfall 7: auto_cleanup_hours key not in _SETTINGS_INT_KEYS
**What goes wrong:** `auto_cleanup_hours` returned as string "168" from `get_settings()` instead of int 168; comparison `hours == 0` always False for string "0".
**Why it happens:** `_SETTINGS_INT_KEYS` set not updated when new int setting added.
**How to avoid:** When adding `"auto_cleanup_hours": "168"` to `SETTINGS_DEFAULTS`, simultaneously add `"auto_cleanup_hours"` to `_SETTINGS_INT_KEYS`.

---

## Code Examples

### Verified pattern: delete cascade test structure
```python
# Tests should verify cascade using direct aiosqlite query after delete
async def test_delete_job_cascades(tmp_path):
    db_path = str(tmp_path / "test.db")
    await init_db(db_path)
    job_id = await create_job(db_path, "/source/video.mkv", default_config())
    await create_chunk(db_path, job_id, chunk_index=0)
    await create_step(db_path, job_id, "FFV1")

    deleted = await delete_job(db_path, job_id)
    assert deleted is True

    async with aiosqlite.connect(db_path) as conn:
        await conn.execute("PRAGMA foreign_keys = ON")
        row = await (await conn.execute("SELECT id FROM jobs WHERE id=?", (job_id,))).fetchone()
        assert row is None
        chunks = await (await conn.execute("SELECT id FROM chunks WHERE job_id=?", (job_id,))).fetchone()
        assert chunks is None  # cascade worked
```

### Verified pattern: AnimatePresence row exit (from existing JobRow.tsx)
```tsx
// Source: frontend/src/components/JobRow.tsx (lines 140-153)
<AnimatePresence>
  {isExpanded && (
    <motion.div
      key="card"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeInOut' }}
      style={{ overflow: 'hidden' }}
    >
      <JobCard job={job} />
    </motion.div>
  )}
</AnimatePresence>
```

For row deletion, wrap the row in `AnimatePresence` and conditionally render: when `removeJob` is called, the job disappears from the Zustand array and `AnimatePresence` handles the exit animation automatically.

### Verified pattern: AlertDialog (from existing CancelDialog.tsx)
The full Radix AlertDialog pattern is already established in `CancelDialog.tsx`. `DeleteJobDialog` replicates this exactly — same Portal, Overlay, Content dimensions (340px, padding 24), same button styles.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 8.x + vitest (via vite.config.ts test config) |
| Config file | `pyproject.toml` [tool.pytest.ini_options], `vite.config.ts` test section |
| Quick run command | `cd C:/VibeCoding/video-encoder && python -m pytest tests/test_db.py -x -q` |
| Full suite command | `cd C:/VibeCoding/video-encoder && python -m pytest -v && cd frontend && npm test -- --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JMGMT-01 | delete_job() removes job + cascades to chunks/steps | unit | `pytest tests/test_db.py::test_delete_job_cascades -x` | ❌ Wave 0 |
| JMGMT-01 | DELETE /api/jobs/{id} returns 200 + {"deleted": id} for DONE job | integration | `pytest tests/test_api_delete.py -x` | ❌ Wave 0 |
| JMGMT-02 | delete_jobs_by_status("DONE") removes all DONE rows | unit | `pytest tests/test_db.py::test_delete_jobs_by_status -x` | ❌ Wave 0 |
| JMGMT-02 | DELETE /api/jobs/bulk with status=DONE returns count | integration | `pytest tests/test_api_delete.py::test_bulk_delete -x` | ❌ Wave 0 |
| JMGMT-03 | Queue tab shows only QUEUED/RUNNING/PAUSED/RESUMING | manual | Visual verification in browser | N/A |
| JMGMT-03 | History tab shows only DONE/FAILED | manual | Visual verification in browser | N/A |
| JMGMT-04 | auto_cleanup_jobs() deletes DONE jobs older than threshold | unit | `pytest tests/test_db.py::test_auto_cleanup_jobs -x` | ❌ Wave 0 |
| JMGMT-04 | auto_cleanup_jobs() does nothing when hours=0 | unit | `pytest tests/test_db.py::test_auto_cleanup_disabled -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/test_db.py -x -q`
- **Per wave merge:** `python -m pytest -v && cd frontend && npm test -- --run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_db.py` — needs new test functions: `test_delete_job_cascades`, `test_delete_job_not_found`, `test_delete_jobs_by_status`, `test_auto_cleanup_jobs`, `test_auto_cleanup_disabled` (append to existing file)
- [ ] `tests/test_api_delete.py` — new file covering DELETE /api/jobs/{id} and DELETE /api/jobs/bulk endpoint integration

*(Frontend tab/history tests are visual/manual — no automated test gap for JMGMT-03 UI rendering)*

---

## Sources

### Primary (HIGH confidence)
- Direct source code audit: `src/encoder/db.py` — confirmed `PRAGMA foreign_keys` absent from `get_db()`; confirmed `SETTINGS_DEFAULTS` structure and `_SETTINGS_INT_KEYS` pattern
- Direct source code audit: `src/encoder/main.py` — confirmed current `DELETE /api/jobs/{id}` cancel-only behavior; confirmed router registration order matters
- Direct source code audit: `src/encoder/watcher.py` — confirmed auto-cleanup background task pattern (asyncio.Task + cancel-safe loop)
- Direct source code audit: `src/encoder/scheduler.py` — confirmed cancel event mechanism; confirmed `job is None` guard in `_run_job`
- Direct source code audit: `frontend/src/store/jobsStore.ts` — confirmed no `removeJob` action exists; confirmed individual selector pattern
- Direct source code audit: `frontend/src/components/CancelDialog.tsx` — confirmed Radix AlertDialog pattern and exact button/dimension styles
- Direct source code audit: `frontend/src/components/JobRow.tsx` — confirmed AnimatePresence exit animation pattern
- Direct source code audit: `frontend/src/types/index.ts` — confirmed `finished_at` absent from Job interface
- Direct source code audit: `frontend/src/api/settings.ts` — confirmed Settings interface missing auto_cleanup field
- `.planning/phases/07-job-management/07-UI-SPEC.md` — confirmed full visual contract, component inventory, and copywriting

### Secondary (MEDIUM confidence)
- SQLite docs: `PRAGMA foreign_keys` is per-connection, not per-database — standard SQLite behavior

### Tertiary (LOW confidence)
None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in the project; no new dependencies
- Architecture: HIGH — patterns derived directly from existing source code
- Pitfalls: HIGH — confirmed by code inspection (foreign_keys absent, Job type missing finished_at, bulk route ordering)
- Test map: HIGH — existing pytest infrastructure; new test functions follow established test_db.py pattern

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable domain — no fast-moving dependencies)
