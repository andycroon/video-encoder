"""Asyncio job scheduler — serial queue, one job at a time."""
from __future__ import annotations

import asyncio
import concurrent.futures
import datetime
import logging
import os
import threading
from pathlib import Path

from encoder.db import (
    get_job,
    get_settings,
    update_job_status,
    append_job_log,
)
from encoder.pipeline import run_pipeline, DEFAULT_CONFIG
from encoder.sse import event_bus

logger = logging.getLogger(__name__)

_INSTALL_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = os.environ.get("ENCODER_DB") or str(_INSTALL_DIR / "encoder.db")


def _utcnow_str() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class Scheduler:
    """Serial asyncio job scheduler wrapping run_pipeline in a ThreadPoolExecutor."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._queue: asyncio.Queue[int] = asyncio.Queue()
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self._cancel_events: dict[int, threading.Event] = {}
        self._worker_task: asyncio.Task | None = None
        self._paused_jobs: set[int] = set()

    async def start(self) -> None:
        """Start the background worker. Call from FastAPI lifespan."""
        event_bus.set_loop(asyncio.get_running_loop())
        self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self) -> None:
        """Gracefully stop the worker. Call from FastAPI lifespan shutdown."""
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        self._executor.shutdown(wait=False)

    async def enqueue(self, job_id: int) -> None:
        """Add a job_id to the processing queue."""
        await self._queue.put(job_id)

    def cancel(self, job_id: int) -> bool:
        """Signal cancellation for a running job. Returns True if event existed."""
        event = self._cancel_events.get(job_id)
        if event:
            event.set()
            return True
        return False

    def pause(self, job_id: int) -> None:
        """Mark job as paused; pipeline step completes then job stops before next step."""
        self._paused_jobs.add(job_id)

    async def _worker_loop(self) -> None:
        """Consume jobs from queue serially. Restart on unexpected errors."""
        job_id: int | None = None
        while True:
            try:
                job_id = await self._queue.get()
                await self._run_job(job_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Scheduler worker crashed on job %s: %s", job_id, exc)

    async def _run_job(self, job_id: int) -> None:
        job = await get_job(self.db_path, job_id)
        if job is None:
            logger.warning("Job %d not found in DB; skipping", job_id)
            return
        if job["status"] not in ("QUEUED", "RESUMING"):
            logger.info("Job %d has status %s; skipping", job_id, job["status"])
            return

        settings = await get_settings(self.db_path)

        # Snapshot config: pipeline DEFAULT_CONFIG + settings overrides
        import json as _json
        stored_config = job["config"] if isinstance(job["config"], dict) else _json.loads(job["config"])
        config = {**DEFAULT_CONFIG, **stored_config}

        output_dir = Path(settings.get("output_path") or str(_INSTALL_DIR / "output"))
        temp_dir = Path(settings.get("temp_path") or str(_INSTALL_DIR / "temp")) / f"job_{job_id}"

        # Disk space preflight: warn if available < 3x source size
        source = Path(job["source_path"])
        await _disk_preflight(source, output_dir, job_id, self.db_path)

        cancel_event = threading.Event()
        self._cancel_events[job_id] = cancel_event

        # Emit initial stage event so SSE subscribers know the job is starting
        event_bus.publish(job_id, "stage", {
            "name": "starting",
            "started_at": _utcnow_str(),
        })

        loop = asyncio.get_running_loop()

        def publish(event_type: str, data: dict) -> None:
            event_bus.publish(job_id, event_type, data)

        try:
            await loop.run_in_executor(
                self._executor,
                _run_pipeline_sync,
                str(source),
                self.db_path,
                job_id,
                config,
                cancel_event,
                str(output_dir),
                str(temp_dir),
                publish,
            )
            # Pipeline completed successfully — emit job_complete
            finished_job = await get_job(self.db_path, job_id)
            event_bus.publish(job_id, "job_complete", {
                "status": finished_job["status"] if finished_job else "DONE",
                "duration": 0.0,
            })
        except Exception as exc:
            event_bus.publish(job_id, "error", {
                "message": str(exc),
                "step": "pipeline",
            })
            # Ensure job is marked FAILED and error is visible in the UI log
            try:
                await update_job_status(self.db_path, job_id, "FAILED")
                await append_job_log(self.db_path, job_id, f"ERROR: {exc}")
            except Exception:
                pass
            raise
        finally:
            event_bus.close(job_id)
            self._cancel_events.pop(job_id, None)
            self._paused_jobs.discard(job_id)


def _run_pipeline_sync(source_path, db_path, job_id, config, cancel_event, output_dir, temp_dir, publish=None):
    """Synchronous wrapper to run the async run_pipeline in a thread."""
    import asyncio as _asyncio
    loop = _asyncio.new_event_loop()
    try:
        loop.run_until_complete(
            run_pipeline(source_path, db_path, job_id, config, cancel_event, output_dir, temp_dir, publish=publish)
        )
    finally:
        loop.close()


async def _disk_preflight(source: Path, output_dir: Path, job_id: int, db_path: str) -> None:
    """Check available disk space. Emit warning log and SSE event if below 3x source size.

    Per user decision: emit warning but do NOT block the job — proceed regardless.
    """
    import shutil
    try:
        source_size = source.stat().st_size
        check_dir = output_dir if output_dir.exists() else Path(".")
        free = shutil.disk_usage(check_dir).free
        if free < source_size * 3:
            needed_gb = (source_size * 3) / (1024 ** 3)
            free_gb = free / (1024 ** 3)
            msg = f"WARN disk_preflight: need {needed_gb:.1f} GiB, have {free_gb:.1f} GiB"
            logger.warning("Job %d: %s", job_id, msg)
            await append_job_log(db_path, job_id, msg)
            event_bus.publish(job_id, "warning", {"message": msg})
    except OSError as exc:
        logger.warning("Job %d disk preflight failed: %s", job_id, exc)
