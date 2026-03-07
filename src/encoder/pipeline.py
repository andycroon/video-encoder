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

import json
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from encoder.db import (
    append_job_log,
    create_chunk,
    create_step,
    init_db,
    recover_stale_jobs,
    update_chunk,
    update_job_status,
    update_step,
    create_job,
)
from encoder.ffmpeg import FfmpegError, escape_vmaf_path, run_ffmpeg

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
    x264_params = config.get("x264_params", {})
    params_str = _x264_params_str(x264_params)
    cmd = [FFMPEG, "-y", "-i", str(chunk_path),
           "-c:v", "libx264", "-crf", str(crf)]
    if params_str:
        cmd += ["-x264-params", params_str]
    cmd += ["-an", str(output_path)]
    try:
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass
    except FfmpegError as e:
        raise PipelineError(f"x264 encode failed: {e}") from e


def _vmaf_score(encoded_path: Path, reference_path: Path) -> float:
    """Return VMAF score (0–100) for encoded chunk compared against FFV1 reference."""
    import os
    log_fd, log_path_str = tempfile.mkstemp(suffix=".json")
    os.close(log_fd)
    log_path = Path(log_path_str)
    try:
        escaped_log = escape_vmaf_path(log_path)
        # Use built-in model version string to avoid Windows path escaping issues.
        # The ffmpeg build has vmaf_v0.6.1 compiled in; model='path=...' syntax
        # fails on Windows due to colon-in-path parsing in lavfi filter strings.
        filter_graph = (
            "[0:v]setpts=PTS-STARTPTS,format=yuv420p[dist];"
            "[1:v]setpts=PTS-STARTPTS,format=yuv420p[ref];"
            f"[dist][ref]libvmaf=model='version=vmaf_v0.6.1'"
            f":log_fmt=json:log_path='{escaped_log}':n_threads=4"
        )
        cmd = [FFMPEG, "-y",
               "-i", str(encoded_path),
               "-i", str(reference_path),
               "-lavfi", filter_graph,
               "-f", "null", "-"]
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass

        vmaf: float | None = None

        # Try pooled_metrics from JSON log
        if log_path.exists() and log_path.stat().st_size > 0:
            try:
                with open(log_path) as f:
                    data = json.load(f)
                vmaf = data["pooled_metrics"]["vmaf"]["mean"]
            except (KeyError, json.JSONDecodeError):
                # Fallback: average frames
                try:
                    frames = data.get("frames", [])
                    if frames:
                        scores = [fr["metrics"]["vmaf"] for fr in frames]
                        vmaf = sum(scores) / len(scores)
                except (KeyError, TypeError):
                    pass

        # Fallback: stderr regex
        if vmaf is None:
            for line in proc.stderr_lines:
                m = re.search(r"VMAF score:\s*([\d.]+)", line)
                if m:
                    vmaf = float(m.group(1))
                    break

        if vmaf is None:
            raise PipelineError("VMAF score could not be determined from log or stderr")

        return float(vmaf)
    finally:
        log_path.unlink(missing_ok=True)


def _encode_chunk_with_vmaf(
    chunk_path: Path,
    encoded_path: Path,
    config: dict,
    cancel_event=None,
    chunk_label: str = "chunk",
) -> tuple[int, float, int]:
    """Run the CRF feedback loop for a single chunk.

    Returns (final_crf, final_vmaf, iterations).
    """
    crf: int = config["crf_start"]
    vmaf_min: float = config["vmaf_min"]
    vmaf_max: float = config["vmaf_max"]
    crf_min: int = config["crf_min"]
    crf_max: int = config["crf_max"]

    visited_crfs: set[int] = set()
    best_crf: int = crf
    best_vmaf: float = 0.0
    status: str = "pass"

    for i in range(10):
        _check_cancel(cancel_event)

        _encode_chunk_x264(chunk_path, encoded_path, crf, config)
        vmaf = _vmaf_score(encoded_path, chunk_path)

        best_crf = crf
        best_vmaf = vmaf

        if vmaf_min <= vmaf <= vmaf_max:
            status = "pass"
            break

        if crf in visited_crfs:
            status = "oscillation"
            break

        visited_crfs.add(crf)

        if vmaf < vmaf_min and crf > crf_min:
            crf -= 1
        elif vmaf > vmaf_max and crf < crf_max:
            crf += 1
        else:
            status = "bounds"
            break
    else:
        status = "maxiter"

    print(f"[{chunk_label}] CRF {best_crf} -> VMAF {best_vmaf:.2f} ({status})")
    return (best_crf, best_vmaf, len(visited_crfs) + 1)


def _write_concat_list(encoded_chunks: list[Path], concat_list_path: Path) -> None:
    """Write an ffmpeg concat demuxer manifest."""
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for chunk in encoded_chunks:
            f.write(f"file '{chunk.as_posix()}'\n")


def _concat_chunks(concat_list_path: Path, output_path: Path) -> None:
    """Concatenate encoded chunks into a single video file using ffmpeg concat demuxer."""
    cmd = [
        FFMPEG, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list_path),
        "-c", "copy",
        str(output_path),
    ]
    try:
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass
    except FfmpegError as e:
        raise PipelineError(f"Concat failed: {e}") from e


def _mux_video_audio(video_path: Path, audio_path: Path, output_path: Path) -> None:
    """Mux video and audio streams into final MKV."""
    cmd = [
        FFMPEG, "-y",
        "-i", str(video_path),
        "-i", str(audio_path),
        "-c:v", "copy", "-c:a", "copy",
        str(output_path),
    ]
    try:
        proc = run_ffmpeg(cmd)
        for _ in proc:
            pass
    except FfmpegError as e:
        raise PipelineError(f"Mux failed: {e}") from e


def _cleanup(temp_dir: Path) -> None:
    """Remove CHUNKS, ENCODED, and TEMP subdirectories under temp_dir."""
    for subdir in ["chunks", "encoded", "intermediate"]:
        path = temp_dir / subdir
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
    for f in temp_dir.glob("*"):
        if f.is_file():
            try:
                f.unlink()
            except OSError:
                pass


def _x264_params_str(params: dict) -> str:
    """Convert x264_params dict to colon-separated key=value string for -x264-params."""
    if not params:
        return ""
    return ":".join(f"{k}={v}" for k, v in params.items())


def _check_cancel(cancel_event) -> None:
    """Raise PipelineError(status='CANCELLED') if cancel_event is set."""
    if cancel_event is not None and cancel_event.is_set():
        raise PipelineError("Job cancelled", status="CANCELLED")


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
    source_path = Path(source_path)
    db_path = str(db_path)
    output_dir = Path(output_dir)
    temp_dir = Path(temp_dir)

    chunks_dir = temp_dir / "chunks"
    encoded_dir = temp_dir / "encoded"
    intermediate_dir = temp_dir / "intermediate"

    for d in [output_dir, chunks_dir, encoded_dir, intermediate_dir]:
        d.mkdir(parents=True, exist_ok=True)

    intermediate = intermediate_dir / "intermediate.mov"

    try:
        await update_job_status(db_path, job_id, "RUNNING")

        _check_cancel(cancel_event)

        # Step 1: FFV1 encode
        step_id = await create_step(db_path, job_id, "FFV1")
        print("[FFV1] Encoding intermediate...")
        t0 = time.monotonic()
        _ffv1_encode(source_path, intermediate)
        await update_step(db_path, step_id, "DONE")
        print(f"[FFV1] done ({time.monotonic() - t0:.0f}s)")

        _check_cancel(cancel_event)

        # Step 2: Scene detect
        step_id = await create_step(db_path, job_id, "SceneDetect")
        print("[SceneDetect] Detecting scenes...")
        t0 = time.monotonic()
        scene_threshold = config.get("scene_threshold", 27.0)
        scenes = _detect_scenes(intermediate, scene_threshold)
        await update_step(db_path, step_id, "DONE")
        print(f"[SceneDetect] {len(scenes)} scenes, done ({time.monotonic() - t0:.0f}s)")

        _check_cancel(cancel_event)

        # Step 3: Chunk split
        step_id = await create_step(db_path, job_id, "ChunkSplit")
        print("[ChunkSplit] Splitting chunks...")
        t0 = time.monotonic()
        chunks = _split_chunks(intermediate, scenes, chunks_dir)
        await update_step(db_path, step_id, "DONE")
        print(f"[ChunkSplit] {len(chunks)} chunks, done ({time.monotonic() - t0:.0f}s)")

        _check_cancel(cancel_event)

        # Step 4: Audio transcode
        step_id = await create_step(db_path, job_id, "AudioTranscode")
        print("[AudioTranscode] Transcoding audio...")
        t0 = time.monotonic()
        audio_codec = config.get("audio_codec", "eac3")
        _flags, audio_ext = AUDIO_CODECS[audio_codec]
        audio_file = temp_dir / f"audio.{audio_ext}"
        _transcode_audio(source_path, audio_file, codec=audio_codec)
        await update_step(db_path, step_id, "DONE")
        print(f"[AudioTranscode] done ({time.monotonic() - t0:.0f}s)")

        _check_cancel(cancel_event)

        # Steps 5-7: Per-chunk CRF+VMAF feedback loop
        total = len(chunks)
        encoded_chunks = []
        for i, chunk_in in enumerate(chunks, 1):
            _check_cancel(cancel_event)
            chunk_out = encoded_dir / chunk_in.name
            chunk_id = await create_chunk(db_path, job_id, i - 1)
            chunk_label = f"Chunk {i}/{total}"
            crf, vmaf, iters = _encode_chunk_with_vmaf(
                chunk_in, chunk_out, config, cancel_event, chunk_label
            )
            await update_chunk(
                db_path,
                chunk_id,
                crf_used=float(crf),
                vmaf_score=vmaf,
                iterations=iters,
                status="DONE",
            )
            await append_job_log(
                db_path, job_id,
                f"[{chunk_label}] CRF {crf} -> VMAF {vmaf:.2f} ({iters} iter)"
            )
            encoded_chunks.append(chunk_out)

        _check_cancel(cancel_event)

        # Step 8: Concat
        step_id = await create_step(db_path, job_id, "Concat")
        print("[Concat] Concatenating chunks...")
        t0 = time.monotonic()
        concat_mp4 = temp_dir / "concat.mp4"
        concat_list = temp_dir / "concat_list.txt"
        _write_concat_list(encoded_chunks, concat_list)
        _concat_chunks(concat_list, concat_mp4)
        await update_step(db_path, step_id, "DONE")
        print(f"[Concat] done ({time.monotonic() - t0:.0f}s)")

        _check_cancel(cancel_event)

        # Step 9: Mux
        step_id = await create_step(db_path, job_id, "Mux")
        print("[Mux] Muxing video and audio...")
        t0 = time.monotonic()
        output_mkv = output_dir / (source_path.stem + ".mkv")
        _mux_video_audio(concat_mp4, audio_file, output_mkv)
        await update_step(db_path, step_id, "DONE")
        print(f"[Mux] done ({time.monotonic() - t0:.0f}s)")

        await update_job_status(db_path, job_id, "DONE")
        print(f"[Done] Output: {output_mkv}")

    except PipelineError as e:
        status = getattr(e, "status", "FAILED")
        await update_job_status(db_path, job_id, status)
        if status != "CANCELLED":
            raise
    finally:
        # Step 10: Cleanup — always, regardless of outcome
        _cleanup(temp_dir)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _cli() -> None:
    """Command-line interface: python -m encoder.pipeline source.mkv [options]"""
    import argparse
    import asyncio
    import signal
    import threading

    parser = argparse.ArgumentParser(description="Encode a source MKV through the full pipeline.")
    parser.add_argument("source", help="Path to source MKV file")
    parser.add_argument("--config", help="Path to config JSON file (optional)")
    parser.add_argument("--output-dir", default="./output", help="Output directory (default: ./output)")
    parser.add_argument("--temp-dir", default="./temp", help="Temp directory (default: ./temp)")
    parser.add_argument("--scene-threshold", type=float, default=27.0, help="Scene detection threshold (default: 27)")
    args = parser.parse_args()

    config = dict(DEFAULT_CONFIG)
    if args.config:
        with open(args.config) as f:
            config.update(json.load(f))

    # Merge CLI scene-threshold into config
    config["scene_threshold"] = args.scene_threshold

    cancel_event = threading.Event()

    # SIGINT (Ctrl+C) sets cancel_event — pipeline polls between steps and cleans up
    def _sigint_handler(signum, frame):
        print("\n[Interrupted] Cancelling pipeline...")
        cancel_event.set()

    signal.signal(signal.SIGINT, _sigint_handler)

    output_dir = Path(args.output_dir)
    temp_dir = Path(args.temp_dir)
    db_path = temp_dir / "encoder.db"

    async def _main():
        # Ensure DB exists and recover stale jobs from previous runs
        await init_db(str(db_path))
        await recover_stale_jobs(str(db_path))
        job_id = await create_job(str(db_path), str(args.source), config)
        await run_pipeline(
            source_path=Path(args.source),
            db_path=db_path,
            job_id=job_id,
            config=config,
            cancel_event=cancel_event,
            output_dir=output_dir,
            temp_dir=temp_dir,
        )

    asyncio.run(_main())


if __name__ == "__main__":
    _cli()
