import sys
import pytest
from encoder.ffmpeg import run_ffmpeg, escape_vmaf_path, FfmpegError

FFMPEG_BIN = "C:/ffmpeg/ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
NULL_DEVICE = "NUL" if sys.platform == "win32" else "/dev/null"


@pytest.mark.timeout(30)
def test_progress_events_emitted():
    """run_ffmpeg yields progress events with frame/fps data for a real encode."""
    cmd = [
        FFMPEG_BIN,
        "-f", "lavfi",
        "-i", "testsrc=duration=3:size=320x240:rate=25",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-f", "null",
        NULL_DEVICE,
    ]
    gen = run_ffmpeg(cmd)
    events = list(gen)

    assert len(events) > 0, "Expected at least one event"
    # All events have raw_line (full unfiltered stderr)
    for event in events:
        assert "raw_line" in event, f"Event missing 'raw_line': {event}"
    # At least one event should be a parsed progress line with frame data
    progress_events = [e for e in events if "frame" in e and isinstance(e["frame"], int)]
    assert len(progress_events) > 0, "Expected at least one parsed progress event with frame key"


@pytest.mark.timeout(15)
def test_cancel_graceful():
    """Cancelling an in-progress encode exits cleanly without raising FfmpegError."""
    cmd = [
        FFMPEG_BIN,
        "-f", "lavfi",
        "-i", "testsrc=duration=60:size=320x240:rate=25",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-f", "null",
        NULL_DEVICE,
    ]
    gen = run_ffmpeg(cmd)

    # Get first event to confirm encoding has started
    first_event = next(gen)
    assert first_event is not None

    # Cancel the encode
    gen.cancel()

    # Drain remaining events — should complete without exception
    try:
        for _ in gen:
            pass
    except FfmpegError:
        pytest.fail("Cancellation should not raise FfmpegError — cancel is graceful exit")

    # If we reach here, the Python process is alive (implicit assertion)


@pytest.mark.timeout(10)
def test_error_on_bad_command():
    """run_ffmpeg raises FfmpegError with returncode and stderr when ffmpeg fails."""
    cmd = [
        FFMPEG_BIN,
        "-i", "nonexistent_file_xyz_does_not_exist.mp4",
        "-f", "null",
        NULL_DEVICE,
    ]
    with pytest.raises(FfmpegError) as exc_info:
        # Exhaust the generator to trigger error
        for _ in run_ffmpeg(cmd):
            pass

    err = exc_info.value
    assert err.returncode != 0, "Expected non-zero returncode on failure"
    assert len(err.stderr) > 0, "Expected non-empty stderr on failure"
    assert (
        "nonexistent" in err.stderr.lower() or "no such file" in err.stderr.lower()
    ), f"Expected error message about missing file in stderr, got: {err.stderr[:200]}"


def test_escape_vmaf_path_windows():
    """escape_vmaf_path applies Windows drive-letter colon escaping on win32 only."""
    # Forward-slash input
    forward_slash_path = "C:/path/to/vmaf_v0.6.1.json"
    result_forward = escape_vmaf_path(forward_slash_path)

    if sys.platform == "win32":
        assert result_forward == "C\\:/path/to/vmaf_v0.6.1.json", (
            f"Expected 'C\\\\:/path/to/vmaf_v0.6.1.json', got {result_forward!r}"
        )
    else:
        assert result_forward == "C:/path/to/vmaf_v0.6.1.json", (
            f"On non-Windows, path should be unchanged, got {result_forward!r}"
        )

    # Backslash input (Windows-style)
    backslash_path = "C:\\path\\to\\vmaf_v0.6.1.json"
    result_backslash = escape_vmaf_path(backslash_path)

    if sys.platform == "win32":
        assert result_backslash == "C\\:/path/to/vmaf_v0.6.1.json", (
            f"Expected backslash input to be normalized, got {result_backslash!r}"
        )
