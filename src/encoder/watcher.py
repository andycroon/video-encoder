"""Watch folder background task — polls for new MKV files and auto-enqueues them."""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from encoder.db import create_job, get_profiles, get_settings, mark_file_seen, seen_file

logger = logging.getLogger(__name__)

POLL_INTERVAL = 10        # seconds between folder scans
STABILITY_INTERVAL = 2    # seconds between size checks
STABILITY_REQUIRED = 5    # seconds of stable size before enqueue


class WatchFolder:
    """Polls a configurable folder for new MKV files and enqueues them for encoding."""

    def __init__(self, scheduler, db_path: str):
        self._scheduler = scheduler
        self._db_path = db_path
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the background polling task."""
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        """Cancel the background task."""
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self) -> None:
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Watch folder poll crashed: %s", exc)
            await asyncio.sleep(POLL_INTERVAL)

    async def _poll_once(self) -> None:
        settings = await get_settings(self._db_path)
        folder_path = settings.get("watch_folder_path", "")
        if not folder_path:
            return   # disabled

        folder = Path(folder_path)
        try:
            entries = list(folder.glob("*.mkv"))
        except OSError as exc:
            logger.warning("Watch folder OSError scanning %s: %s", folder, exc)
            return

        for entry in entries:
            try:
                stat = entry.stat()
            except OSError:
                continue

            mtime = stat.st_mtime
            path_str = str(entry.resolve())

            if await seen_file(path_str, mtime, self._db_path):
                continue

            # File stability check: wait until size is stable for STABILITY_REQUIRED seconds
            if not await self._is_stable(entry):
                continue

            # Enqueue — start from the default profile so subtitle/x264 config flows through,
            # then overlay current settings (settings is the source of truth for VMAF/CRF/audio).
            settings = await get_settings(self._db_path)
            profiles = await get_profiles(self._db_path)
            default_profile = next((p for p in profiles if p["is_default"]), None)
            config_snapshot: dict = dict(default_profile["config"]) if default_profile else {}
            config_snapshot.update({
                "vmaf_min": settings["vmaf_min"],
                "vmaf_max": settings["vmaf_max"],
                "crf_min":  settings["crf_min"],
                "crf_max":  settings["crf_max"],
                "crf_start": settings["crf_start"],
                "audio_codec": settings["audio_codec"],
            })
            job_id = await create_job(self._db_path, path_str, config_snapshot)
            await mark_file_seen(path_str, mtime, self._db_path)
            await self._scheduler.enqueue(job_id)
            logger.info("Watch folder: enqueued %s as job %d", entry.name, job_id)

    async def _is_stable(self, path: Path) -> bool:
        """Return True if file size is unchanged for STABILITY_REQUIRED seconds."""
        checks_needed = STABILITY_REQUIRED // STABILITY_INTERVAL
        try:
            prev_size = path.stat().st_size
            for _ in range(checks_needed):
                await asyncio.sleep(STABILITY_INTERVAL)
                cur_size = path.stat().st_size
                if cur_size != prev_size:
                    return False
                prev_size = cur_size
            return True
        except OSError:
            return False
