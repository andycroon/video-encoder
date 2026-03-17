"""Auto-cleanup background task — removes completed jobs older than configured threshold."""
from __future__ import annotations

import asyncio
import logging

from encoder.db import auto_cleanup_jobs

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL = 3600  # run every hour


class AutoCleanup:
    """Polls the DB hourly and removes DONE jobs older than auto_cleanup_hours setting."""

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
            await asyncio.sleep(CLEANUP_INTERVAL)
