"""
Integration tests for src/encoder/db.py — SQLite state layer.

All tests use real SQLite via tmp_path fixture and asyncio.run() for async helpers.
No mocking. RED state: all tests fail with NotImplementedError until db.py is implemented.
"""

import asyncio
import datetime

import aiosqlite
import pytest

from encoder.db import (
    HEARTBEAT_STALE_SECONDS,
    append_job_log,
    create_chunk,
    create_job,
    create_step,
    get_chunks,
    get_job,
    get_steps,
    init_db,
    recover_stale_jobs,
    update_chunk,
    update_job_status,
    update_step,
)


def default_config() -> dict:
    return {
        "vmaf_min": 96.2,
        "vmaf_max": 97.6,
        "crf_min": 16,
        "crf_max": 20,
        "crf_start": 17,
        "audio_codec": "eac3",
        "x264_params": {"preset": "slow", "maxrate": "12000K"},
    }


def test_job_survives_restart(tmp_path):
    """Job written to DB is retrievable on a fresh connection (simulates restart)."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())

        # Simulate restart by fetching via a fresh get_job call (new connection internally)
        result = await get_job(db_path, job_id)

        assert result["status"] == "QUEUED"
        assert result["source_path"] == "/source/video.mkv"
        assert isinstance(result["config"], dict), "config must be deserialized to dict"
        assert "vmaf_min" in result["config"]

    asyncio.run(_run())


def test_wal_mode_active(tmp_path):
    """SQLite WAL mode must be active after init_db."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)

        # Use a raw aiosqlite connection (NOT get_db) to verify WAL mode independently
        async with aiosqlite.connect(db_path) as conn:
            async with conn.execute("PRAGMA journal_mode") as cursor:
                row = await cursor.fetchone()
        assert row[0] == "wal", f"Expected WAL mode, got: {row[0]}"

    asyncio.run(_run())


def test_stale_job_recovery(tmp_path):
    """RUNNING jobs with stale heartbeats are reset to RESUMING by recover_stale_jobs."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())

        # Manually set the job to RUNNING with a heartbeat 2 hours ago
        stale_time = (
            datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(hours=2)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        async with aiosqlite.connect(db_path) as conn:
            await conn.execute(
                "UPDATE jobs SET status='RUNNING', heartbeat_at=? WHERE id=?",
                (stale_time, job_id),
            )
            await conn.commit()

        count = await recover_stale_jobs(db_path)
        assert count == 1, f"Expected 1 recovered job, got {count}"

        result = await get_job(db_path, job_id)
        assert result["status"] == "RESUMING"
        assert result["heartbeat_at"] is None

    asyncio.run(_run())


def test_chunk_crud(tmp_path):
    """Chunk can be created, updated, and retrieved for a job."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())

        chunk_id = await create_chunk(db_path, job_id, chunk_index=0)
        await update_chunk(
            db_path,
            chunk_id,
            crf_used=17.0,
            vmaf_score=96.8,
            iterations=2,
            status="DONE",
        )

        chunks = await get_chunks(db_path, job_id)
        assert len(chunks) == 1
        assert chunks[0]["crf_used"] == 17.0
        assert chunks[0]["vmaf_score"] == 96.8
        assert chunks[0]["iterations"] == 2
        assert chunks[0]["status"] == "DONE"

    asyncio.run(_run())


def test_step_crud(tmp_path):
    """Pipeline step can be created, updated, and retrieved for a job."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())

        step_id = await create_step(db_path, job_id, "FFV1 encode")
        await update_step(db_path, step_id, "DONE")

        steps = await get_steps(db_path, job_id)
        assert len(steps) == 1
        assert steps[0]["step_name"] == "FFV1 encode"
        assert steps[0]["status"] == "DONE"

    asyncio.run(_run())


def test_log_append(tmp_path):
    """Log lines are appended to the job log in order."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())

        await append_job_log(db_path, job_id, "Chunk 1: CRF 17 -> VMAF 96.8 PASS")
        await append_job_log(db_path, job_id, "Chunk 2: CRF 18 -> VMAF 97.1 PASS")

        result = await get_job(db_path, job_id)
        assert "Chunk 1" in result["log"]
        assert "Chunk 2" in result["log"]
        assert result["log"].index("Chunk 1") < result["log"].index("Chunk 2"), (
            "Chunk 1 must appear before Chunk 2 in the log"
        )

    asyncio.run(_run())


def test_recover_stale_sets_resuming(tmp_path):
    """recover_stale_jobs sets stale RUNNING jobs to RESUMING (not QUEUED)."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        job_id = await create_job(db_path, "/source/video.mkv", default_config())

        # Set job to RUNNING with a heartbeat 120 seconds ago (past HEARTBEAT_STALE_SECONDS=60)
        stale_time = (
            datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(seconds=120)
        ).isoformat()
        async with aiosqlite.connect(db_path) as conn:
            await conn.execute(
                "UPDATE jobs SET status='RUNNING', heartbeat_at=? WHERE id=?",
                (stale_time, job_id),
            )
            await conn.commit()

        count = await recover_stale_jobs(db_path)
        assert count == 1, f"Expected 1 recovered job, got {count}"

        result = await get_job(db_path, job_id)
        assert result["status"] == "RESUMING", (
            f"Expected RESUMING status after recovery, got {result['status']!r}"
        )
        assert result["heartbeat_at"] is None, "heartbeat_at should be cleared after recovery"

    asyncio.run(_run())


def test_config_roundtrip(tmp_path):
    """Config dict is stored and retrieved without data loss (JSON round-trip)."""
    db_path = str(tmp_path / "test.db")

    async def _run():
        await init_db(db_path)
        cfg = default_config()
        job_id = await create_job(db_path, "/source/video.mkv", cfg)

        result = await get_job(db_path, job_id)
        assert result["config"] == cfg, "Config dict must survive JSON round-trip unchanged"
        assert result["config"]["vmaf_min"] == 96.2
        assert result["config"]["x264_params"]["maxrate"] == "12000K"

    asyncio.run(_run())
