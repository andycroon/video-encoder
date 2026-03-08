"""
SQLite state layer for the video encoder.

Public API — Phase 3 (Pipeline Runner) imports these functions.
All functions are async and use aiosqlite.
"""

from __future__ import annotations

import datetime
import json
import sqlite3
from contextlib import asynccontextmanager
from typing import AsyncIterator

import aiosqlite

# Number of seconds without a heartbeat before a RUNNING job is considered stale
HEARTBEAT_STALE_SECONDS = 60

# Default values for the settings table (all stored as TEXT in SQLite)
SETTINGS_DEFAULTS: dict[str, str] = {
    "vmaf_min": "96.2",
    "vmaf_max": "97.6",
    "crf_min": "16",
    "crf_max": "20",
    "crf_start": "17",
    "audio_codec": "eac3",
    "output_path": "",
    "temp_path": "",
    "watch_folder_path": "",
}

# Type coercion map: keys whose values should not stay as strings
_SETTINGS_FLOAT_KEYS = {"vmaf_min", "vmaf_max"}
_SETTINGS_INT_KEYS = {"crf_min", "crf_max", "crf_start"}


def _utcnow() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


@asynccontextmanager
async def get_db(path: str) -> AsyncIterator:
    """Async context manager yielding an aiosqlite connection with WAL mode enabled."""
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA synchronous=NORMAL")
        db.row_factory = sqlite3.Row
        yield db


async def init_db(path: str) -> None:
    """Create all tables and enable WAL mode. Safe to call repeatedly (CREATE IF NOT EXISTS)."""
    async with get_db(path) as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id           INTEGER PRIMARY KEY,
                status       TEXT    NOT NULL DEFAULT 'QUEUED',
                source_path  TEXT    NOT NULL,
                output_path  TEXT,
                config       TEXT    NOT NULL,
                log          TEXT    NOT NULL DEFAULT '',
                created_at   TEXT    NOT NULL,
                started_at   TEXT,
                finished_at  TEXT,
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
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
            CREATE INDEX IF NOT EXISTS idx_chunks_job_id ON chunks(job_id);
            CREATE TABLE IF NOT EXISTS seen_files (
                path  TEXT NOT NULL,
                mtime REAL NOT NULL,
                PRIMARY KEY (path, mtime)
            );
            """
        )
        # Seed defaults — INSERT OR IGNORE keeps existing user values intact
        await db.executemany(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            list(SETTINGS_DEFAULTS.items()),
        )
        await db.commit()


def _coerce_setting(key: str, value: str):
    """Coerce a settings string value to the appropriate Python type."""
    if key in _SETTINGS_FLOAT_KEYS:
        return float(value)
    if key in _SETTINGS_INT_KEYS:
        return int(value)
    return value


async def get_settings(path: str) -> dict:
    """
    Return all settings as a dict with native Python types.

    Numeric keys (vmaf_min, vmaf_max, crf_min, crf_max, crf_start) are coerced
    from their stored TEXT representation to float/int.
    """
    async with get_db(path) as db:
        async with db.execute("SELECT key, value FROM settings") as cursor:
            rows = await cursor.fetchall()
            return {row["key"]: _coerce_setting(row["key"], row["value"]) for row in rows}


async def put_settings(path: str, updates: dict) -> None:
    """
    Persist a (partial) dict of settings updates to SQLite.

    Unknown keys (not in SETTINGS_DEFAULTS) are silently ignored.
    Numeric values are coerced to strings for uniform TEXT storage.
    """
    async with get_db(path) as db:
        for key, value in updates.items():
            if key not in SETTINGS_DEFAULTS:
                continue
            await db.execute(
                "UPDATE settings SET value = ? WHERE key = ?",
                (str(value), key),
            )
        await db.commit()


async def recover_stale_jobs(path: str) -> int:
    """
    Reset RUNNING jobs with stale heartbeats back to QUEUED.

    Returns the number of jobs recovered.
    Detection: status='RUNNING' and heartbeat_at older than HEARTBEAT_STALE_SECONDS.
    """
    threshold = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(seconds=HEARTBEAT_STALE_SECONDS)
    ).isoformat()
    async with get_db(path) as db:
        cursor = await db.execute(
            "UPDATE jobs SET status='QUEUED', started_at=NULL, heartbeat_at=NULL "
            "WHERE status='RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at < ?)",
            (threshold,),
        )
        await db.commit()
        return cursor.rowcount


async def create_job(path: str, source_path: str, config: dict) -> int:
    """
    Insert a new job row with status QUEUED.

    Returns the new job_id (integer primary key).
    The config dict is serialized to JSON for storage.
    """
    async with get_db(path) as db:
        cursor = await db.execute(
            "INSERT INTO jobs (status, source_path, config, log, created_at) "
            "VALUES ('QUEUED', ?, ?, '', ?)",
            (source_path, json.dumps(config), _utcnow()),
        )
        await db.commit()
        return cursor.lastrowid


async def get_job(path: str, job_id: int) -> dict | None:
    """
    Fetch a single job by job_id.

    Returns a dict with all job columns, or None if not found.
    The config column is deserialized from JSON back to a dict.
    """
    async with get_db(path) as db:
        async with db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)) as cursor:
            row = await cursor.fetchone()
            if row is None:
                return None
            result = dict(row)
            result["config"] = json.loads(result["config"])
            return result


async def list_jobs(path: str, status: str | None = None) -> list[dict]:
    """
    Return all jobs, optionally filtered by status.

    Returns a list of dicts with all job columns.
    The config column is deserialized from JSON for each row.
    """
    async with get_db(path) as db:
        if status is not None:
            async with db.execute(
                "SELECT * FROM jobs WHERE status = ? ORDER BY created_at",
                (status,),
            ) as cursor:
                rows = await cursor.fetchall()
        else:
            async with db.execute(
                "SELECT * FROM jobs ORDER BY created_at"
            ) as cursor:
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            d = dict(row)
            d["config"] = json.loads(d["config"])
            result.append(d)
        return result


async def update_job_status(path: str, job_id: int, status: str) -> None:
    """Update the status column for a job."""
    now = _utcnow()
    async with get_db(path) as db:
        if status == "RUNNING":
            await db.execute(
                "UPDATE jobs SET status=?, started_at=? WHERE id=?",
                (status, now, job_id),
            )
        elif status in ("DONE", "FAILED", "CANCELLED"):
            await db.execute(
                "UPDATE jobs SET status=?, finished_at=? WHERE id=?",
                (status, now, job_id),
            )
        else:
            await db.execute(
                "UPDATE jobs SET status=? WHERE id=?",
                (status, job_id),
            )
        await db.commit()


async def update_heartbeat(path: str, job_id: int) -> None:
    """Set heartbeat_at to the current UTC timestamp for a running job."""
    async with get_db(path) as db:
        await db.execute(
            "UPDATE jobs SET heartbeat_at=? WHERE id=?",
            (_utcnow(), job_id),
        )
        await db.commit()


async def append_job_log(path: str, job_id: int, line: str) -> None:
    """Append a line to the job's log text blob (newline-separated)."""
    async with get_db(path) as db:
        await db.execute(
            "UPDATE jobs SET log = log || ? WHERE id = ?",
            (line + "\n", job_id),
        )
        await db.commit()


async def create_chunk(path: str, job_id: int, chunk_index: int) -> int:
    """
    Insert a new chunk row for a job.

    Returns the new chunk_id (integer primary key).
    """
    async with get_db(path) as db:
        cursor = await db.execute(
            "INSERT INTO chunks (job_id, chunk_index) VALUES (?, ?)",
            (job_id, chunk_index),
        )
        await db.commit()
        return cursor.lastrowid


async def update_chunk(
    path: str,
    chunk_id: int,
    *,
    crf_used: float,
    vmaf_score: float,
    iterations: int,
    status: str,
) -> None:
    """Update chunk results after encoding completes (CRF used, VMAF score, iteration count, status)."""
    now = _utcnow()
    async with get_db(path) as db:
        if status == "DONE":
            await db.execute(
                "UPDATE chunks SET crf_used=?, vmaf_score=?, iterations=?, status=?, finished_at=? "
                "WHERE id=?",
                (crf_used, vmaf_score, iterations, status, now, chunk_id),
            )
        else:
            await db.execute(
                "UPDATE chunks SET crf_used=?, vmaf_score=?, iterations=?, status=? WHERE id=?",
                (crf_used, vmaf_score, iterations, status, chunk_id),
            )
        await db.commit()


async def get_chunks(path: str, job_id: int) -> list[dict]:
    """Return all chunk rows for a job ordered by chunk_index."""
    async with get_db(path) as db:
        async with db.execute(
            "SELECT * FROM chunks WHERE job_id=? ORDER BY chunk_index",
            (job_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def create_step(path: str, job_id: int, step_name: str) -> int:
    """
    Insert a new pipeline step row for a job.

    Returns the new step_id (integer primary key).
    """
    async with get_db(path) as db:
        cursor = await db.execute(
            "INSERT INTO steps (job_id, step_name) VALUES (?, ?)",
            (job_id, step_name),
        )
        await db.commit()
        return cursor.lastrowid


async def update_step(path: str, step_id: int, status: str) -> None:
    """Update the status of a pipeline step."""
    now = _utcnow()
    async with get_db(path) as db:
        if status in ("DONE", "FAILED"):
            await db.execute(
                "UPDATE steps SET status=?, finished_at=? WHERE id=?",
                (status, now, step_id),
            )
        else:
            await db.execute(
                "UPDATE steps SET status=? WHERE id=?",
                (status, step_id),
            )
        await db.commit()


async def get_steps(path: str, job_id: int) -> list[dict]:
    """Return all step rows for a job ordered by creation order."""
    async with get_db(path) as db:
        async with db.execute(
            "SELECT * FROM steps WHERE job_id=? ORDER BY id",
            (job_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def seen_file(path: str, mtime: float, db_path: str) -> bool:
    """Return True if this path+mtime combination has been seen before."""
    async with get_db(db_path) as db:
        row = await db.execute(
            "SELECT 1 FROM seen_files WHERE path = ? AND mtime = ?",
            (path, mtime),
        )
        return await row.fetchone() is not None


async def mark_file_seen(path: str, mtime: float, db_path: str) -> None:
    """Record that this path+mtime was enqueued so it is not re-added."""
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT OR IGNORE INTO seen_files (path, mtime) VALUES (?, ?)",
            (path, mtime),
        )
        await db.commit()
