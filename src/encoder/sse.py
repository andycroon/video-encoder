"""In-process SSE event bus: publish from scheduler, subscribe from HTTP handlers."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

logger = logging.getLogger(__name__)

KEEPALIVE_INTERVAL = 15  # seconds


class EventBus:
    """Routes named SSE events to per-job subscriber queues."""

    def __init__(self):
        # job_id -> list of asyncio.Queue
        self._subscribers: dict[int, list[asyncio.Queue]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the main event loop so publish() is safe to call from threads."""
        self._loop = loop

    def publish(self, job_id: int, event_type: str, data: dict) -> None:
        """Publish an event. Thread-safe — routes through call_soon_threadsafe when called from a thread."""
        message = _format_sse(event_type, data)
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._deliver, job_id, message, event_type)
        else:
            self._deliver(job_id, message, event_type)

    def _deliver(self, job_id: int, message: str, event_type: str) -> None:
        """Put message into all subscriber queues. Must run on the event loop thread."""
        for q in self._subscribers.get(job_id, []):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                logger.warning("SSE queue full for job %d; dropping event %s", job_id, event_type)

    async def subscribe(self, job_id: int) -> AsyncIterator[str]:
        """Async generator yielding SSE-formatted strings for a single job.

        Yields keepalive pings every KEEPALIVE_INTERVAL seconds.
        Terminates when a job_complete or error event is received.
        """
        q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=256)
        subscribers = self._subscribers.setdefault(job_id, [])
        subscribers.append(q)
        try:
            while True:
                try:
                    message = await asyncio.wait_for(q.get(), timeout=KEEPALIVE_INTERVAL)
                    if message is None:
                        # Sentinel: stream closed
                        break
                    yield message
                    # Close stream after terminal events
                    # SSE format: "event: job_complete\n..." — check the event: line
                    if message.startswith("event: job_complete\n") or message.startswith("event: error\n"):
                        break
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            subscribers.remove(q)
            if not subscribers:
                self._subscribers.pop(job_id, None)

    def close(self, job_id: int) -> None:
        """Push sentinel None to all subscribers to cleanly terminate their generators."""
        for q in self._subscribers.get(job_id, []):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass


def _format_sse(event_type: str, data: dict) -> str:
    """Format a named SSE message string."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


# Singleton shared between scheduler and HTTP handlers
event_bus = EventBus()
