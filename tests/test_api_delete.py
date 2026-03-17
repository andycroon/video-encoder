"""Integration tests for DELETE /api/jobs/{id} and DELETE /api/jobs/bulk endpoints."""
from __future__ import annotations

import asyncio
import os

import pytest
from fastapi.testclient import TestClient


def _make_client(db_path: str):
    """Create a test client with a fresh DB at db_path."""
    os.environ["ENCODER_DB"] = db_path
    # Re-import to pick up new DB_PATH
    import importlib
    import encoder.main as main_mod
    importlib.reload(main_mod)

    from encoder.db import init_db

    asyncio.run(init_db(db_path))
    return TestClient(main_mod.app, raise_server_exceptions=False), db_path


def test_delete_terminal_job(tmp_path):
    """DELETE /api/jobs/{id} for a DONE job returns 200 with deleted field."""
    db_path = str(tmp_path / "test.db")
    client, _ = _make_client(db_path)
    from encoder.db import create_job, update_job_status

    job_id = asyncio.run(create_job(db_path, "/source/a.mkv", {"vmaf_min": 96.2}))
    asyncio.run(update_job_status(db_path, job_id, "DONE"))

    resp = client.delete(f"/api/jobs/{job_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == job_id

    # Verify actually gone
    resp2 = client.get(f"/api/jobs/{job_id}")
    assert resp2.status_code == 404


def test_delete_nonexistent_job(tmp_path):
    """DELETE /api/jobs/9999 returns 404."""
    db_path = str(tmp_path / "test.db")
    client, _ = _make_client(db_path)
    resp = client.delete("/api/jobs/9999")
    assert resp.status_code == 404


def test_bulk_delete(tmp_path):
    """DELETE /api/jobs/bulk with status=DONE removes all DONE jobs."""
    db_path = str(tmp_path / "test.db")
    client, _ = _make_client(db_path)
    from encoder.db import create_job, update_job_status

    j1 = asyncio.run(create_job(db_path, "/source/a.mkv", {"vmaf_min": 96.2}))
    j2 = asyncio.run(create_job(db_path, "/source/b.mkv", {"vmaf_min": 96.2}))
    asyncio.run(update_job_status(db_path, j1, "DONE"))
    asyncio.run(update_job_status(db_path, j2, "DONE"))

    resp = client.request("DELETE", "/api/jobs/bulk", json={"status": "DONE"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["deleted"] == 2
    assert data["status"] == "DONE"


def test_bulk_delete_invalid_status(tmp_path):
    """DELETE /api/jobs/bulk with status=RUNNING returns 400."""
    db_path = str(tmp_path / "test.db")
    client, _ = _make_client(db_path)
    resp = client.request("DELETE", "/api/jobs/bulk", json={"status": "RUNNING"})
    assert resp.status_code == 400


def test_bulk_route_not_swallowed(tmp_path):
    """DELETE /api/jobs/bulk is reachable (not matched as job_id)."""
    db_path = str(tmp_path / "test.db")
    client, _ = _make_client(db_path)
    resp = client.request("DELETE", "/api/jobs/bulk", json={"status": "DONE"})
    # Should be 200 (no DONE jobs, count=0), NOT 422 (bulk parsed as int)
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0
