"""
10-step video encoding pipeline.

Pipeline steps:
  1. FFV1 intermediate encode  — source MKV -> lossless FFV1 .mov
  2. Scene detection           — PySceneDetect finds cut boundaries
  3. Chunk splitting           — ffmpeg segments FFV1 at scene boundaries
  4. Audio transcode           — source audio -> FLAC -> target codec
  5. Per-chunk x264 encode     — encode each chunk at starting CRF
  6. VMAF scoring              — compare encoded chunk against FFV1 source
  7. CRF feedback loop         — adjust CRF ±1 until VMAF lands in [vmaf_min, vmaf_max]
  8. Write concat list         — generate ffmpeg concat demuxer manifest
  9. Concat + mux              — merge encoded chunks + audio -> final MKV
 10. Cleanup                   — remove CHUNKS, ENCODED, TEMP subdirectories

Entry points:
  CLI:  python -m encoder.pipeline source.mkv [--config ...] [--output-dir ...] [--temp-dir ...]
  API:  from encoder.pipeline import run_pipeline
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from encoder.ffmpeg import FfmpegError, run_ffmpeg

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FFMPEG: str = shutil.which("ffmpeg") or "C:/ffmpeg/ffmpeg.exe"

VMAF_MODEL: Path = Path(__file__).parent.parent.parent / "assets" / "vmaf_v0.6.1.json"

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class PipelineError(Exception):
    """Raised when the pipeline encounters an unrecoverable error."""

    def __init__(self, message: str, status: str = "FAILED") -> None:
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: dict = {
    "vmaf_min": 96.2,
    "vmaf_max": 97.6,
    "crf_start": 17,
    "crf_min": 16,
    "crf_max": 20,
    "audio_codec": "eac3",
    "x264_params": {
        "partitions": "i4x4+p8x8+b8x8",
        "trellis": "2",
        "deblock": "-3:-3",
        "subq": "10",
        "me_method": "umh",
        "me_range": "24",
        "b_strategy": "2",
        "bf": "2",
        "sc_threshold": "0",
        "g": "48",
        "keyint_min": "48",
        "maxrate": "12000K",
        "bufsize": "24000k",
        "qmax": "40",
        "qcomp": "0.50",
        "b_qfactor": "1",
        "i_qfactor": "0.71",
        "flags": "-loop",
    },
}

# ---------------------------------------------------------------------------
# Private helper stubs (all raise NotImplementedError until plans 02-04)
# ---------------------------------------------------------------------------


def _ffv1_encode(source_path: Path, output_path: Path) -> None:
    """Encode source to FFV1 lossless intermediate."""
    cmd = [
        FFMPEG, "-y", "-i", str(source_path),
        "-sn", "-an",
        "-c:v", "ffv1", "-level", "3", "-threads", "4",
        "-coder", "1", "-context", "1", "-slicecrc", "1",
        "-slices", "24", "-g", "1",
        str(output_path),
    ]
    try:
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass
    except FfmpegError as e:
        raise PipelineError(f"FFV1 encode failed: {e}") from e


def _detect_scenes(source_path: Path, threshold: float = 27.0) -> list[float]:
    """Run PySceneDetect on source; return list of scene boundary timestamps in seconds.

    Raises PipelineError if no scenes are detected.
    """
    from scenedetect import ContentDetector, detect

    scenes = detect(str(source_path), ContentDetector(threshold=threshold))
    if not scenes:
        raise PipelineError(f"No scenes detected in {source_path}")
    # scenes[0] starts at 0 — skip it; return start times of subsequent scenes
    boundaries = [scene[0].get_seconds() for scene in scenes[1:]]
    return boundaries


# ---------------------------------------------------------------------------
# Audio codec dispatch table
# ---------------------------------------------------------------------------

AUDIO_CODECS: dict = {
    "eac3": (["-c:a", "eac3"], "eac3"),
    "aac":  (["-c:a", "aac"],  "m4a"),
    "flac": (["-c:a", "flac"], "flac"),
    "copy": (["-c:a", "copy"], "mka"),
}


def _audio_cmd(ffmpeg_bin: str, source_path: Path, output_path: Path, codec: str) -> list:
    """Build full ffmpeg command for audio transcoding."""
    flags, _ext = AUDIO_CODECS[codec]
    return [ffmpeg_bin, "-y", "-i", str(source_path), "-vn"] + flags + [str(output_path)]


def _split_chunks(ffv1_path: Path, timestamps: list[float], chunks_dir: Path) -> list[Path]:
    """Split FFV1 intermediate into per-scene chunk files."""
    chunk_pattern = str(chunks_dir / "chunk%06d.mov")

    if timestamps:
        segment_times = ",".join(f"{t:.6f}" for t in timestamps)
        cmd = [
            FFMPEG, "-y", "-i", str(ffv1_path),
            "-c:v", "copy", "-an",
            "-f", "segment",
            "-segment_times", segment_times,
            "-reset_timestamps", "1",
            chunk_pattern,
        ]
    else:
        # Single scene — copy whole file as chunk000000.mov
        cmd = [
            FFMPEG, "-y", "-i", str(ffv1_path),
            "-c:v", "copy", "-an",
            str(chunks_dir / "chunk000000.mov"),
        ]

    try:
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass
    except FfmpegError as e:
        raise PipelineError(f"Chunk split failed: {e}") from e

    chunks = sorted(chunks_dir.glob("chunk*.mov"))
    if not chunks:
        raise PipelineError("No chunks produced by chunk split")
    return chunks


def _transcode_audio(source_path: Path, output_path: Path, codec: str = "eac3") -> None:
    """Transcode audio track from source to target codec."""
    flags, _ext = AUDIO_CODECS[codec]
    cmd = [FFMPEG, "-y", "-i", str(source_path), "-vn"] + flags + [str(output_path)]
    try:
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass
    except FfmpegError as e:
        raise PipelineError(f"Audio transcode failed: {e}") from e


def _encode_chunk_x264(
    chunk_path: Path,
    output_path: Path,
    crf: int,
    config: dict,
    *,
    is_first: bool = True,
) -> None:
    """Encode a single FFV1 chunk to x264 at the given CRF."""
    raise NotImplementedError


def _vmaf_score(encoded_path: Path, reference_path: Path) -> float:
    """Return VMAF score (0–100) for encoded chunk compared against FFV1 reference."""
    raise NotImplementedError


def _encode_chunk_with_vmaf(
    chunk_path: Path,
    encoded_path: Path,
    config: dict,
    cancel_event=None,
) -> tuple[int, float, int]:
    """Run the CRF feedback loop for a single chunk.

    Returns (final_crf, final_vmaf, iterations).
    Raises PipelineError if CRF bounds are exhausted without hitting target range.
    """
    raise NotImplementedError


def _write_concat_list(encoded_chunks: list[Path], concat_list_path: Path) -> None:
    """Write an ffmpeg concat demuxer manifest."""
    raise NotImplementedError


def _concat_chunks(concat_list_path: Path, output_path: Path) -> None:
    """Concatenate encoded chunks into a single video file using ffmpeg concat demuxer."""
    raise NotImplementedError


def _mux_video_audio(video_path: Path, audio_path: Path, output_path: Path) -> None:
    """Mux video and audio streams into final MKV."""
    raise NotImplementedError


def _cleanup(temp_dir: Path) -> None:
    """Remove CHUNKS, ENCODED, and TEMP subdirectories under temp_dir."""
    raise NotImplementedError


def _x264_params_str(params: dict) -> str:
    """Convert x264_params dict to colon-separated key=value string for -x264-params."""
    raise NotImplementedError


def _check_cancel(cancel_event) -> None:
    """Raise PipelineError(status='CANCELLED') if cancel_event is set."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# Public pipeline entry point
# ---------------------------------------------------------------------------


async def run_pipeline(
    source_path,
    db_path,
    job_id: int,
    config: dict,
    cancel_event,
    output_dir,
    temp_dir,
) -> None:
    """Run the full 10-step encoding pipeline.

    Args:
        source_path: Path to source MKV file.
        db_path: Path to SQLite database file.
        job_id: Existing job row ID in the database.
        config: Encoding configuration dict (see DEFAULT_CONFIG).
        cancel_event: threading.Event — pipeline polls this between steps.
        output_dir: Destination directory for the final MKV.
        temp_dir: Working directory for intermediates, chunks, and encoded files.
    """
    raise NotImplementedError


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _cli() -> None:
    """Command-line interface: python -m encoder.pipeline source.mkv [options]"""
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Encode a source MKV through the full pipeline.")
    parser.add_argument("source", help="Path to source MKV file")
    parser.add_argument("--config", help="Path to config JSON file (optional)")
    parser.add_argument("--output-dir", default="./output", help="Output directory (default: ./output)")
    parser.add_argument("--temp-dir", default="./temp", help="Temp directory (default: ./temp)")
    parser.add_argument("--scene-threshold", type=float, default=27.0, help="Scene detection threshold (default: 27)")
    args = parser.parse_args()

    import json
    import threading

    config = dict(DEFAULT_CONFIG)
    if args.config:
        with open(args.config) as f:
            config.update(json.load(f))

    cancel_event = threading.Event()

    db_path = Path(args.temp_dir) / "encoder.db"

    asyncio.run(
        run_pipeline(
            source_path=Path(args.source),
            db_path=db_path,
            job_id=0,
            config=config,
            cancel_event=cancel_event,
            output_dir=Path(args.output_dir),
            temp_dir=Path(args.temp_dir),
        )
    )


if __name__ == "__main__":
    _cli()
