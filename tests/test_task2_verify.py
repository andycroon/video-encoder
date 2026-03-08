"""Verification tests for Task 2 (04-03): /stream endpoint and scheduler SSE wiring."""
import inspect
from encoder.main import app
from encoder.sse import event_bus, EventBus
from encoder.scheduler import Scheduler


def test_stream_route_registered():
    routes = [r.path for r in app.routes]
    assert "/jobs/{job_id}/stream" in routes, f"Missing /stream route. Routes: {routes}"


def test_event_bus_singleton_imported_in_main():
    import encoder.main as m
    assert hasattr(m, "event_bus"), "event_bus not imported in main.py"


def test_scheduler_uses_event_bus():
    src = inspect.getsource(Scheduler._run_job)
    assert "event_bus" in src, "event_bus not used in Scheduler._run_job"


def test_scheduler_publishes_stage_event():
    src = inspect.getsource(Scheduler._run_job)
    assert '"stage"' in src, "stage event not published in _run_job"


def test_scheduler_publishes_job_complete_event():
    src = inspect.getsource(Scheduler._run_job)
    assert '"job_complete"' in src, "job_complete event not published in _run_job"


def test_scheduler_publishes_error_event():
    src = inspect.getsource(Scheduler._run_job)
    assert '"error"' in src, "error event not published in _run_job"


def test_disk_preflight_publishes_warning():
    from encoder.scheduler import _disk_preflight
    src = inspect.getsource(_disk_preflight)
    assert "event_bus" in src, "event_bus not used in _disk_preflight"
    assert '"warning"' in src, "warning event not published in _disk_preflight"


def test_stream_response_media_type():
    """Check that the /stream endpoint handler sets text/event-stream media type."""
    import encoder.main as m
    # Find the stream_job handler
    src = inspect.getsource(m.stream_job)
    assert "text/event-stream" in src, "Missing text/event-stream media type"
    assert "StreamingResponse" in src, "Missing StreamingResponse"
