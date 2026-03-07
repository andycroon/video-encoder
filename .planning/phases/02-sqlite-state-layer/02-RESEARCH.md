# Phase 2: SQLite State Layer - Research

**Researched:** 2026-03-07
**Domain:** aiosqlite / SQLite WAL, schema design, async CRUD, stale-job recovery
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Log storage:**
- Plain text blob stored as a `log` TEXT column on the `jobs` table
- Format matches the existing PowerShell script: chunk VMAF pass/fail events, CRF adjustments, VMAF averages per chunk
- Log is appended per chunk as encoding progresses (not written all at once at job completion)
- Phase 3 calls a DB function after each chunk's VMAF loop to append the chunk result line
- Phase 5 reads and renders the log blob verbatim in a log panel

**Schema granularity:**
- Match the existing script's per-chunk tracking behavior
- `jobs` table — overall job lifecycle (status, source path, output path, config, log, timestamps, heartbeat_at)
- `chunks` table — one row per scene chunk per job: chunk_index, crf_used, vmaf_score, iterations, status, started_at, finished_at
- `steps` table — one row per named pipeline stage per job (FFV1 encode, scene detect, chunk split, audio transcode, chunk encode, merge, mux, cleanup): step_name, status, started_at, finished_at
- VMAF scores and final CRF values live on the `chunks` table rows

**Stale job recovery:**
- DB layer auto-resets stale RUNNING jobs to QUEUED on startup
- Detection criteria: status = RUNNING and heartbeat_at is older than a threshold (e.g., 60 seconds)
- Phase 2 exposes an `init_db()` or `recover_stale_jobs()` function that Phase 3/4 calls at startup

**Per-job config storage:**
- Single `config` TEXT column on `jobs` table storing a JSON object
- Contains: vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, x264_params (as a nested object or string)
- Phase 3 reads config as a Python dict; defaults applied at job creation time

**Async DB layer:**
- Use `aiosqlite` for async-ready DB access (consistent with stack decision)
- WAL mode enabled on every new connection (`PRAGMA journal_mode=WAL`)
- Phase 2 tests use `asyncio.run()` to test async functions

### Claude's Discretion

- Exact column names and types beyond what's listed above
- Index strategy (which columns to index for Phase 4 query patterns)
- Connection pool / context manager pattern
- Exact heartbeat threshold value

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUEUE-05 | Job state persists across application restarts (SQLite) | WAL mode (persistent on file), schema with all lifecycle fields, `init_db()` called at startup, stale-job recovery resets RUNNING→QUEUED, no in-memory state required |
</phase_requirements>

---

## Summary

Phase 2 delivers `src/encoder/db.py`: a pure data layer with schema creation, WAL mode setup, CRUD functions for the jobs/chunks/steps tables, heartbeat updates, log appending, and startup recovery of stale jobs. No scheduler, no web server — just durable state that Phase 3 reads and writes through a clean async API.

The core technology is `aiosqlite 0.22.1`, an asyncio bridge to the standard `sqlite3` module. It runs all SQLite operations on a per-connection background thread, keeping the asyncio event loop free. WAL mode is set by running `PRAGMA journal_mode=WAL` on first connection; it persists in the database file itself and need only be set once (but it is safe and recommended to set it on every connection open).

The three-table schema (`jobs`, `chunks`, `steps`) maps directly to the PowerShell script's mental model: one job per source file, one chunk row per scene split, one step row per named pipeline stage. The `jobs.log` TEXT column stores plain-text lines appended after each chunk's VMAF loop — exactly the `encodinglog.txt` format the original script produces.

**Primary recommendation:** Use `aiosqlite 0.22.1` with a single factory function (`get_db()`) as an async context manager that opens a connection, sets WAL mode + `synchronous=NORMAL` + `row_factory=sqlite3.Row`, then closes on exit. Keep connections short-lived (per-operation or per-request). Never hold a connection open across a long-running encode — call `update_heartbeat()` and `append_chunk_result()` by opening a fresh connection each time.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aiosqlite | 0.22.1 | Async SQLite access | Project stack decision; wraps stdlib sqlite3 with asyncio bridge via background thread |
| sqlite3 | stdlib (SQLite 3.50.4 bundled in Python 3.13) | Underlying driver | No install required; sqlite3.Row used as row_factory |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| json (stdlib) | — | Serialize/deserialize `jobs.config` JSON blob | At job creation and when Phase 3 reads config |
| datetime (stdlib) | — | Timestamp generation (ISO-8601 strings in UTC) | All `created_at`, `started_at`, `finished_at`, `heartbeat_at` columns |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| aiosqlite | SQLAlchemy async | Massive overkill for 3 tables; SQLAlchemy adds 100+ kB import cost and ORM complexity |
| aiosqlite | tortoise-orm | Same overkill concern; no benefit without relationships across processes |
| Plain sqlite3 in executor | aiosqlite | Already decided; aiosqlite is the cleaner approach for this stack |

**Installation:**
```bash
pip install "aiosqlite>=0.22,<0.23"
```

Add to `pyproject.toml` under `[project]` dependencies:
```toml
dependencies = ["aiosqlite>=0.22,<0.23"]
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/encoder/
├── __init__.py        # existing
├── ffmpeg.py          # Phase 1 (existing)
└── db.py              # Phase 2 — entire module lives here
tests/
├── test_ffmpeg.py     # existing
└── test_db.py         # Phase 2 tests — real SQLite, no mocking
```

### Pattern 1: Short-Lived Connection Context Manager

**What:** A factory function opens a connection, runs PRAGMAs, sets row_factory, yields the connection, then closes it. Every public function opens its own connection via this context manager.

**When to use:** All DB operations in Phase 2. Avoids connection state leaking across pipeline stages.

```python
# Source: aiosqlite docs + sqlite3 official docs
import sqlite3
import aiosqlite
from contextlib import asynccontextmanager

@asynccontextmanager
async def get_db(path: str):
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA synchronous=NORMAL")
        db.row_factory = sqlite3.Row
        yield db
```

### Pattern 2: Schema Creation (Idempotent)

**What:** `CREATE TABLE IF NOT EXISTS` — safe to call every startup.

```python
# Source: sqlite3 official docs pattern
async def init_db(path: str) -> None:
    async with get_db(path) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
                id         INTEGER PRIMARY KEY,
                status     TEXT    NOT NULL DEFAULT 'QUEUED',
                source_path TEXT   NOT NULL,
                output_path TEXT,
                config     TEXT    NOT NULL,
                log        TEXT    NOT NULL DEFAULT '',
                created_at TEXT    NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                heartbeat_at TEXT
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id          INTEGER PRIMARY KEY,
                job_id      INTEGER NOT NULL REFERENCES jobs(id),
                chunk_index INTEGER NOT NULL,
                status      TEXT    NOT NULL DEFAULT 'PENDING',
                crf_used    REAL,
                vmaf_score  REAL,
                iterations  INTEGER NOT NULL DEFAULT 0,
                started_at  TEXT,
                finished_at TEXT
            );
            CREATE TABLE IF NOT EXISTS steps (
                id          INTEGER PRIMARY KEY,
                job_id      INTEGER NOT NULL REFERENCES jobs(id),
                step_name   TEXT    NOT NULL,
                status      TEXT    NOT NULL DEFAULT 'PENDING',
                started_at  TEXT,
                finished_at TEXT
            );
        """)
        await db.commit()
```

### Pattern 3: Stale Job Recovery

**What:** On startup, after `init_db()`, reset any job whose `heartbeat_at` is older than threshold to QUEUED.

```python
# Source: Derived from Solid Queue patterns + official sqlite3 docs
import datetime

HEARTBEAT_STALE_SECONDS = 60

async def recover_stale_jobs(path: str) -> int:
    """Reset RUNNING jobs with stale heartbeat to QUEUED. Returns count reset."""
    threshold = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(seconds=HEARTBEAT_STALE_SECONDS)
    ).isoformat()
    async with get_db(path) as db:
        cursor = await db.execute(
            """UPDATE jobs SET status='QUEUED', started_at=NULL, heartbeat_at=NULL
               WHERE status='RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at < ?)""",
            (threshold,),
        )
        await db.commit()
        return cursor.rowcount
```

### Pattern 4: Log Append

**What:** Concatenate a new line to the TEXT blob in-database without reading first (uses SQLite string concatenation).

```python
# Source: sqlite3 official docs — string || concat operator
async def append_job_log(path: str, job_id: int, line: str) -> None:
    async with get_db(path) as db:
        await db.execute(
            "UPDATE jobs SET log = log || ? WHERE id = ?",
            (line + "\n", job_id),
        )
        await db.commit()
```

### Pattern 5: execute_insert for Last Row ID

**What:** aiosqlite provides `execute_insert()` as a shortcut that returns `lastrowid` directly.

```python
# Source: aiosqlite API docs
async def create_job(path: str, source_path: str, config: dict) -> int:
    import json, datetime
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    async with get_db(path) as db:
        row_id = await db.execute_insert(
            "INSERT INTO jobs (source_path, config, created_at) VALUES (?, ?, ?)",
            (source_path, json.dumps(config), now),
        )
        await db.commit()
        return row_id
```

### Pattern 6: Row Access by Column Name

**What:** With `row_factory = sqlite3.Row`, columns are accessible by name (`row["status"]`) and by index. `.keys()` gives column list. Use `dict(row)` to convert to a plain dict for JSON serialization.

```python
# Source: Python 3.13 sqlite3 docs
async def get_job(path: str, job_id: int) -> dict | None:
    async with get_db(path) as db:
        async with db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None
```

### Anti-Patterns to Avoid

- **Holding a connection open across a long ffmpeg encode:** SQLite has only one writer; a long-held connection blocks all other writes. Open, write, close.
- **Using `executescript()` inside a transaction:** `executescript()` commits any open transaction first — don't mix it with uncommitted DML.
- **Setting `isolation_level=None` without understanding autocommit:** In Python 3.12+ legacy mode (the aiosqlite default), `isolation_level` still controls implicit BEGIN; set it to `""` (empty string) or rely on explicit `commit()` calls. Do not mix implicit and explicit transaction management.
- **Storing timestamps as integers (Unix epoch):** Use ISO-8601 TEXT — it sorts lexicographically, is human-readable, and avoids timezone confusion. SQLite has no native datetime type.
- **AUTOINCREMENT keyword:** Do not add `AUTOINCREMENT` to `INTEGER PRIMARY KEY`; it adds overhead and prevents reuse of IDs after deletion without any benefit for this use case.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async SQLite access | asyncio.run_in_executor + sqlite3 calls | aiosqlite | aiosqlite's background thread model is safer and handles all the locking correctly |
| WAL mode persistence | Custom file-locking scheme | `PRAGMA journal_mode=WAL` | WAL persists in the database file after first set; nothing else needed |
| Row dict conversion | Manual `zip(columns, values)` | `sqlite3.Row` + `dict(row)` | row_factory handles this cleanly; `dict(row)` is a one-liner |
| Config serialization | Custom text format | `json.dumps` / `json.loads` on TEXT column | stdlib json, no additional dependency |
| Timestamp arithmetic for stale detection | Manual string parsing | ISO-8601 strings compare lexicographically in SQLite's `<` operator | Correct without any date parsing library |

**Key insight:** SQLite's stdlib integration in Python 3.13 (version 3.50.4) is mature and feature-complete. The only external dependency needed is aiosqlite for async access. Everything else — row factories, JSON blobs, WAL mode, heartbeat comparisons — uses stdlib or SQL builtins.

---

## Common Pitfalls

### Pitfall 1: WAL Mode Not Committed Correctly

**What goes wrong:** PRAGMA is issued but the connection closes before the WAL mode is written; subsequent connections still see DELETE mode.
**Why it happens:** `PRAGMA journal_mode=WAL` is not a DML statement — it doesn't need a `commit()` — but some developers add `await db.commit()` after it and some don't. The PRAGMA itself is auto-effective.
**How to avoid:** Issue `PRAGMA journal_mode=WAL` immediately after opening, before any DML. No explicit `commit()` needed for PRAGMAs.
**Warning signs:** `PRAGMA journal_mode` query returns `"delete"` instead of `"wal"` on an existing database.

### Pitfall 2: executescript() Commits Implicit Transactions

**What goes wrong:** `executescript()` silently commits any open transaction before running the script, causing partial writes to be persisted unexpectedly.
**Why it happens:** It's a SQLite-level behavior documented in Python's sqlite3 docs: executescript always issues a COMMIT before running.
**How to avoid:** Use `executescript()` only in `init_db()` where no prior transaction is open. For all other multi-statement operations, use separate `execute()` calls inside one `async with db:` block (connection context manager auto-commits on success).
**Warning signs:** Data appears committed even after code that should have rolled back.

### Pitfall 3: aiosqlite 0.22.x Breaking Change — Connection No Longer a Thread

**What goes wrong:** Code that called `.start()` or `super().__init__()` on an `aiosqlite.Connection` object (from pre-0.22 usage) raises `AttributeError`.
**Why it happens:** `aiosqlite 0.22.0` removed `threading.Thread` inheritance from `Connection`. This is the version being used.
**How to avoid:** Always use `async with aiosqlite.connect(path) as db:` or `await db.close()` — never call thread methods on the connection object. This is already the correct pattern.
**Warning signs:** Any existing aiosqlite code referencing `.daemon`, `.run()`, `.start()` on the connection object.

### Pitfall 4: Row Factory Not Inherited by Default on Cursors

**What goes wrong:** Setting `db.row_factory = sqlite3.Row` on the connection works for `db.execute()` shortcut, but if a cursor is created with `cursor = await db.cursor()` first, the cursor may not inherit the factory in all aiosqlite versions.
**Why it happens:** aiosqlite's cursor proxy may not forward `row_factory` from the parent connection in all code paths.
**How to avoid:** Always use `db.execute(...)` directly (the connection-level shortcut) rather than `await db.cursor()` + `cursor.execute()`. Or explicitly set `cursor.row_factory = sqlite3.Row` on each cursor.
**Warning signs:** `cursor.fetchone()` returns a tuple instead of a sqlite3.Row object.

### Pitfall 5: Stale Recovery Threshold Too Short

**What goes wrong:** A legitimately running job has its heartbeat missed during a heavy encoding phase (CPU-saturated), is incorrectly reset to QUEUED, and starts encoding again from scratch.
**Why it happens:** Phase 3 must call `update_heartbeat()` at a reliable cadence — if the encode loop is CPU-bound and Python's GIL causes delays, a 10-second threshold could false-positive.
**How to avoid:** Use 60 seconds as the stale threshold (decided in CONTEXT.md). Phase 3 must update the heartbeat at least every 10–15 seconds during active encoding (e.g., after each ffmpeg progress event batch).
**Warning signs:** Jobs that were running appear as QUEUED after a restart even though they weren't crashed.

### Pitfall 6: WAL File Growth on Long Encodes

**What goes wrong:** SQLite's WAL file grows unbounded during a long encoding job (many writes, no checkpoint), degrading read performance.
**Why it happens:** WAL auto-checkpoint triggers at 1000 pages by default; heavy write bursts can outpace it.
**How to avoid:** For Phase 2 (data layer only), no action needed — the write volume is low (one row per chunk completion). Note for Phase 3/4: if write volume increases, add `PRAGMA wal_autocheckpoint=100` to `get_db()`.
**Warning signs:** `.db-wal` file exceeds 10 MB during normal operation.

---

## Code Examples

Verified patterns from official sources:

### WAL Mode + synchronous=NORMAL Setup

```python
# Source: https://sqlite.org/wal.html + https://sqlite.org/pragma.html
async with aiosqlite.connect("encoder.db") as db:
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA synchronous=NORMAL")
    db.row_factory = sqlite3.Row
```

`synchronous=NORMAL` in WAL mode: transactions are atomic and consistent (ACID-compliant for crashes), but a power loss at the OS level could lose the last committed WAL frame. Acceptable risk for an encoding queue — worst case is a stale-job recovery at restart.

### Verify WAL Mode (for tests)

```python
# Source: sqlite3 official docs — PRAGMA journal_mode returns the active mode
async with get_db(path) as db:
    async with db.execute("PRAGMA journal_mode") as cursor:
        row = await cursor.fetchone()
        assert row[0] == "wal"
```

### Timestamp Pattern (ISO-8601 UTC)

```python
# Source: Python 3.13 datetime docs
import datetime

def utcnow() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
```

### List Jobs by Status

```python
# Source: aiosqlite docs — async for over cursor
async def list_jobs(path: str, status: str | None = None) -> list[dict]:
    async with get_db(path) as db:
        if status:
            async with db.execute(
                "SELECT * FROM jobs WHERE status = ? ORDER BY created_at", (status,)
            ) as cursor:
                return [dict(row) async for row in cursor]
        else:
            async with db.execute(
                "SELECT * FROM jobs ORDER BY created_at"
            ) as cursor:
                return [dict(row) async for row in cursor]
```

### Update Heartbeat

```python
async def update_heartbeat(path: str, job_id: int) -> None:
    async with get_db(path) as db:
        await db.execute(
            "UPDATE jobs SET heartbeat_at = ? WHERE id = ?",
            (utcnow(), job_id),
        )
        await db.commit()
```

### Test Pattern (asyncio.run)

```python
# Source: Established pattern from Phase 1 — no pytest-asyncio needed
import asyncio

def test_job_survives_restart(tmp_path):
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())
        # Simulate restart: open a new connection
        result = await get_job(db_path, job_id)
        assert result["status"] == "QUEUED"
        assert result["source_path"] == "/source/video.mkv"

    asyncio.run(_run())
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `aiosqlite.Connection` inherited `threading.Thread` | Connection is a standalone object, not a Thread | aiosqlite 0.22.0 (2024) | Must use context manager or explicit `.close()` — `.start()` / `.daemon` no longer available |
| `isolation_level` for transaction control | `autocommit` parameter (Python 3.12+) | Python 3.12 | aiosqlite still uses legacy transaction control internally; use explicit `commit()` / `rollback()` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INTEGER PRIMARY KEY` (no AUTOINCREMENT) | Long-standing SQLite best practice | Avoids sqlite_sequence table overhead; IDs still increment monotonically in normal usage |

**Deprecated/outdated:**
- `connection.stop()`: New in aiosqlite 0.22.1 (sync version of close) — only needed when you cannot use async context. Prefer `async with` everywhere in Phase 2.
- `isolation_level=None` to get autocommit: Deprecated in Python 3.12 in favor of `autocommit=True`. Do not use; stick to explicit `commit()` calls.

---

## Open Questions

1. **Database file location**
   - What we know: Project uses `D:\Videos\` for data directories; source layout is `src/encoder/`
   - What's unclear: Where exactly the `encoder.db` file should live (next to the source? in a configurable data dir?)
   - Recommendation: Default to a configurable path (e.g., `DB_PATH` constant at module top, or passed as parameter to all functions). Phase 4 will expose this as a setting. For Phase 2 tests, use `tmp_path` (pytest fixture).

2. **Index strategy for Phase 4 query patterns**
   - What we know: Phase 4 will query jobs by status (scheduler), and chunks by job_id (progress display)
   - What's unclear: Whether a single-index on `jobs(status)` is sufficient or whether a covering index is needed
   - Recommendation: Add `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)` and `CREATE INDEX IF NOT EXISTS idx_chunks_job_id ON chunks(job_id)` in `init_db()`. These are low-cost for the row counts involved and eliminate full-table scans.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 8.x (already installed, `pyproject.toml` dev dependency) |
| Config file | `pyproject.toml` — `[tool.pytest.ini_options]` section (existing) |
| Quick run command | `pytest tests/test_db.py -v` |
| Full suite command | `pytest tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-05 | Job written as QUEUED survives Python process restart (new connection) | integration | `pytest tests/test_db.py::test_job_survives_restart -x` | ❌ Wave 0 |
| QUEUE-05 | `PRAGMA journal_mode` returns `"wal"` on new connection | integration | `pytest tests/test_db.py::test_wal_mode_active -x` | ❌ Wave 0 |
| QUEUE-05 | RUNNING job with stale heartbeat reset to QUEUED on `recover_stale_jobs()` | integration | `pytest tests/test_db.py::test_stale_job_recovery -x` | ❌ Wave 0 |
| QUEUE-05 | Chunk rows (crf_used, vmaf_score, iterations) writable and queryable | integration | `pytest tests/test_db.py::test_chunk_crud -x` | ❌ Wave 0 |
| QUEUE-05 | Step rows writable and queryable by job_id and step_name | integration | `pytest tests/test_db.py::test_step_crud -x` | ❌ Wave 0 |
| QUEUE-05 | Log append concatenates lines in order | integration | `pytest tests/test_db.py::test_log_append -x` | ❌ Wave 0 |
| QUEUE-05 | Config JSON round-trips correctly (store dict, retrieve identical dict) | integration | `pytest tests/test_db.py::test_config_roundtrip -x` | ❌ Wave 0 |

All tests: real SQLite with `tmp_path` (pytest built-in fixture), `asyncio.run()` for async helpers, no mocking — consistent with Phase 1 no-mock philosophy.

### Sampling Rate

- **Per task commit:** `pytest tests/test_db.py -v`
- **Per wave merge:** `pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/test_db.py` — covers all QUEUE-05 behaviors above
- [ ] `src/encoder/db.py` — module itself (this is the deliverable, Wave 0 creates skeleton + test stubs)

*(No missing framework installs — pytest already present. Only `aiosqlite` needs adding to `pyproject.toml` dependencies and installing.)*

---

## Sources

### Primary (HIGH confidence)

- aiosqlite 0.22.1 docs: https://aiosqlite.omnilib.dev/en/stable/api.html — connection API, execute_insert, context managers
- aiosqlite changelog: https://aiosqlite.omnilib.dev/en/stable/changelog.html — v0.22.0 breaking change (no more Thread inheritance), v0.22.1 sync stop()
- Python 3.13 sqlite3 docs: https://docs.python.org/3/library/sqlite3.html — row_factory, sqlite3.Row, autocommit, executescript behavior
- SQLite WAL docs: https://sqlite.org/wal.html — WAL persistence, synchronous=NORMAL safety, checkpoint behavior
- SQLite PRAGMA docs: https://sqlite.org/pragma.html — journal_mode, synchronous, wal_autocheckpoint

### Secondary (MEDIUM confidence)

- Simon Willison's WAL TIL: https://til.simonwillison.net/sqlite/enabling-wal-mode — confirms WAL is file-level persistent
- Solid Queue heartbeat patterns: https://github.com/rails/solid_queue — 60s process_heartbeat_interval, 5min alive threshold industry reference

### Tertiary (LOW confidence)

- phiresky SQLite performance tuning: https://phiresky.github.io/blog/2020/sqlite-performance-tuning/ — WAL file growth notes (pre-dates SQLite 3.50 improvements)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — aiosqlite 0.22.1 is the latest stable release (December 2025); verified via PyPI and official changelog
- Architecture: HIGH — patterns derived from official aiosqlite and Python sqlite3 docs; schema directly specified in CONTEXT.md
- Pitfalls: HIGH for WAL/executescript/0.22.x breaking change (official docs); MEDIUM for WAL file growth (documented but unlikely at this write volume)

**Research date:** 2026-03-07
**Valid until:** 2026-06-07 (aiosqlite is stable; SQLite stdlib is frozen in Python 3.13)
