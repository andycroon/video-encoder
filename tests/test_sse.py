"""Tests for SSE EventBus (04-03)."""
from __future__ import annotations

import asyncio
import pytest
from encoder.sse import EventBus, _format_sse, event_bus


def test_format_sse_stage():
    msg = _format_sse("stage", {"name": "ffv1_encode"})
    assert msg.startswith("event: stage\n"), f"Bad format: {repr(msg)}"
    assert "data: " in msg
    assert msg.endswith("\n\n"), f"Bad ending: {repr(msg)}"


def test_format_sse_job_complete():
    msg = _format_sse("job_complete", {"status": "DONE", "duration": 1.5})
    assert "job_complete" in msg
    assert "DONE" in msg


def test_event_bus_pubsub_roundtrip():
    """Pre-seed queue via publish before subscribe; check format matches."""
    # This tests the format and basic queue mechanics without concurrency
    bus = EventBus()

    # Manually register a queue (mimics what subscribe() does internally)
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    bus._subscribers[1] = [q]

    bus.publish(1, "stage", {"name": "test"})
    bus.publish(1, "job_complete", {"status": "DONE", "duration": 1.0})

    # Verify messages are in the queue
    assert q.qsize() == 2
    msg1 = q.get_nowait()
    msg2 = q.get_nowait()
    assert "stage" in msg1
    assert "job_complete" in msg2


def test_event_bus_pubsub_async_roundtrip():
    """Full async round-trip: consumer task started before publisher.

    Uses asyncio.Queue directly to test subscribe() registers before publish().
    """
    async def _run():
        bus = EventBus()
        msgs = []
        done = asyncio.Event()

        async def consumer():
            async for m in bus.subscribe(job_id=10):
                msgs.append(m)
            done.set()

        # Create consumer task
        task = asyncio.create_task(consumer())
        # Yield to let consumer task start and register its queue.
        # Multiple yields ensure the generator body runs up to first await.
        for _ in range(3):
            await asyncio.sleep(0)
        # Now publish — queue is registered
        bus.publish(10, "stage", {"name": "test"})
        bus.publish(10, "job_complete", {"status": "DONE", "duration": 1.0})
        # Wait for consumer to process messages
        await asyncio.wait_for(done.wait(), timeout=10.0)
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        assert len(msgs) == 2, f"Expected 2 messages, got {len(msgs)}"
        assert "stage" in msgs[0]
        assert "job_complete" in msgs[1]

    asyncio.run(_run())


def test_event_bus_close_terminates_subscriber():
    async def _run():
        bus = EventBus()
        msgs = []
        done = asyncio.Event()

        async def consumer():
            async for m in bus.subscribe(job_id=2):
                msgs.append(m)
            done.set()

        task = asyncio.create_task(consumer())
        for _ in range(3):
            await asyncio.sleep(0)
        bus.close(2)
        await asyncio.wait_for(done.wait(), timeout=5.0)
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        assert msgs == [], f"Expected no messages after close, got {msgs}"

    asyncio.run(_run())


def test_event_bus_singleton_exported():
    assert event_bus is not None
    assert isinstance(event_bus, EventBus)


def test_stream_terminates_on_error_event():
    async def _run():
        bus = EventBus()
        msgs = []
        done = asyncio.Event()

        async def consumer():
            async for m in bus.subscribe(job_id=3):
                msgs.append(m)
            done.set()

        task = asyncio.create_task(consumer())
        for _ in range(3):
            await asyncio.sleep(0)
        bus.publish(3, "stage", {"name": "start"})
        bus.publish(3, "error", {"message": "failed", "step": "pipeline"})
        await asyncio.wait_for(done.wait(), timeout=5.0)
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        assert len(msgs) == 2
        assert "error" in msgs[1]

    asyncio.run(_run())
