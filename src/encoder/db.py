"""
SQLite state layer for the video encoder.

Public API — Phase 3 (Pipeline Runner) imports these functions.
All functions are async and use aiosqlite.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

# Number of seconds without a heartbeat before a RUNNING job is considered stale
HEARTBEAT_STALE_SECONDS = 60


@asynccontextmanager
async def get_db(path: str) -> AsyncIterator:
    """Async context manager yielding an aiosqlite connection with WAL mode enabled."""
    raise NotImplementedError


async def init_db(path: str) -> None:
    """Create all tables and enable WAL mode. Safe to call repeatedly (CREATE IF NOT EXISTS)."""
    raise NotImplementedError


async def recover_stale_jobs(path: str) -> int:
    """
    Reset RUNNING jobs with stale heartbeats back to QUEUED.

    Returns the number of jobs recovered.
    Detection: status='RUNNING' and heartbeat_at older than HEARTBEAT_STALE_SECONDS.
    """
    raise NotImplementedError


async def create_job(path: str, source_path: str, config: dict) -> int:
    """
    Insert a new job row with status QUEUED.

    Returns the new job_id (integer primary key).
    The config dict is serialized to JSON for storage.
    """
    raise NotImplementedError


async def get_job(path: str, job_id: int) -> dict | None:
    """
    Fetch a single job by job_id.

    Returns a dict with all job columns, or None if not found.
    The config column is deserialized from JSON back to a dict.
    """
    raise NotImplementedError


async def list_jobs(path: str, status: str | None = None) -> list[dict]:
    """
    Return all jobs, optionally filtered by status.

    Returns a list of dicts with all job columns.
    The config column is deserialized from JSON for each row.
    """
    raise NotImplementedError


async def update_job_status(path: str, job_id: int, status: str) -> None:
    """Update the status column for a job."""
    raise NotImplementedError


async def update_heartbeat(path: str, job_id: int) -> None:
    """Set heartbeat_at to the current UTC timestamp for a running job."""
    raise NotImplementedError


async def append_job_log(path: str, job_id: int, line: str) -> None:
    """Append a line to the job's log text blob (newline-separated)."""
    raise NotImplementedError


async def create_chunk(path: str, job_id: int, chunk_index: int) -> int:
    """
    Insert a new chunk row for a job.

    Returns the new chunk_id (integer primary key).
    """
    raise NotImplementedError


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
    raise NotImplementedError


async def get_chunks(path: str, job_id: int) -> list[dict]:
    """Return all chunk rows for a job ordered by chunk_index."""
    raise NotImplementedError


async def create_step(path: str, job_id: int, step_name: str) -> int:
    """
    Insert a new pipeline step row for a job.

    Returns the new step_id (integer primary key).
    """
    raise NotImplementedError


async def update_step(path: str, step_id: int, status: str) -> None:
    """Update the status of a pipeline step."""
    raise NotImplementedError


async def get_steps(path: str, job_id: int) -> list[dict]:
    """Return all step rows for a job ordered by creation order."""
    raise NotImplementedError
