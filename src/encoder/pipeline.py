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

import asyncio
import concurrent.futures
import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from encoder.db import (
    append_job_log,
    create_chunk,
    create_step,
    get_chunks,
    get_steps,
    init_db,
    recover_stale_jobs,
    set_job_eta,
    set_job_total_chunks,
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
FFPROBE: str = shutil.which("ffprobe") or "C:/ffmpeg/ffprobe.exe"

VMAF_MODEL: Path = Path(__file__).parent.parent.parent / "assets" / "vmaf_v0.6.1.json"

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class PipelineError(Exception):
    """Raised when the pipeline encounters an unrecoverable error."""

    def __init__(self, message: str, status: str = "FAILED") -> None:
        super().__init__(message)
        self.status = status


def _run_ffmpeg_cancellable(cmd: list, cancel_event=None, on_progress=None, on_started=None) -> None:
    """Run an ffmpeg command. Calls on_progress(line) throttled to ~0.5s, always emitting the final line.

    on_started: optional callable(proc) called with the FfmpegProcess once the subprocess starts
                (after first stderr event — at that point _proc is guaranteed to be set).
    """
    proc = run_ffmpeg(cmd)
    _started_notified = False
    _last_emit = 0.0
    _last_line = None
    for event in proc:
        if not _started_notified:
            _started_notified = True
            if on_started is not None:
                on_started(proc)
        if cancel_event and cancel_event.is_set():
            proc.cancel()
            raise PipelineError("Job cancelled", status="CANCELLED")
        if on_progress:
            _last_line = event["raw_line"]
            now = time.monotonic()
            if now - _last_emit >= 0.5:
                on_progress(_last_line)
                _last_emit = now
    # If process never yielded an event (instant finish), still notify on_started
    if not _started_notified and on_started is not None:
        on_started(proc)
    # Always emit the final progress line so short operations show something
    if on_progress and _last_line:
        on_progress(_last_line)


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
        "b_qfactor": "1",
        "i_qfactor": "0.71",
        "qcomp": "0.50",
        "maxrate": "12000K",
        "bufsize": "24000k",
        "qmax": "40",
        "subq": "10",
        "me_method": "umh",
        "me_range": "24",
        "b_strategy": "2",
        "bf": "2",
        "sc_threshold": "0",
        "g": "48",
        "keyint_min": "48",
        "flags": "-loop",
    },
}

# ---------------------------------------------------------------------------
# Private helper stubs (all raise NotImplementedError until plans 02-04)
# ---------------------------------------------------------------------------


def _ffv1_encode(source_path: Path, output_path: Path, cancel_event=None, on_progress=None) -> None:
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
        _run_ffmpeg_cancellable(cmd, cancel_event, on_progress=on_progress)
    except FfmpegError as e:
        raise PipelineError(f"FFV1 encode failed: {e}") from e


class _StderrCapture:
    """Redirect stderr to a callback — used to capture tqdm progress from PySceneDetect."""
    def __init__(self, callback):
        self._callback = callback

    def write(self, s: str) -> int:
        line = s.strip()
        if line:
            self._callback(line)
        return len(s)

    def flush(self) -> None:
        pass


def _detect_scenes(source_path: Path, threshold: float = 27.0, on_progress=None) -> list[float]:
    """Run PySceneDetect on source; return list of scene boundary timestamps in seconds.

    Raises PipelineError if no scenes are detected.
    """
    import sys
    from scenedetect import ContentDetector, detect

    show = on_progress is not None
    old_stderr = sys.stderr
    try:
        if show:
            sys.stderr = _StderrCapture(on_progress)
        scenes = detect(str(source_path), ContentDetector(threshold=threshold), show_progress=show)
    finally:
        sys.stderr = old_stderr

    if not scenes:
        raise PipelineError(f"No scenes detected in {source_path}")
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


def _split_chunks(ffv1_path: Path, timestamps: list[float], chunks_dir: Path, cancel_event=None, on_progress=None) -> list[Path]:
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
        _run_ffmpeg_cancellable(cmd, cancel_event, on_progress=on_progress)
    except FfmpegError as e:
        raise PipelineError(f"Chunk split failed: {e}") from e

    chunks = sorted(chunks_dir.glob("chunk*.mov"))
    if not chunks:
        raise PipelineError("No chunks produced by chunk split")
    return chunks


def _transcode_audio(source_path: Path, output_path: Path, codec: str = "eac3", cancel_event=None, on_progress=None) -> None:
    """Transcode audio track from source to target codec."""
    flags, _ext = AUDIO_CODECS[codec]
    cmd = [FFMPEG, "-y", "-i", str(source_path), "-vn"] + flags + [str(output_path)]
    try:
        _run_ffmpeg_cancellable(cmd, cancel_event, on_progress=on_progress)
    except FfmpegError as e:
        raise PipelineError(f"Audio transcode failed: {e}") from e


def _extract_subtitles(
    source_path: Path,
    subtitle_dir: Path,
    tesseract_lang: str = "eng",
    cancel_event=None,
    on_progress=None,
) -> list[tuple[Path, str]]:
    """Extract PGS subtitle streams from source and OCR-convert to SRT.

    Returns list of (srt_path, language_tag) for each successfully converted stream.
    Streams that fail conversion are warned and skipped — not a fatal error.
    """
    import json as _json

    probe_cmd = [
        FFPROBE, "-v", "quiet",
        "-print_format", "json",
        "-show_streams", "-select_streams", "s",
        str(source_path),
    ]
    result = subprocess.run(probe_cmd, capture_output=True, text=True)
    try:
        streams = _json.loads(result.stdout).get("streams", [])
    except (_json.JSONDecodeError, AttributeError):
        streams = []

    if not streams:
        if on_progress:
            on_progress("[SubtitleExtract] No subtitle streams found")
        return []

    subtitle_dir.mkdir(parents=True, exist_ok=True)
    srt_files: list[tuple[Path, str]] = []

    try:
        from babelfish import Language as _BabelfishLang
        from pgsrip import api as _pgsrip_api
        from pgsrip.options import Options as _PgsripOptions
        from pgsrip.sup import Sup as _Sup
    except ImportError as e:
        raise PipelineError(
            f"Subtitle extraction requires pgsrip and babelfish: {e}. "
            "Run: pip install pgsrip babelfish"
        ) from e

    for i, stream in enumerate(streams):
        _check_cancel(cancel_event)
        lang_alpha3 = (stream.get("tags") or {}).get("language") or "und"
        codec_name = stream.get("codec_name", "unknown")

        # Convert alpha3 ('eng') to alpha2/IETF ('en') — pgsrip's MediaPath uses the
        # second extension as a language code, e.g. subtitle_0.en.sup -> subtitle_0.en.srt
        try:
            ietf_lang = str(_BabelfishLang(lang_alpha3))
        except Exception:
            ietf_lang = "und"

        sup_file = subtitle_dir / f"subtitle_{i}.{ietf_lang}.sup"

        if on_progress:
            on_progress(f"[SubtitleExtract] Extracting stream {i} ({lang_alpha3}, {codec_name})...")
        extract_result = subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", str(source_path), "-map", f"0:s:{i}", "-c:s", "copy", str(sup_file)],
            capture_output=True, text=True,
        )

        if not sup_file.exists() or sup_file.stat().st_size == 0:
            stderr = extract_result.stderr.strip()
            if on_progress:
                on_progress(
                    f"[SubtitleExtract] Stream {i} ({lang_alpha3}): extraction produced no data"
                    + (f" — {stderr}" if stderr else " (likely not a PGS/bitmap track)")
                )
            continue

        if on_progress:
            on_progress(f"[SubtitleExtract] OCR-converting stream {i} ({lang_alpha3}), this may take several minutes...")
        try:
            import threading as _threading

            options = _PgsripOptions(overwrite=True)
            media = _Sup(str(sup_file))

            # Run OCR in a background thread so we can emit heartbeat log lines
            # while it works. Without this, the log shows "no output yet" for the
            # entire OCR duration because pgsrip blocks with no callbacks.
            srt_result: list[Path] = []
            ocr_exc: list[BaseException] = []
            ocr_done = _threading.Event()

            def _ocr_worker() -> None:
                try:
                    for pgs in media.get_pgs_medias(options):
                        _pgsrip_api.rip_pgs(pgs, options)
                        srt_result.append(Path(str(pgs.srt_path)))
                except BaseException as e:  # noqa: BLE001
                    ocr_exc.append(e)
                finally:
                    ocr_done.set()

            _threading.Thread(target=_ocr_worker, daemon=True).start()

            elapsed = 0
            heartbeat = 15
            while not ocr_done.wait(timeout=heartbeat):
                elapsed += heartbeat
                if cancel_event and cancel_event.is_set():
                    ocr_done.wait()  # let OCR finish before propagating cancel
                    break
                if on_progress:
                    on_progress(f"[SubtitleExtract] OCR in progress ({elapsed}s elapsed)...")

            if ocr_exc:
                raise ocr_exc[0]

            srt_path = srt_result[0] if srt_result else None
            if srt_path and srt_path.exists():
                srt_files.append((srt_path, lang_alpha3))
                if on_progress:
                    on_progress(f"[SubtitleExtract] Stream {i} ({lang_alpha3}): OK -> {srt_path.name}")
            else:
                if on_progress:
                    on_progress(f"[SubtitleExtract] Stream {i} ({lang_alpha3}): OCR produced no output (tesseract may be missing or language data not installed)")
        except Exception as e:
            if on_progress:
                on_progress(f"[SubtitleExtract] Stream {i} ({lang_alpha3}): OCR error: {e}")

    return srt_files


def _encode_chunk_x264(
    chunk_path: Path,
    output_path: Path,
    crf: int,
    config: dict,
    *,
    cancel_event=None,
    on_progress=None,
    on_started=None,
) -> None:
    """Encode a single FFV1 chunk to x264 at the given CRF."""
    p = config.get("x264_params", {})
    bufsize = p.get("bufsize", "24000k")
    cmd = [
        FFMPEG, "-y", "-i", str(chunk_path),
        "-c:v", "libx264", "-crf", str(crf),
        "-x264-params", f"partitions={p.get('partitions', 'i4x4+p8x8+b8x8')}",
        "-trellis", str(p.get("trellis", "2")),
        "-deblock", str(p.get("deblock", "-3:-3")),
        "-b_qfactor", str(p.get("b_qfactor", "1")),
        "-i_qfactor", str(p.get("i_qfactor", "0.71")),
        "-qcomp", str(p.get("qcomp", "0.50")),
        "-maxrate", str(p.get("maxrate", "12000K")),
        "-bufsize", bufsize,
        "-qmax", str(p.get("qmax", "40")),
        "-subq", str(p.get("subq", "10")),
        "-me_method", str(p.get("me_method", "umh")),
        "-me_range", str(p.get("me_range", "24")),
        "-b_strategy", str(p.get("b_strategy", "2")),
        "-movflags", "-faststart",
        "-bf", str(p.get("bf", "2")),
        "-sc_threshold", str(p.get("sc_threshold", "0")),
        "-g", str(p.get("g", "48")),
        "-keyint_min", str(p.get("keyint_min", "48")),
        "-flags", str(p.get("flags", "-loop")),
        "-an", str(output_path),
    ]
    try:
        _run_ffmpeg_cancellable(cmd, cancel_event, on_progress=on_progress, on_started=on_started)
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
    on_progress=None,
    on_started=None,
) -> tuple[int, float, int]:
    """Run the CRF feedback loop for a single chunk.

    Returns (best_crf, best_vmaf, iterations).

    Oscillation resolution: selects the encode whose VMAF is closest to the
    center of [vmaf_min, vmaf_max]. Lower CRF wins on ties (per PIPE-V2-03).
    If the best entry was not the last file written to disk, a final re-encode
    is performed so the output file matches the selected CRF.

    on_started: optional callable(proc) passed to the first _encode_chunk_x264 call
                so callers can register the FfmpegProcess for cancel signalling.
    """
    crf: int = config["crf_start"]
    vmaf_min: float = config["vmaf_min"]
    vmaf_max: float = config["vmaf_max"]
    crf_min: int = config["crf_min"]
    crf_max: int = config["crf_max"]

    vmaf_history: list[tuple[int, float]] = []
    center: float = (vmaf_min + vmaf_max) / 2

    for _i in range(10):
        _check_cancel(cancel_event)

        _encode_chunk_x264(chunk_path, encoded_path, crf, config,
                           cancel_event=cancel_event, on_progress=on_progress,
                           on_started=on_started)
        # on_started fires only for the first encode call; clear it after first use
        on_started = None
        vmaf = _vmaf_score(encoded_path, chunk_path)

        # Check for oscillation: if this CRF was already tried, we are cycling
        already_tried = any(h[0] == crf for h in vmaf_history)
        vmaf_history.append((crf, vmaf))

        if vmaf_min <= vmaf <= vmaf_max:
            break

        if already_tried:
            # Oscillation detected — pick best from history below
            break

        if vmaf < vmaf_min:
            next_crf = crf - 1
        elif vmaf > vmaf_max:
            next_crf = crf + 1
        else:
            break

        if next_crf < crf_min or next_crf > crf_max:
            break

        crf = next_crf

    # Select the entry closest to the window center; lower CRF breaks ties
    best_crf, best_vmaf = min(
        vmaf_history,
        key=lambda h: (abs(h[1] - center), h[0]),
    )

    # Re-encode with the winner if it was not the last file written to disk
    if best_crf != vmaf_history[-1][0]:
        _encode_chunk_x264(chunk_path, encoded_path, best_crf, config,
                           cancel_event=cancel_event, on_progress=on_progress)

    print(f"[{chunk_label}] CRF {best_crf} -> VMAF {best_vmaf:.2f} ({len(vmaf_history)} iter)")
    return (best_crf, best_vmaf, len(vmaf_history))


def _write_concat_list(encoded_chunks: list[Path], concat_list_path: Path) -> None:
    """Write an ffmpeg concat demuxer manifest."""
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for chunk in encoded_chunks:
            f.write(f"file '{chunk.as_posix()}'\n")


def _concat_chunks(concat_list_path: Path, output_path: Path, on_progress=None) -> None:
    """Concatenate encoded chunks into a single video file using ffmpeg concat demuxer."""
    cmd = [
        FFMPEG, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list_path),
        "-c", "copy",
        str(output_path),
    ]
    try:
        _run_ffmpeg_cancellable(cmd, on_progress=on_progress)
    except FfmpegError as e:
        raise PipelineError(f"Concat failed: {e}") from e


def _mux_video_audio(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    subtitle_files: list[tuple[Path, str]] | None = None,
    on_progress=None,
) -> None:
    """Mux video, audio, and optional SRT subtitles into final MKV."""
    cmd = [FFMPEG, "-y", "-i", str(video_path), "-i", str(audio_path)]
    for srt_path, _lang in (subtitle_files or []):
        cmd += ["-i", str(srt_path)]
    cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    for i in range(len(subtitle_files or [])):
        cmd += ["-map", f"{i + 2}:s:0"]
    cmd += ["-c:v", "copy", "-c:a", "copy"]
    if subtitle_files:
        cmd += ["-c:s", "copy"]
        for i, (_srt_path, lang) in enumerate(subtitle_files):
            cmd += [f"-metadata:s:s:{i}", f"language={lang}"]
    cmd.append(str(output_path))
    try:
        _run_ffmpeg_cancellable(cmd, on_progress=on_progress)
    except FfmpegError as e:
        raise PipelineError(f"Mux failed: {e}") from e


def _cleanup(temp_dir: Path) -> None:
    """Remove CHUNKS, ENCODED, and TEMP subdirectories under temp_dir."""
    for subdir in ["chunks", "encoded", "intermediate", "subtitles"]:
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
    publish=None,
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
        publish: Optional callable(event_type, data) for SSE events.
    """
    def _emit(event_type: str, data: dict) -> None:
        if publish:
            publish(event_type, data)

    def _log(line: str) -> None:
        _emit("log", {"line": line})
    source_path = Path(source_path)
    db_path = str(db_path)
    output_dir = Path(output_dir)
    temp_dir = Path(temp_dir)

    chunks_dir = temp_dir / "chunks"
    encoded_dir = temp_dir / "encoded"
    intermediate_dir = temp_dir / "intermediate"
    subtitle_dir = temp_dir / "subtitles"

    intermediate = intermediate_dir / "intermediate.mov"

    # Resume gate: skip steps already completed in a previous run
    existing_steps = await get_steps(db_path, job_id)
    completed_steps: set[str] = {s["step_name"] for s in existing_steps if s["status"] == "DONE"}

    existing_chunks = await get_chunks(db_path, job_id)
    completed_chunk_indices: set[int] = {
        c["chunk_index"] for c in existing_chunks if c["status"] == "DONE"
    }

    is_resuming = bool(completed_steps)
    if is_resuming:
        _log(f"Resuming job {job_id}: {len(completed_steps)} steps already done")

    try:
        for d in [output_dir, chunks_dir, encoded_dir, intermediate_dir]:
            d.mkdir(parents=True, exist_ok=True)

        await update_job_status(db_path, job_id, "RUNNING")

        _check_cancel(cancel_event)

        # Step 1: Subtitle extract (runs first — reads only source_path, fast to fail)
        subtitle_files: list[tuple[Path, str]] = []
        subtitle_mode = config.get("subtitle_mode", "none")
        if subtitle_mode == "extract":
            tesseract_lang = config.get("tesseract_lang", "eng")
            if "SubtitleExtract" not in completed_steps:
                _emit("stage", {"name": "subtitle_extract"})
                step_id = await create_step(db_path, job_id, "SubtitleExtract")
                t0 = time.monotonic()
                subtitle_files = _extract_subtitles(
                    source_path, subtitle_dir, tesseract_lang,
                    cancel_event=cancel_event, on_progress=_log,
                )
                await update_step(db_path, step_id, "DONE")
                print(f"[SubtitleExtract] {len(subtitle_files)} tracks, done ({time.monotonic() - t0:.0f}s)")
            else:
                _emit("stage", {"name": "subtitle_extract"})
                _log("Resuming: SubtitleExtract already done, scanning for SRT files")
                if subtitle_dir.exists():
                    for p in sorted(subtitle_dir.glob("subtitle_*.*.srt")):
                        # Filename: subtitle_0.en.srt -> stem 'subtitle_0.en' -> last part is IETF lang
                        ietf_lang = p.stem.rsplit(".", 1)[-1]
                        try:
                            from babelfish import Language as _BabelfishLang
                            lang_alpha3 = _BabelfishLang.fromietf(ietf_lang).alpha3
                        except Exception:
                            lang_alpha3 = ietf_lang
                        subtitle_files.append((p, lang_alpha3))

        _check_cancel(cancel_event)

        # Step 2: FFV1 encode
        if "FFV1" not in completed_steps:
            _emit("stage", {"name": "ffv1_encode"})
            step_id = await create_step(db_path, job_id, "FFV1")
            print("[FFV1] Encoding intermediate...")
            t0 = time.monotonic()
            _ffv1_encode(source_path, intermediate, cancel_event, on_progress=_log)
            await update_step(db_path, step_id, "DONE")
            print(f"[FFV1] done ({time.monotonic() - t0:.0f}s)")
        else:
            _emit("stage", {"name": "ffv1_encode"})
            _log("Resuming: FFV1 already done, skipping")

        _check_cancel(cancel_event)

        # Step 2: Scene detect
        scene_threshold = config.get("scene_threshold", 27.0)
        if "SceneDetect" not in completed_steps:
            _emit("stage", {"name": "scene_detect"})
            step_id = await create_step(db_path, job_id, "SceneDetect")
            print("[SceneDetect] Detecting scenes...")
            t0 = time.monotonic()
            scenes = _detect_scenes(intermediate, scene_threshold, on_progress=_log)
            await update_step(db_path, step_id, "DONE")
            _log(f"Found {len(scenes)} scene boundaries")
            print(f"[SceneDetect] {len(scenes)} scenes, done ({time.monotonic() - t0:.0f}s)")
        else:
            _emit("stage", {"name": "scene_detect"})
            _log("Resuming: SceneDetect already done, re-detecting for timestamps")
            scenes = _detect_scenes(intermediate, scene_threshold)

        _check_cancel(cancel_event)

        # Step 3: Chunk split
        if "ChunkSplit" not in completed_steps:
            _emit("stage", {"name": "chunk_split"})
            step_id = await create_step(db_path, job_id, "ChunkSplit")
            print("[ChunkSplit] Splitting chunks...")
            t0 = time.monotonic()
            chunks = _split_chunks(intermediate, scenes, chunks_dir, cancel_event, on_progress=_log)
            await update_step(db_path, step_id, "DONE")
            print(f"[ChunkSplit] {len(chunks)} chunks, done ({time.monotonic() - t0:.0f}s)")
        else:
            _emit("stage", {"name": "chunk_split"})
            _log("Resuming: ChunkSplit already done, using existing chunks")
            chunks = sorted(chunks_dir.glob("chunk*.mov"))
            if not chunks:
                raise PipelineError("Resume: no chunk files found in chunks directory")

        _check_cancel(cancel_event)

        # Step 4: Audio transcode
        audio_codec = config.get("audio_codec", "eac3")
        _flags, audio_ext = AUDIO_CODECS[audio_codec]
        audio_file = temp_dir / f"audio.{audio_ext}"
        if "AudioTranscode" not in completed_steps:
            _emit("stage", {"name": "audio_transcode"})
            step_id = await create_step(db_path, job_id, "AudioTranscode")
            print("[AudioTranscode] Transcoding audio...")
            t0 = time.monotonic()
            _transcode_audio(source_path, audio_file, codec=audio_codec, cancel_event=cancel_event, on_progress=_log)
            await update_step(db_path, step_id, "DONE")
            print(f"[AudioTranscode] done ({time.monotonic() - t0:.0f}s)")
        else:
            _emit("stage", {"name": "audio_transcode"})
            _log("Resuming: AudioTranscode already done, skipping")

        _check_cancel(cancel_event)

        # Steps 5-7: Per-chunk CRF+VMAF feedback loop (parallel when max_parallel_chunks > 1)
        max_parallel = config.get("max_parallel_chunks", 1)
        await set_job_total_chunks(db_path, job_id, len(chunks))
        _emit("stage", {"name": "chunk_encode", "total_chunks": len(chunks)})

        # Find or create ChunkEncode step
        if "ChunkEncode" not in completed_steps:
            chunk_step_id = await create_step(db_path, job_id, "ChunkEncode")
        else:
            chunk_step_id = next(
                (s["id"] for s in existing_steps if s["step_name"] == "ChunkEncode"),
                await create_step(db_path, job_id, "ChunkEncode"),
            )

        total = len(chunks)
        encoded_chunks: list[Path] = []
        chunk_durations: list[float] = []  # ms per completed chunk

        # Capture the running event loop so worker threads can bridge async DB calls
        loop = asyncio.get_event_loop()

        # Handle dict for cancel: maps chunk_index -> FfmpegProcess, protected by lock
        _chunk_handles: dict[int, object] = {}  # values are FfmpegProcess instances
        _handles_lock = threading.Lock()

        def _register_handle(chunk_index: int, proc) -> None:
            """Register an active FfmpegProcess for cancel signalling."""
            with _handles_lock:
                _chunk_handles[chunk_index] = proc

        def _unregister_handle(chunk_index: int) -> None:
            """Remove a completed FfmpegProcess from the cancel dict."""
            with _handles_lock:
                _chunk_handles.pop(chunk_index, None)

        def _cancel_all_handles() -> None:
            """Cancel all in-flight ffmpeg processes."""
            with _handles_lock:
                for handle in _chunk_handles.values():
                    try:
                        handle.cancel()
                    except OSError:
                        pass

        # Build list of chunks to encode (skip completed ones for resume)
        chunks_to_encode: list[tuple[int, Path]] = []
        for i, chunk_in in enumerate(chunks):
            chunk_out = encoded_dir / chunk_in.name
            if i in completed_chunk_indices:
                _log(f"Resuming: chunk {i+1}/{total} already done, skipping")
                encoded_chunks.append(chunk_out)
            else:
                chunk_out.unlink(missing_ok=True)
                chunks_to_encode.append((i, chunk_in))

        def _worker_encode_chunk(chunk_index: int, chunk_in: Path) -> tuple[int, Path, int, float, int, float]:
            """Encode a single chunk. Returns (index, path, crf, vmaf, iters, duration_ms).

            Pure CPU work — DB writes are handled by the caller to avoid event-loop conflicts.
            Safe to call from worker threads (parallel path) or the async coroutine (serial path).
            """
            if cancel_event and cancel_event.is_set():
                raise PipelineError("Job cancelled", status="CANCELLED")

            chunk_out = encoded_dir / chunk_in.name
            chunk_label = f"Chunk {chunk_index+1}/{total}"

            _emit("chunk_progress", {
                "chunk_index": chunk_index,
                "crf": config["crf_start"],
                "pass": 1,
            })
            _log(f"Encoding chunk {chunk_index+1}/{total}...")

            # on_started callback: register the FfmpegProcess for cancel
            def _on_encode_started(proc):
                _register_handle(chunk_index, proc)

            t_chunk = time.monotonic()
            try:
                crf, vmaf, iters = _encode_chunk_with_vmaf(
                    chunk_in, chunk_out, config, cancel_event, chunk_label,
                    on_progress=_log, on_started=_on_encode_started,
                )
            finally:
                _unregister_handle(chunk_index)
            duration_ms = (time.monotonic() - t_chunk) * 1000

            return (chunk_index, chunk_out, crf, vmaf, iters, duration_ms)

        def _worker_encode_chunk_threaded(chunk_index: int, chunk_in: Path, chunk_id: int) -> tuple[int, Path, int, float, int, float]:
            """Encode a chunk from a worker thread; performs DB writes via event-loop bridge."""
            idx, chunk_out, crf, vmaf, iters, duration_ms = _worker_encode_chunk(chunk_index, chunk_in)

            # Update chunk in DB via event loop bridge
            fut = asyncio.run_coroutine_threadsafe(
                update_chunk(db_path, chunk_id, crf_used=float(crf),
                             vmaf_score=vmaf, iterations=iters, status="DONE"),
                loop
            )
            fut.result(timeout=30)

            # Append log via event loop bridge
            fut = asyncio.run_coroutine_threadsafe(
                append_job_log(db_path, job_id,
                               f"[Chunk {chunk_index+1}/{total}] CRF {crf} -> VMAF {vmaf:.2f} ({iters} iter)"),
                loop
            )
            fut.result(timeout=30)

            return (idx, chunk_out, crf, vmaf, iters, duration_ms)

        if max_parallel <= 1 or len(chunks_to_encode) <= 1:
            # Serial path — runs directly in async coroutine; use await for DB calls
            for chunk_index, chunk_in in chunks_to_encode:
                _check_cancel(cancel_event)
                chunk_id = await create_chunk(db_path, job_id, chunk_index)
                idx, chunk_out, crf, vmaf, iters, dur_ms = _worker_encode_chunk(chunk_index, chunk_in)
                await update_chunk(db_path, chunk_id, crf_used=float(crf),
                                   vmaf_score=vmaf, iterations=iters, status="DONE")
                await append_job_log(
                    db_path, job_id,
                    f"[Chunk {chunk_index+1}/{total}] CRF {crf} -> VMAF {vmaf:.2f} ({iters} iter)"
                )
                chunk_durations.append(dur_ms)
                encoded_remaining = len(chunks_to_encode) - len(chunk_durations)
                if encoded_remaining > 0 and chunk_durations:
                    avg_ms = sum(chunk_durations) / len(chunk_durations)
                    eta_ms = int(avg_ms * encoded_remaining)
                else:
                    eta_ms = None
                await set_job_eta(db_path, job_id, eta_ms)
                _emit("chunk_complete", {
                    "chunk_index": idx,
                    "crf_used": crf,
                    "vmaf_score": round(vmaf, 2),
                    "iterations": iters,
                    "eta_ms": eta_ms,
                })
                encoded_chunks.append(chunk_out)
        else:
            # Parallel path — pre-create chunk DB rows from async context, then submit workers
            chunk_ids: dict[int, int] = {}
            for chunk_index, _cin in chunks_to_encode:
                chunk_ids[chunk_index] = await create_chunk(db_path, job_id, chunk_index)

            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_parallel) as chunk_executor:
                    futures = {
                        chunk_executor.submit(_worker_encode_chunk_threaded, idx, cin, chunk_ids[idx]): idx
                        for idx, cin in chunks_to_encode
                    }
                    for future in concurrent.futures.as_completed(futures):
                        if cancel_event and cancel_event.is_set():
                            _cancel_all_handles()
                            chunk_executor.shutdown(wait=False, cancel_futures=True)
                            raise PipelineError("Job cancelled", status="CANCELLED")

                        idx, chunk_out, crf, vmaf, iters, dur_ms = future.result()
                        chunk_durations.append(dur_ms)

                        encoded_remaining = len(chunks_to_encode) - len(chunk_durations)
                        if encoded_remaining > 0 and chunk_durations:
                            avg_ms = sum(chunk_durations) / len(chunk_durations)
                            eta_ms = int(avg_ms * encoded_remaining)
                        else:
                            eta_ms = None
                        fut = asyncio.run_coroutine_threadsafe(
                            set_job_eta(db_path, job_id, eta_ms), loop
                        )
                        fut.result(timeout=30)
                        _emit("chunk_complete", {
                            "chunk_index": idx,
                            "crf_used": crf,
                            "vmaf_score": round(vmaf, 2),
                            "iterations": iters,
                            "eta_ms": eta_ms,
                        })
                        encoded_chunks.append(chunk_out)
            except PipelineError:
                raise
            except Exception as exc:
                _cancel_all_handles()
                raise PipelineError(f"Parallel chunk encoding failed: {exc}") from exc

        # Sort by name to maintain correct concat order
        encoded_chunks.sort(key=lambda p: p.name)

        await update_step(db_path, chunk_step_id, "DONE")
        _check_cancel(cancel_event)

        # Step 8: Concat
        concat_mp4 = temp_dir / "concat.mp4"
        if "Concat" not in completed_steps:
            _emit("stage", {"name": "merge"})
            step_id = await create_step(db_path, job_id, "Concat")
            print("[Concat] Concatenating chunks...")
            t0 = time.monotonic()
            concat_list = temp_dir / "concat_list.txt"
            _write_concat_list(encoded_chunks, concat_list)
            _concat_chunks(concat_list, concat_mp4, on_progress=_log)
            await update_step(db_path, step_id, "DONE")
            print(f"[Concat] done ({time.monotonic() - t0:.0f}s)")
        else:
            _emit("stage", {"name": "merge"})
            _log("Resuming: Concat already done, skipping")

        _check_cancel(cancel_event)

        # Step 9: Mux
        if "Mux" not in completed_steps:
            _emit("stage", {"name": "mux"})
            step_id = await create_step(db_path, job_id, "Mux")
            print("[Mux] Muxing video and audio...")
            t0 = time.monotonic()
            output_mkv = output_dir / (source_path.stem + ".mkv")
            _mux_video_audio(concat_mp4, audio_file, output_mkv, subtitle_files=subtitle_files, on_progress=_log)
            await update_step(db_path, step_id, "DONE")
            print(f"[Mux] done ({time.monotonic() - t0:.0f}s)")
        else:
            _emit("stage", {"name": "mux"})
            _log("Resuming: Mux already done, skipping")
            output_mkv = output_dir / (source_path.stem + ".mkv")

        await update_job_status(db_path, job_id, "DONE")
        print(f"[Done] Output: {output_mkv}")

    except PipelineError as e:
        status = getattr(e, "status", "FAILED")
        await update_job_status(db_path, job_id, status)
        await append_job_log(db_path, job_id, f"ERROR: {e}")
        if status != "CANCELLED":
            raise
    except Exception as e:
        await update_job_status(db_path, job_id, "FAILED")
        import traceback as _tb
        await append_job_log(db_path, job_id, f"ERROR: {e}\n{_tb.format_exc()}")
        raise
    finally:
        # Step 10: Cleanup — always, regardless of outcome
        _emit("stage", {"name": "cleanup"})
        try:
            cleanup_step_id = await create_step(db_path, job_id, "Cleanup")
            _cleanup(temp_dir)
            await update_step(db_path, cleanup_step_id, "DONE")
        except Exception:
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
