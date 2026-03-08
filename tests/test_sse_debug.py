"""Debug test: does asyncio.Queue wake up wait_for(q.get()) when put_nowait called after task starts?"""
import asyncio
import pytest
from encoder.sse import EventBus


@pytest.mark.asyncio
def test_basic_queue_wakeup_sync():
    """Using asyncio.run() directly to test queue wakeup."""
    async def _run():
        q = asyncio.Queue(maxsize=256)
        msgs = []
        done = asyncio.Event()

        async def consumer():
            msg = await asyncio.wait_for(q.get(), timeout=5.0)
            msgs.append(msg)
            done.set()

        task = asyncio.create_task(consumer())
        # Yield to let consumer get to wait_for
        for _ in range(3):
            await asyncio.sleep(0)
        q.put_nowait("hello")
        await asyncio.wait_for(done.wait(), timeout=5.0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert msgs == ["hello"], f"Got: {msgs}"

    asyncio.run(_run())


def test_string_put_wakes_getter():
    """Verify string put_nowait wakes up q.get()."""
    async def _run():
        q = asyncio.Queue()
        result = []

        async def getter():
            v = await q.get()
            result.append(v)

        task = asyncio.create_task(getter())
        await asyncio.sleep(0)
        q.put_nowait("test_string")
        await asyncio.sleep(0)
        assert result == ["test_string"], f"Got: {result}"
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())


def test_event_bus_subscribe_one_message():
    """Can EventBus.subscribe receive exactly one non-terminal message?"""
    async def _run():
        bus = EventBus()
        msgs = []
        received = asyncio.Event()

        async def consumer():
            async for m in bus.subscribe(job_id=99):
                msgs.append(m)
                received.set()
                # Only take first message, then break (avoid infinite loop)
                break

        task = asyncio.create_task(consumer())
        for _ in range(5):
            await asyncio.sleep(0)
        print(f"Subscribers registered: {bus._subscribers}")
        bus.publish(99, "stage", {"name": "test"})
        print(f"Queue sizes: {[q.qsize() for q in bus._subscribers.get(99, [])]}")
        await asyncio.wait_for(received.wait(), timeout=5.0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert len(msgs) == 1
        print(f"Messages received: {msgs}")

    asyncio.run(_run())
