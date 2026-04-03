"""FastAPI application for the video encoder web API."""
from __future__ import annotations

import json as _json
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from encoder.auth import hash_password, verify_password, create_token, decode_token
from encoder.cleanup import AutoCleanup
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
    delete_job,
    delete_jobs_by_status,
    has_any_user,
    get_user_by_username,
    create_user,
)
from encoder.scheduler import Scheduler
from encoder.sse import event_bus
from encoder.watcher import WatchFolder

_INSTALL_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.environ.get("ENCODER_DB") or os.path.join(_INSTALL_DIR, "encoder.db")


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
    # Re-enqueue RESUMING jobs (were RUNNING when app crashed — pipeline will skip done steps)
    resuming = await list_jobs(DB_PATH, status="RESUMING")
    for job in resuming:
        await scheduler.enqueue(job["id"])

    watcher = WatchFolder(scheduler=scheduler, db_path=DB_PATH)
    app.state.watcher = watcher

    cleaner = AutoCleanup(db_path=DB_PATH)
    app.state.cleaner = cleaner

    await scheduler.start()
    await watcher.start()
    await cleaner.start()
    yield
    await watcher.stop()
    await cleaner.stop()
    await scheduler.stop()


app = FastAPI(title="Video Encoder API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AuthMiddleware(BaseHTTPMiddleware):
    """JWT auth middleware. Protects all routes except /health and /api/auth/*.

    SSE stream endpoints (/api/jobs/{id}/stream) cannot receive Authorization
    headers from EventSource, so the middleware also accepts a ?token= query
    parameter as a fallback for paths ending in '/stream'.
    """

    EXEMPT_PATHS = {"/health", "/api/auth/status", "/api/auth/login", "/api/auth/register"}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Exempt paths pass through
        if path in self.EXEMPT_PATHS:
            return await call_next(request)

        # Static assets (frontend HTML, JS, CSS) never require a token
        if not path.startswith("/api/"):
            return await call_next(request)

        # Check if auth is even enabled (any user exists)
        if not await has_any_user(DB_PATH):
            # No user set up yet — allow all requests (backward compatible)
            return await call_next(request)

        # Extract Bearer token from Authorization header
        token = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

        # Fallback: accept ?token= query parameter for SSE stream endpoints
        # EventSource API cannot send custom headers, so we pass the JWT as a query param
        if token is None and path.endswith("/stream"):
            token = request.query_params.get("token")

        if token is None:
            return StarletteResponse(
                content='{"detail":"Not authenticated"}',
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
                media_type="application/json",
            )

        payload = decode_token(token)
        if payload is None:
            return StarletteResponse(
                content='{"detail":"Invalid or expired token"}',
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
                media_type="application/json",
            )

        # Token valid — proceed
        request.state.user = payload
        return await call_next(request)


app.add_middleware(AuthMiddleware)

api = APIRouter(prefix="/api")


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


class BulkDeleteBody(BaseModel):
    status: str  # "DONE" or "FAILED"


class AuthLogin(BaseModel):
    username: str
    password: str


class AuthRegister(BaseModel):
    username: str
    password: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/auth/status")
async def auth_status():
    """Public endpoint: returns whether initial setup is required."""
    setup_required = not await has_any_user(DB_PATH)
    return {"setup_required": setup_required}


@api.post("/auth/login")
async def auth_login(body: AuthLogin):
    """Public endpoint: validate credentials and return JWT."""
    user = await get_user_by_username(DB_PATH, body.username)
    if user is None or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_token(user["id"], user["username"])
    return {"access_token": token}


@api.get("/auth/me")
async def auth_me(request: Request):
    """Protected endpoint: returns current user info. Used by the frontend to validate a stored token on startup."""
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"user_id": user["sub"], "username": user["username"]}


@api.post("/auth/register", status_code=201)
async def auth_register(body: AuthRegister):
    """Public endpoint (first-run only): create the initial user account."""
    # Only allow registration if no user exists yet
    if await has_any_user(DB_PATH):
        raise HTTPException(status_code=403, detail="Account already exists.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    pw_hash = hash_password(body.password)
    user = await create_user(DB_PATH, body.username, pw_hash)
    token = create_token(user["id"], user["username"])
    return {"access_token": token}


@api.get("/settings")
async def read_settings():
    return await get_settings(DB_PATH)


@api.put("/settings")
async def write_settings(body: dict):
    await put_settings(DB_PATH, body)
    return await get_settings(DB_PATH)


@api.post("/jobs", status_code=201)
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
        "max_parallel_chunks": settings.get("max_parallel_chunks", 1),
    }
    config_snapshot.update(body.config)
    job_id = await create_job(DB_PATH, body.source_path, config_snapshot)
    job = await get_job(DB_PATH, job_id)
    await request.app.state.scheduler.enqueue(job_id)
    return job


@api.get("/jobs")
async def list_all_jobs(status: str | None = None):
    return await list_jobs(DB_PATH, status=status)


@api.get("/jobs/{job_id}")
async def get_single_job(job_id: int):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@api.patch("/jobs/{job_id}/pause")
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


@api.delete("/jobs/bulk", status_code=200)
async def bulk_delete_jobs(body: BulkDeleteBody):
    if body.status not in ("DONE", "FAILED"):
        raise HTTPException(status_code=400, detail="status must be DONE or FAILED")
    count = await delete_jobs_by_status(DB_PATH, body.status)
    return {"deleted": count, "status": body.status}


@api.delete("/jobs/{job_id}", status_code=200)
async def delete_or_cancel_job(job_id: int, request: Request):
    job = await get_job(DB_PATH, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] in ("DONE", "FAILED", "CANCELLED"):
        # Terminal state: purge from DB
        await delete_job(DB_PATH, job_id)
        return {"deleted": job_id}
    else:
        # Active state: cancel first, then purge
        request.app.state.scheduler.cancel(job_id)
        await update_job_status(DB_PATH, job_id, "CANCELLED")
        await delete_job(DB_PATH, job_id)
        return {"deleted": job_id}


@api.get("/jobs/{job_id}/stream")
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


@api.post("/jobs/{job_id}/retry", status_code=201)
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


@api.get("/profiles")
async def list_profiles():
    profiles = await get_profiles(DB_PATH)
    return profiles


@api.post("/profiles", status_code=201)
async def create_profile_route(body: ProfileCreate):
    try:
        profile = await create_profile_db(DB_PATH, body.name, body.config, body.is_default)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})
    return profile


@api.put("/profiles/{profile_id}")
async def update_profile_route(profile_id: int, body: ProfileUpdate):
    updated = await update_profile_db(DB_PATH, profile_id, body.name, body.config)
    if updated is None:
        return JSONResponse(status_code=404, content={"detail": "Profile not found"})
    return updated


@api.delete("/profiles/{profile_id}", status_code=200)
async def delete_profile_route(profile_id: int):
    try:
        found = await delete_profile_db(DB_PATH, profile_id)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})
    if not found:
        return JSONResponse(status_code=404, content={"detail": "Profile not found"})
    return {"deleted": profile_id}


@api.get("/browse")
async def browse_filesystem(path: str = ""):
    import pathlib
    import string

    if not path:
        if os.name == "nt":
            drives = [
                {"name": d + ":\\", "path": d + ":\\", "is_dir": True}
                for d in string.ascii_uppercase
                if os.path.exists(d + ":\\")
            ]
            return {"path": "", "parent": None, "entries": drives}
        path = "/"

    p = pathlib.Path(path)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Path not found")

    entries = []
    try:
        def _sort_key(x):
            try:
                return (not x.is_dir(), x.name.lower())
            except OSError:
                return (True, x.name.lower())

        items = sorted(p.iterdir(), key=_sort_key)
        for item in items:
            try:
                is_dir = item.is_dir()
                if is_dir or item.suffix.lower() in {".mkv", ".mp4", ".mov", ".avi"}:
                    if is_dir:
                        entries.append({
                            "name": item.name,
                            "path": str(item),
                            "is_dir": True,
                            "size": None,
                            "modified_at": None,
                        })
                    else:
                        st = item.stat()
                        entries.append({
                            "name": item.name,
                            "path": str(item),
                            "is_dir": False,
                            "size": st.st_size,
                            "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
                        })
            except OSError:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    parent = str(p.parent) if str(p.parent) != str(p) else None
    return {"path": str(p), "parent": parent, "entries": entries}


@api.post("/files/rename")
async def rename_file(body: dict):
    import pathlib
    old_path = pathlib.Path(body.get("path", ""))
    new_name = body.get("new_name", "").strip()
    if not old_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not new_name or "/" in new_name or "\\" in new_name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    new_path = old_path.parent / new_name
    if new_path.exists():
        raise HTTPException(status_code=409, detail="File already exists")
    old_path.rename(new_path)
    return {"path": str(new_path), "name": new_name}


@api.post("/files/move")
async def move_files(body: dict):
    import pathlib
    import shutil
    paths = body.get("paths", [])
    destination = pathlib.Path(body.get("destination", ""))
    overwrite = body.get("overwrite", False)
    if not destination.is_dir():
        raise HTTPException(status_code=404, detail="Destination not found")
    results = []
    for p in paths:
        src = pathlib.Path(p)
        if not src.exists():
            results.append({"path": p, "status": "not_found"})
            continue
        dest_file = destination / src.name
        if dest_file.exists() and not overwrite:
            results.append({"path": p, "status": "conflict", "conflict_name": src.name})
            continue
        shutil.move(str(src), str(dest_file))
        results.append({"path": str(dest_file), "status": "ok"})
    return {"results": results}


@api.post("/files/copy")
async def copy_files(body: dict):
    import pathlib
    import shutil
    paths = body.get("paths", [])
    destination = pathlib.Path(body.get("destination", ""))
    overwrite = body.get("overwrite", False)
    if not destination.is_dir():
        raise HTTPException(status_code=404, detail="Destination not found")
    results = []
    for p in paths:
        src = pathlib.Path(p)
        if not src.exists():
            results.append({"path": p, "status": "not_found"})
            continue
        dest_file = destination / src.name
        if dest_file.exists() and not overwrite:
            results.append({"path": p, "status": "conflict", "conflict_name": src.name})
            continue
        shutil.copy2(str(src), str(dest_file))
        results.append({"path": str(dest_file), "status": "ok"})
    return {"results": results}


@api.post("/files/mkdir")
async def make_directory(body: dict):
    import pathlib
    parent = pathlib.Path(body.get("path", ""))
    name = body.get("name", "").strip()
    if not name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    if not parent.is_dir():
        raise HTTPException(status_code=404, detail="Parent directory not found")
    new_dir = parent / name
    if new_dir.exists():
        raise HTTPException(status_code=409, detail="Already exists")
    new_dir.mkdir()
    return {"path": str(new_dir), "name": name}


@api.get("/system")
async def get_system_info():
    import os
    return {"cpu_count": os.cpu_count() or 1}


app.include_router(api)

# Static file serving — MUST be last to avoid intercepting API routes
# Use CWD-relative path so it works whether installed editable or not.
# start.sh always runs from the project root, so CWD == project root.
_dist = os.environ.get("FRONTEND_DIST", os.path.join(os.getcwd(), "frontend", "dist"))
if os.path.isdir(_dist):
    _index = os.path.join(_dist, "index.html")

    @app.get("/", include_in_schema=False)
    async def serve_root():
        """Serve index.html with no-cache so browsers always load the latest JS bundle."""
        from fastapi.responses import FileResponse
        return FileResponse(_index, headers={"Cache-Control": "no-store, no-cache, must-revalidate"})

    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
