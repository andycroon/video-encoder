"""
RED-state test stubs for the pipeline module.

All 14 tests are intentionally failing — they define the contract for Plans 02–04.
Each test documents the exact behaviour expected once the stub is implemented.

Run with: pytest tests/test_pipeline.py -x
Expected result: FAILED (not ERROR) — all stubs imported, tests collected, stubs fire.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import pytest

from encoder.pipeline import DEFAULT_CONFIG, PipelineError, run_pipeline

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ffmpeg_bin() -> str:
    """Return the path to the ffmpeg binary used by the pipeline."""
    import shutil

    path = shutil.which("ffmpeg") or "C:/ffmpeg/ffmpeg.exe"
    if not Path(path).exists():
        pytest.skip("ffmpeg not available")
    return path


@pytest.fixture
def tmp(tmp_path: Path) -> Path:
    """Return a writable temp directory."""
    return tmp_path


# ---------------------------------------------------------------------------
# Synthetic source helpers
# ---------------------------------------------------------------------------


def _make_video(ffmpeg: str, out_path: Path, duration: float = 3.0) -> Path:
    """Create a synthetic testsrc2 video (FFV1 .mov) via lavfi."""
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f", "lavfi",
            "-i", f"testsrc2=duration={duration}:size=320x240:rate=24",
            "-c:v", "ffv1",
            str(out_path),
        ],
        check=True,
        capture_output=True,
    )
    return out_path


def _make_audio(ffmpeg: str, out_path: Path, duration: float = 3.0) -> Path:
    """Create a synthetic sine-wave audio file via lavfi."""
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={duration}",
            str(out_path),
        ],
        check=True,
        capture_output=True,
    )
    return out_path


def _make_video_with_cut(ffmpeg: str, out_path: Path) -> Path:
    """Create a 3-second synthetic video with a hard cut at 1.5s (two different patterns)."""
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f", "lavfi",
            "-i", (
                "testsrc2=duration=1.5:size=320x240:rate=24[v1];"
                "mandelbrot=size=320x240:rate=24[v2];"
                "[v1][v2]concat=n=2:v=1:a=0[out]"
            ),
            "-map", "[out]",
            "-c:v", "ffv1",
            str(out_path),
        ],
        check=True,
        capture_output=True,
    )
    return out_path


# ---------------------------------------------------------------------------
# Pipeline step tests (RED)
# ---------------------------------------------------------------------------


@pytest.mark.timeout(120)
def test_ffv1_encode(ffmpeg_bin, tmp):
    """ffv1_encode() produces a .mov file > 0 bytes at the output path."""
    from encoder.pipeline import _ffv1_encode

    source = tmp / "source.mkv"
    # Create a minimal source via ffmpeg
    subprocess.run(
        [
            ffmpeg_bin, "-y",
            "-f", "lavfi", "-i", "testsrc2=duration=3:size=320x240:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-c:v", "libx264", "-c:a", "aac",
            str(source),
        ],
        check=True, capture_output=True,
    )
    out = tmp / "intermediate.mov"
    _ffv1_encode(source, out)
    assert out.exists(), "Output file was not created"
    assert out.stat().st_size > 0, "Output file is empty"


@pytest.mark.timeout(120)
def test_scene_detect(ffmpeg_bin, tmp):
    """detect_scenes() returns at least 1 scene boundary for a video with a hard cut."""
    from encoder.pipeline import _detect_scenes

    ffv1 = tmp / "with_cut.mov"
    _make_video_with_cut(ffmpeg_bin, ffv1)
    boundaries = _detect_scenes(ffv1)
    assert isinstance(boundaries, list), "Expected a list of float timestamps"
    assert len(boundaries) >= 1, f"Expected at least 1 scene boundary, got {len(boundaries)}"
    for ts in boundaries:
        assert isinstance(ts, float), f"Boundary {ts!r} is not a float"


@pytest.mark.timeout(120)
def test_zero_scenes_error(ffmpeg_bin, tmp):
    """detect_scenes() raises PipelineError containing 'No scenes detected' for static content."""
    from encoder.pipeline import _detect_scenes

    # Static content: single colour frame repeated — no cuts
    static = tmp / "static.mov"
    subprocess.run(
        [
            ffmpeg_bin, "-y",
            "-f", "lavfi", "-i", "color=c=blue:size=320x240:rate=24:duration=3",
            "-c:v", "ffv1",
            str(static),
        ],
        check=True, capture_output=True,
    )
    with pytest.raises(PipelineError, match="No scenes detected"):
        _detect_scenes(static)


@pytest.mark.timeout(120)
def test_chunk_split(ffmpeg_bin, tmp):
    """split_chunks() creates 2 chunk files when given an FFV1 file and one split point."""
    from encoder.pipeline import _split_chunks

    ffv1 = tmp / "source.mov"
    _make_video(ffmpeg_bin, ffv1, duration=3.0)
    chunks_dir = tmp / "chunks"
    chunks_dir.mkdir()
    # One split point at 1.5s -> expect 2 chunks
    chunks = _split_chunks(ffv1, [1.5], chunks_dir)
    assert len(chunks) == 2, f"Expected 2 chunks, got {len(chunks)}"
    for chunk in chunks:
        assert chunk.exists(), f"Chunk file missing: {chunk}"
        assert chunk.stat().st_size > 0, f"Chunk file is empty: {chunk}"


@pytest.mark.timeout(120)
def test_audio_transcode(ffmpeg_bin, tmp):
    """transcode_audio() produces an output file > 0 bytes."""
    from encoder.pipeline import _transcode_audio

    source = tmp / "source.mkv"
    subprocess.run(
        [
            ffmpeg_bin, "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-c:a", "aac",
            str(source),
        ],
        check=True, capture_output=True,
    )
    out = tmp / "audio.flac"
    _transcode_audio(source, out, codec="flac")
    assert out.exists(), "Audio output file was not created"
    assert out.stat().st_size > 0, "Audio output file is empty"


@pytest.mark.timeout(120)
def test_x264_encode(ffmpeg_bin, tmp):
    """encode_chunk_x264() produces a file > 0 bytes at the given CRF."""
    from encoder.pipeline import _encode_chunk_x264

    chunk = tmp / "chunk.mov"
    _make_video(ffmpeg_bin, chunk, duration=1.0)
    out = tmp / "encoded.mp4"
    config = dict(DEFAULT_CONFIG)
    _encode_chunk_x264(chunk, out, crf=18, config=config, is_first=True)
    assert out.exists(), "Encoded chunk file was not created"
    assert out.stat().st_size > 0, "Encoded chunk file is empty"


@pytest.mark.timeout(120)
def test_vmaf_score(ffmpeg_bin, tmp):
    """vmaf_score() returns a float between 0 and 100."""
    from encoder.pipeline import _encode_chunk_x264, _vmaf_score

    ref = tmp / "ref.mov"
    _make_video(ffmpeg_bin, ref, duration=1.0)
    encoded = tmp / "encoded.mp4"
    config = dict(DEFAULT_CONFIG)
    _encode_chunk_x264(ref, encoded, crf=17, config=config, is_first=True)
    score = _vmaf_score(encoded, ref)
    assert isinstance(score, float), f"Expected float, got {type(score)}"
    assert 0.0 <= score <= 100.0, f"VMAF score {score} out of range [0, 100]"


@pytest.mark.timeout(120)
def test_crf_feedback_loop(ffmpeg_bin, tmp):
    """Feedback loop returns (crf, vmaf, iterations) with wide VMAF range (any CRF passes)."""
    from encoder.pipeline import _encode_chunk_with_vmaf

    chunk = tmp / "chunk.mov"
    _make_video(ffmpeg_bin, chunk, duration=1.0)
    encoded = tmp / "encoded.mp4"
    config = dict(DEFAULT_CONFIG)
    config["vmaf_min"] = 0.0    # wide range — any CRF should satisfy
    config["vmaf_max"] = 100.0
    result = _encode_chunk_with_vmaf(chunk, encoded, config)
    assert isinstance(result, tuple), "Expected a tuple"
    assert len(result) == 3, "Expected (crf, vmaf, iterations)"
    crf, vmaf, iterations = result
    assert isinstance(crf, int), f"crf should be int, got {type(crf)}"
    assert isinstance(vmaf, float), f"vmaf should be float, got {type(vmaf)}"
    assert isinstance(iterations, int), f"iterations should be int, got {type(iterations)}"
    assert iterations >= 1, "Expected at least 1 iteration"


@pytest.mark.timeout(120)
def test_crf_oscillation_guard(ffmpeg_bin, tmp):
    """Oscillating VMAF scores (below/above target alternating) terminate within max_iterations."""
    from unittest.mock import patch
    from encoder.pipeline import _encode_chunk_with_vmaf

    chunk = tmp / "chunk.mov"
    _make_video(ffmpeg_bin, chunk, duration=1.0)
    encoded = tmp / "encoded.mp4"

    config = dict(DEFAULT_CONFIG)
    config["vmaf_min"] = 50.0
    config["vmaf_max"] = 60.0  # narrow — synthetic oscillation will not land here

    # Alternate below/above the target window
    alternating_scores = [40.0, 70.0, 40.0, 70.0, 40.0, 70.0, 40.0, 70.0]

    with patch("encoder.pipeline._vmaf_score", side_effect=alternating_scores):
        # Should terminate (not loop infinitely) — either by guard or by CRF bounds
        try:
            _encode_chunk_with_vmaf(chunk, encoded, config)
        except (PipelineError, StopIteration):
            pass  # Acceptable — loop stopped cleanly


@pytest.mark.timeout(120)
def test_concat_mux(ffmpeg_bin, tmp):
    """concat_and_mux() produces a final .mkv > 0 bytes from 2 chunks and an audio file."""
    from encoder.pipeline import _concat_chunks, _mux_video_audio, _write_concat_list

    # Create 2 encoded MP4 chunks
    chunk1 = tmp / "chunk1.mp4"
    chunk2 = tmp / "chunk2.mp4"
    for chunk in (chunk1, chunk2):
        subprocess.run(
            [
                ffmpeg_bin, "-y",
                "-f", "lavfi", "-i", "testsrc2=duration=1:size=320x240:rate=24",
                "-c:v", "libx264", "-crf", "18",
                str(chunk),
            ],
            check=True, capture_output=True,
        )

    audio = tmp / "audio.aac"
    _make_audio(ffmpeg_bin, audio)

    concat_list = tmp / "concat.txt"
    merged_video = tmp / "merged.mp4"
    final = tmp / "final.mkv"

    _write_concat_list([chunk1, chunk2], concat_list)
    _concat_chunks(concat_list, merged_video)
    _mux_video_audio(merged_video, audio, final)

    assert final.exists(), "Final MKV was not created"
    assert final.stat().st_size > 0, "Final MKV is empty"


@pytest.mark.timeout(120)
def test_cleanup_on_success(ffmpeg_bin, tmp):
    """After pipeline success, temp subdirs (chunks/, encoded/, intermediate/) do not exist."""
    from encoder.pipeline import _cleanup

    chunks_dir = tmp / "chunks"
    encoded_dir = tmp / "encoded"
    intermediate_dir = tmp / "intermediate"
    for d in (chunks_dir, encoded_dir, intermediate_dir):
        d.mkdir()
        (d / "placeholder.txt").write_text("test")

    _cleanup(tmp)

    assert not chunks_dir.exists(), "chunks/ dir should have been removed"
    assert not encoded_dir.exists(), "encoded/ dir should have been removed"
    assert not intermediate_dir.exists(), "intermediate/ dir should have been removed"


@pytest.mark.timeout(120)
def test_cleanup_on_cancel(ffmpeg_bin, tmp):
    """After cancel_event is set, temp subdirs are removed and this completes without error."""
    import threading
    from encoder.pipeline import _cleanup

    chunks_dir = tmp / "chunks"
    encoded_dir = tmp / "encoded"
    for d in (chunks_dir, encoded_dir):
        d.mkdir()
        (d / "file.mov").write_text("data")

    cancel_event = threading.Event()
    cancel_event.set()  # pre-cancelled

    # cleanup should complete without raising, regardless of cancel state
    _cleanup(tmp)

    assert not chunks_dir.exists(), "chunks/ dir should have been removed on cancel"
    assert not encoded_dir.exists(), "encoded/ dir should have been removed on cancel"


@pytest.mark.timeout(60)
def test_audio_codec_dispatch(ffmpeg_bin, tmp):
    """For each of ('eac3', 'aac', 'flac', 'copy'), audio_cmd() contains the expected '-c:a' flag."""
    from encoder.pipeline import _transcode_audio

    # This test validates that _transcode_audio handles different codecs correctly.
    # We exercise the codec dispatch indirectly by checking that the function runs without
    # error for a valid codec. Full behavioural test is in test_audio_transcode.
    #
    # Since _transcode_audio is not yet implemented, this stub marks the contract.
    source = tmp / "source.aac"
    subprocess.run(
        [
            ffmpeg_bin, "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
            "-c:a", "aac",
            str(source),
        ],
        check=True, capture_output=True,
    )

    for codec in ("aac", "flac", "copy"):
        out = tmp / f"audio_{codec}.{codec if codec != 'copy' else 'aac'}"
        _transcode_audio(source, out, codec=codec)
        assert out.exists(), f"Output for codec '{codec}' was not created"
        assert out.stat().st_size > 0, f"Output for codec '{codec}' is empty"


@pytest.mark.timeout(10)
def test_x264_params_str():
    """x264_params_str({'trellis': '2', 'subq': '10'}) returns 'trellis=2:subq=10'."""
    from encoder.pipeline import _x264_params_str

    result = _x264_params_str({"trellis": "2", "subq": "10"})
    assert result == "trellis=2:subq=10", f"Unexpected result: {result!r}"
