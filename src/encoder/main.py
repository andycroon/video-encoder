"""FastAPI application for the video encoder web API."""
from __future__ import annotations

import json as _json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from encoder.db import (
    init_db,
    recover_stale_jobs,
    get_settings,
    put_settings,
    create_job,
    get_job,
    list_jobs,
    update_job_status,
    get_profiles,
    create_profile_db,
    update_profile_db,
    delete_profile_db,
)
from encoder.scheduler import Scheduler
from encoder.sse import event_bus
from encoder.watcher import WatchFolder

DB_PATH = os.environ.get("ENCODER_DB", "encoder.db")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(DB_PATH)
    await recover_stale_jobs(DB_PATH)

    scheduler = Scheduler(db_path=DB_PATH)
    app.state.scheduler = scheduler

    # Re-enqueue surviving QUEUED jobs from previous session
    queued = await list_jobs(DB_PATH, status="QUEUED")
    for job in queued:
        await scheduler.enqueue(job["id"])

    watcher = WatchFolder(scheduler=scheduler, db_path=DB_PATH)
    app.state.watcher = watcher

    await scheduler.start()
    await watcher.start()
    yield
    await watcher.stop()
    await scheduler.stop()


app = FastAPI(title="Video Encoder API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobSubmit(BaseModel):
    source_path: str
    config: dict = {}  # per-job overrides; merged with settings at run time


class ProfileCreate(BaseModel):
    name: str
    config: dict
    is_default: bool = False


class ProfileUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None


@app.get("/")
async def health():
    return {"status": "ok"}


@app.get("/settings")
async def read_settings():
    return await get_settings(DB_PATH)


@app.put("/settings")
async def write_settings(body: dict):
    await put_settings(DB_PATH, body)
    return await get_settings(DB_PATH)


@app.post("/jobs", status_code=201)
async def submit_job(body: JobSubmit, request: Request):
    settings = await get_settings(DB_PATH)
    # Snapshot: start with settings defaults, apply per-job overrides
    config_snapshot = {
        "vmaf_min": settings["vmaf_min"],
        "vmaf_max": settings["vmaf_max"],
        "crf_min": settings["crf_min"],
        "crf_max": settings["crf_max"],
        "crf_start": settings["crf_start"],
        "audio_codec": settings["audio_codec"],
    }
    config_snapshot.update(body.config)
    job_id = await create_job(DB_PATH, body.source_path, config_snapshot)
    job = await get_job(DB_PATH, job_id)
    await request.app.state.scheduler.enqueue(job_id)
    return job


@app.get("/jobs")
async def list_all_jobs(status: str | None = None):
    return await list_jobs(DB_PATH, status=status)


@app.get("/jobs/{job_id}")
async def get_single_job(job_id: int):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.patch("/jobs/{job_id}/pause")
async def pause_job(job_id: int, request: Request):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in ("RUNNING", "QUEUED"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot pause job in status {job['status']}",
        )
    request.app.state.scheduler.pause(job_id)
    await update_job_status(DB_PATH, job_id, "PAUSED")
    return await get_job(DB_PATH, job_id)


@app.delete("/jobs/{job_id}", status_code=200)
async def cancel_job(job_id: int, request: Request):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    request.app.state.scheduler.cancel(job_id)
    await update_job_status(DB_PATH, job_id, "CANCELLED")
    return {"cancelled": job_id}


@app.get("/jobs/{job_id}/stream")
async def stream_job(job_id: int):
    """SSE endpoint streaming pipeline progress for a job.

    Returns named events: stage, chunk_progress, chunk_complete, job_complete, error, warning.
    Sends keepalive pings (`: ping`) every 15 seconds.
    Stream terminates after job_complete or error event.
    """
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        async for message in event_bus.subscribe(job_id):
            yield message

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/jobs/{job_id}/retry", status_code=201)
async def retry_job(job_id: int, request: Request):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in ("FAILED", "CANCELLED"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot retry job in status {job['status']}",
        )
    stored_config = job["config"] if isinstance(job["config"], dict) else _json.loads(job["config"])
    new_id = await create_job(DB_PATH, job["source_path"], stored_config)
    await request.app.state.scheduler.enqueue(new_id)
    new_job = await get_job(DB_PATH, new_id)
    return new_job


@app.get("/profiles")
async def list_profiles():
    profiles = await get_profiles(DB_PATH)
    return profiles


@app.post("/profiles", status_code=201)
async def create_profile_route(body: ProfileCreate):
    try:
        profile = await create_profile_db(DB_PATH, body.name, body.config, body.is_default)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})
    return profile


@app.put("/profiles/{profile_id}")
async def update_profile_route(profile_id: int, body: ProfileUpdate):
    updated = await update_profile_db(DB_PATH, profile_id, body.name, body.config)
    if updated is None:
        return JSONResponse(status_code=404, content={"detail": "Profile not found"})
    return updated


@app.delete("/profiles/{profile_id}", status_code=200)
async def delete_profile_route(profile_id: int):
    try:
        found = await delete_profile_db(DB_PATH, profile_id)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})
    if not found:
        return JSONResponse(status_code=404, content={"detail": "Profile not found"})
    return {"deleted": profile_id}


# Static file serving — MUST be last to avoid intercepting API routes
_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
