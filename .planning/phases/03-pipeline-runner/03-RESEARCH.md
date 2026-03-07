# Phase 3: Pipeline Runner - Research

**Researched:** 2026-03-07
**Domain:** FFmpeg pipeline orchestration (FFV1, scene detection, x264/VMAF CRF loop, concat/mux, cleanup)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CLI invocation:**
- `python -m encoder.pipeline source.mkv` — module-style, no install step required
- Required positional arg: source file path
- `--config path/to/config.json` — per-job config override (optional; defaults apply if omitted)
- `--output-dir ./output` — output MKV destination (default: `./output/` relative to cwd)
- `--temp-dir ./temp` — temp/intermediate/chunk working directory (default: `./temp/` relative to cwd)
- `--scene-threshold 27` — ContentDetector threshold (default: 27)
- No `--dump-defaults` flag

**Terminal output style:**
- Per-step status lines: `[FFV1] Encoding intermediate... done (42s)`
- One line per chunk showing final CRF and VMAF: `[Chunk 3/12] CRF 17 -> VMAF 96.8 (pass)`
- No live progress bar overwriting — clean readable lines only
- All detail (every VMAF iteration, ffmpeg stderr) goes to DB log blob only

**Log storage:**
- DB only — `jobs.log` blob in SQLite, appended per chunk as encoding progresses
- No separate encodinglog.txt written to disk

**Config / encoding preset:**
- Config JSON schema: `vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, x264_params`
- Default values when `--config` omitted: vmaf_min=96.2, vmaf_max=97.6, crf_start=17, crf_min=16, crf_max=20, audio_codec=eac3
- x264_params defaults: partitions=i4x4+p8x8+b8x8, trellis=2, deblock=-3:-3, subq=10, me_method=umh, me_range=24, b_strategy=2, bf=2, sc_threshold=0, g=48, keyint_min=48, maxrate=12000K, bufsize=24000k, qmax=40, qcomp=0.50, b_qfactor=1, i_qfactor=0.71, flags=-loop
- x264_params is a nested dict in the config JSON

**Scene detection:**
- Algorithm: ContentDetector (HSV content-based)
- No minimum scene length
- Zero scenes detected: raise hard error, stop pipeline immediately
- Threshold configurable via `--scene-threshold` (default 27)

**Cancel / interrupt behavior:**
- Ctrl+C: cancel active ffmpeg via `.cancel()`, delete all temp dirs (CHUNKS, ENCODED, TEMP subdirs under `--temp-dir`), output dir untouched if mux never started
- Job status set to CANCELLED (distinct from FAILED)
- Pipeline function accepts `cancel_event: threading.Event` parameter
- Phase 3 polls it between steps and after each chunk's VMAF loop
- Phase 4 sets this event from the web API; Ctrl+C sets the same event via signal handler

### Claude's Discretion

- Exact VMAF filter graph structure (how libvmaf compares FFV1 source vs encoded chunk)
- VMAF model file selection (vmaf_v0.6.1.json vs vmaf_4k_v0.6.1.json) — pick appropriate model
- PySceneDetect API call pattern for >=0.6.7,<0.7 (synchronous, run via run_in_executor)
- Heartbeat update frequency during encoding (how often update_heartbeat is called)
- Exact error exception types for pipeline failures
- How x264_params nested object maps to ffmpeg -x264-params string

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-01 | System encodes source MKV to FFV1 lossless intermediate via ffmpeg | FFV1 command pattern documented; `-c:v ffv1 -level 3 -coder 1 -context 1 -slicecrc 1 -slices 24 -g 1 -sn -an` flags verified from PowerShell script and ffmpeg docs |
| PIPE-02 | System detects scene boundaries using PySceneDetect (>=0.6.7,<0.7) | PySceneDetect 0.6.7 Python API documented; `detect()` + ContentDetector returns FrameTimecode pairs; run via `run_in_executor` (sync library) |
| PIPE-03 | System splits FFV1 intermediate into scene-boundary chunks via ffmpeg | `-f segment -segment_times ... -reset_timestamps 1 -c:v copy` pattern documented; `FrameTimecode.get_seconds()` provides timestamps |
| PIPE-04 | System extracts and transcodes audio to user-selected codec (EAC3, AAC, FLAC, copy) | Audio codec map documented; ffmpeg `-c:a eac3/aac/flac/copy` patterns verified; two-step FLAC→EAC3 not needed — direct transcode works |
| PIPE-05 | System encodes each chunk with libx264 using configurable encoding parameters | x264_params dict→string mapping via colon-separator join documented; `-x264-params key=val:key=val` syntax confirmed |
| PIPE-06 | System scores each encoded chunk against FFV1 source using VMAF | libvmaf filter graph pattern documented; `vmaf_v0.6.1.json` model in `assets/` confirmed; VMAF score parsing from stderr regex confirmed |
| PIPE-07 | System adjusts CRF ±1 and re-encodes chunk if VMAF outside target range | CRF feedback loop algorithm documented; convergence guard (visited-CRF set + max_iterations) required; pitfall m5 addressed |
| PIPE-08 | System concatenates all encoded chunks and muxes with audio into final MKV | Concat demuxer with `-safe 0` documented; two-stage concat+mux (→mp4 then →mkv) pattern from original script documented |
| PIPE-09 | System cleans up temp files after job completes or is cancelled | `shutil.rmtree` per-subdirectory pattern; must handle ffmpeg holding file handles on Windows (ensure process terminated first) |
| CONF-01 | User can set VMAF target range per job | vmaf_min/vmaf_max in config JSON; defaults 96.2–97.6 |
| CONF-02 | User can set CRF bounds per job | crf_min/crf_max/crf_start in config JSON; defaults 16–20, start 17 |
| CONF-03 | User can select audio codec per job | audio_codec field; EAC3/AAC/FLAC/copy options; ffmpeg command dispatch table |
| CONF-04 | User can select video encoding preset per job | x264_params nested dict → `-x264-params` string serialization; default preset documented |
</phase_requirements>

---

## Summary

Phase 3 wires together the two working foundations (ffmpeg subprocess wrapper from Phase 1, SQLite state layer from Phase 2) into a complete encoding pipeline executable from the command line. The work is orchestration, not novelty — every individual capability is either already implemented or a well-understood ffmpeg invocation.

The three technically interesting problems that require careful implementation are: (1) the VMAF filter graph, which must compare an encoded chunk against its FFV1 source with explicit pixel-format normalization and PTS reset to avoid silent zero-scores; (2) the CRF feedback loop convergence guard, which must detect CRF oscillation and terminate cleanly; and (3) the cancel_event polling pattern, which must reliably interrupt encoding at step boundaries and pass the same threading.Event to Phase 4.

The pipeline function `run_pipeline(source_path, db_path, job_id, config, cancel_event)` is the primary deliverable. Phase 4 imports it directly without modification. All DB state writes are async (aiosqlite); the pipeline uses `asyncio.run()` at the CLI entry point and `await` throughout for DB calls, while ffmpeg subprocesses remain sync via the existing `run_ffmpeg()` wrapper.

**Primary recommendation:** Implement pipeline.py as a single async function with explicit step names, DB step tracking, and cancel_event polling between every step. The VMAF filter graph must include `setpts=PTS-STARTPTS` and explicit `format=yuv420p` normalization. The CRF loop must track visited CRFs and cap at 10 iterations.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `subprocess` (stdlib) | Python 3.9+ | ffmpeg invocations via `run_ffmpeg()` | Already in use from Phase 1 |
| `asyncio` (stdlib) | Python 3.9+ | async DB calls, CLI entry `asyncio.run()`, run_in_executor for PySceneDetect | Already the project's async model |
| `threading` (stdlib) | Python 3.9+ | `cancel_event: threading.Event` parameter type | Chosen in CONTEXT.md; mirrors Phase 4 integration pattern |
| `pathlib` (stdlib) | Python 3.9+ | All file paths; `.as_posix()` for filter strings | Established convention from Phase 1 |
| `shutil` (stdlib) | Python 3.9+ | `rmtree` for cleanup; `which` for binary detection | Built-in, no dependency |
| `json` (stdlib) | Python 3.9+ | Config file loading; VMAF log parsing | Built-in |
| `re` (stdlib) | Python 3.9+ | VMAF score parsing from ffmpeg stderr | Built-in |
| `scenedetect` | >=0.6.7,<0.7 | Scene boundary detection | Already pinned in project; Python API is synchronous |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `aiosqlite` | >=0.22,<0.23 | Async DB calls (already a project dependency) | All DB operations: create_step, update_step, create_chunk, update_chunk, append_job_log, update_heartbeat |
| `pytest` | >=8.0,<9 | Test runner (already in dev deps) | Integration tests in `tests/test_pipeline.py` |
| `pytest-timeout` | >=2.3 | Per-test timeout (already in dev deps) | Pipeline integration tests with real ffmpeg |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `detect()` simple API | `SceneManager` + `StatsManager` | SceneManager gives per-frame stats but adds complexity; `detect()` returns the same scene list; use `detect()` for Phase 3 |
| Parse VMAF from stderr regex | Write to `log_path` JSON file + `json.load()` | JSON log file is more reliable than regex on stderr; prefer JSON log file approach for robustness |
| Two-stage FLAC→EAC3 (original PowerShell) | Direct EAC3 transcode via ffmpeg | ffmpeg supports direct `-c:a eac3` transcode from source without Plex Transcoder; simpler, cross-platform |

**Installation (new deps for Phase 3):**

```bash
pip install "scenedetect[opencv]>=0.6.7,<0.7"
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── encoder/
│   ├── __init__.py          # existing
│   ├── ffmpeg.py            # existing — run_ffmpeg, escape_vmaf_path, FfmpegError
│   ├── db.py                # existing — all DB functions
│   └── pipeline.py          # Phase 3 deliverable
tests/
├── __init__.py              # existing
├── test_ffmpeg.py           # existing
├── test_db.py               # existing
└── test_pipeline.py         # Phase 3 — integration tests
assets/
├── vmaf_v0.6.1.json         # existing — use this for 1080p encoding
└── vmaf_4k_v0.6.1.json      # existing — not used in Phase 3
```

### Pattern 1: Pipeline Function Signature

**What:** The `run_pipeline` async function is the Phase 4 integration point. Its signature is fixed.

**When to use:** Called by CLI entry point via `asyncio.run()` and by Phase 4 via `asyncio.create_task()`.

```python
# Source: CONTEXT.md decisions + Phase 4 integration contract
import asyncio
import threading
from pathlib import Path

async def run_pipeline(
    source_path: Path,
    db_path: str,
    job_id: int,
    config: dict,
    cancel_event: threading.Event,
    output_dir: Path,
    temp_dir: Path,
) -> None:
    """
    Run the full encoding pipeline for one job.

    Raises PipelineError on failure. Sets job status to FAILED or CANCELLED in DB.
    Cleanup (temp dir removal) is always performed on exit.
    """
    ...
```

**CLI entry point:**

```python
# src/encoder/pipeline.py — bottom of file
if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(prog="python -m encoder.pipeline")
    parser.add_argument("source", type=Path)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=Path("./output"))
    parser.add_argument("--temp-dir", type=Path, default=Path("./temp"))
    parser.add_argument("--scene-threshold", type=float, default=27.0)
    args = parser.parse_args()

    cancel_event = threading.Event()

    import signal
    def _sigint_handler(signum, frame):
        cancel_event.set()
    signal.signal(signal.SIGINT, _sigint_handler)

    db_path = str(args.output_dir / "encoder.db")
    asyncio.run(_cli_main(args, db_path, cancel_event))
```

### Pattern 2: Step Tracking Pattern

**What:** Every named pipeline step creates a DB step record, prints a status line, and updates the step to DONE or FAILED.

**When to use:** Wrap every pipeline step (FFV1, scene detect, chunk split, audio, each chunk encode, concat, mux, cleanup).

```python
import time

async def _run_step(db_path: str, job_id: int, step_name: str, coro):
    """Execute a pipeline step with DB tracking and terminal output."""
    step_id = await create_step(db_path, job_id, step_name)
    print(f"[{step_name}] Starting...")
    t0 = time.monotonic()
    try:
        result = await coro
        elapsed = time.monotonic() - t0
        await update_step(db_path, step_id, "DONE")
        print(f"[{step_name}] done ({elapsed:.0f}s)")
        return result
    except Exception as e:
        await update_step(db_path, step_id, "FAILED")
        raise
```

### Pattern 3: Cancel Event Polling

**What:** Check `cancel_event` between every pipeline step and inside the chunk encoding loop.

**When to use:** At step boundaries and after each chunk's VMAF result is obtained.

```python
def _check_cancel(cancel_event: threading.Event, job_id: int) -> None:
    """Raise CancelledError if cancel_event is set."""
    if cancel_event.is_set():
        raise PipelineError("Job cancelled", status="CANCELLED")
```

### Pattern 4: PySceneDetect API (0.6.7)

**What:** Use `detect()` synchronous function, wrapped in `run_in_executor` to avoid blocking the event loop.

**When to use:** Step 2 of the pipeline (scene detection).

```python
# Source: https://www.scenedetect.com/docs/latest/api.html
from scenedetect import detect, ContentDetector
from scenedetect.frame_timecode import FrameTimecode

async def _detect_scenes(
    video_path: Path,
    threshold: float,
    cancel_event: threading.Event,
) -> list[tuple[FrameTimecode, FrameTimecode]]:
    """Detect scene boundaries. Returns list of (start, end) FrameTimecode pairs."""
    loop = asyncio.get_event_loop()
    scenes = await loop.run_in_executor(
        None,  # default ThreadPoolExecutor
        lambda: detect(str(video_path), ContentDetector(threshold=threshold))
    )
    if not scenes:
        raise PipelineError(
            f"No scenes detected in {video_path}. "
            "Check source file or lower --scene-threshold."
        )
    return scenes

# Extract segment times for ffmpeg -segment_times:
# scenes is List[Tuple[FrameTimecode, FrameTimecode]]
# Each tuple is (scene_start, scene_end)
# Segment split points = start of each scene except the first (which is 0)
def _scene_split_times(scenes: list) -> str:
    """Return comma-separated seconds string for ffmpeg -segment_times."""
    # scenes[0] starts at 0, skip it — ffmpeg starts from the beginning
    times = [scene[0].get_seconds() for scene in scenes[1:]]
    return ",".join(f"{t:.6f}" for t in times)
```

### Pattern 5: FFV1 Intermediate Encode

**What:** Encode source MKV to FFV1 lossless intermediate for scene splitting.

**When to use:** Step 1 of the pipeline.

```python
# Derived from PowerShell script + ffmpeg docs
# -sn disables subtitle streams (scene detection doesn't need them)
# -an disables audio (audio is handled separately)
# -g 1 forces keyframes at every frame (required for exact scene splitting)
def _ffv1_cmd(ffmpeg: str, source: Path, output: Path) -> list[str]:
    return [
        ffmpeg, "-y", "-i", str(source),
        "-sn", "-an",
        "-c:v", "ffv1", "-level", "3", "-threads", "4",
        "-coder", "1", "-context", "1", "-slicecrc", "1",
        "-slices", "24", "-g", "1",
        str(output),
    ]
```

### Pattern 6: FFmpeg Chunk Split

**What:** Split FFV1 intermediate at scene boundaries using the segment muxer.

**When to use:** Step 3 of the pipeline.

```python
# Source: ffmpeg segment muxer docs + PowerShell script
# -safe 0 is NOT needed for segment muxer (only for concat demuxer)
# -reset_timestamps 1 ensures each chunk starts at PTS 0 (required for VMAF)
# %06d creates zero-padded chunk filenames: chunk000000.mov, chunk000001.mov, ...
def _chunk_split_cmd(
    ffmpeg: str, intermediate: Path, output_pattern: Path, segment_times: str
) -> list[str]:
    cmd = [
        ffmpeg, "-y", "-i", str(intermediate),
        "-f", "segment",
        "-segment_times", segment_times,
        "-reset_timestamps", "1",
        "-c:v", "copy", "-an",
        str(output_pattern),
    ]
    # Only add -segment_times if there are split points
    # (single scene = no splits needed, just copy the whole file)
    if not segment_times:
        # No scene splits: just copy the whole intermediate as one chunk
        cmd = [ffmpeg, "-y", "-i", str(intermediate), "-c:v", "copy", "-an", str(output_pattern)]
    return cmd
```

### Pattern 7: Audio Transcode

**What:** Extract and transcode audio from source file to target codec.

**When to use:** Step 4 of the pipeline.

```python
# Audio codec dispatch table
AUDIO_CODECS = {
    "eac3":  ["-c:a", "eac3"],
    "aac":   ["-c:a", "aac"],
    "flac":  ["-c:a", "flac"],
    "copy":  ["-c:a", "copy"],
}

def _audio_cmd(ffmpeg: str, source: Path, output: Path, codec: str) -> list[str]:
    codec_flags = AUDIO_CODECS.get(codec, ["-c:a", "copy"])
    ext = {"eac3": "eac3", "aac": "m4a", "flac": "flac", "copy": "mka"}.get(codec, "mka")
    return [
        ffmpeg, "-y", "-i", str(source),
        "-vn",  # no video
        *codec_flags,
        str(output.with_suffix(f".{ext}")),
    ]
```

### Pattern 8: x264 Chunk Encode

**What:** Encode a single chunk with libx264 at a given CRF. x264_params dict is serialized to colon-separated key=value string.

**When to use:** Step 5 (per chunk, potentially multiple times in the VMAF loop).

```python
# Source: ffmpeg docs + PowerShell script
# x264_params dict → ":".join("k=v" ...) is the official ffmpeg x264-params format
# Note: bufsize in first encode is 14000k (original script); re-encodes use 24000k
#       Config stores bufsize in x264_params; first encode vs re-encode may differ

def _x264_params_str(params: dict) -> str:
    """Serialize x264_params dict to colon-separated ffmpeg option string."""
    return ":".join(f"{k}={v}" for k, v in params.items())

def _chunk_encode_cmd(
    ffmpeg: str,
    chunk_in: Path,
    chunk_out: Path,
    crf: int,
    x264_params: dict,
) -> list[str]:
    return [
        ffmpeg, "-y", "-i", str(chunk_in),
        "-c:v", "libx264",
        "-crf", str(crf),
        "-x264-params", _x264_params_str(x264_params),
        "-an",
        str(chunk_out),
    ]
```

### Pattern 9: VMAF Scoring (CRITICAL)

**What:** Score an encoded chunk against its FFV1 source using libvmaf. Write score to a JSON log file, parse aggregate score.

**When to use:** Step 6 (per chunk, after each encode in the VMAF loop).

**The filter graph — input order matters:** `-i encoded_chunk -i ffv1_source_chunk`. In libvmaf filter: distorted (encoded) is first input `[0:v]`, reference (FFV1) is second input `[1:v]`. The filter is `[distorted][reference]libvmaf=...`.

**setpts=PTS-STARTPTS is mandatory** for chunked comparison — chunks may not start at PTS 0 without it (though `-reset_timestamps 1` in split should help; include it anyway as a safety measure).

**format=yuv420p normalization is mandatory** — FFV1 source may be in a different pixel format than x264 output. Mismatched formats cause silent VMAF=0 or NaN scores.

```python
# Source: Netflix VMAF ffmpeg.md + Fraunhofer Video-Dev guide + Pitfall C5 in PITFALLS.md
import json
import re
import tempfile

_VMAF_SCORE_RE = re.compile(r"VMAF score:\s*([\d.]+)")

async def _vmaf_score(
    ffmpeg: str,
    encoded_chunk: Path,
    ffv1_chunk: Path,
    vmaf_model: Path,
    n_threads: int = 4,
) -> float:
    """Score encoded_chunk against ffv1_chunk using libvmaf. Returns aggregate score."""
    # Write VMAF log to a temp file (JSON format — more reliable than stderr regex)
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        log_path = Path(f.name)

    escaped_model = escape_vmaf_path(vmaf_model)
    escaped_log = escape_vmaf_path(log_path)

    # Filter graph:
    # Input 0 = encoded (distorted), Input 1 = FFV1 source (reference)
    # setpts=PTS-STARTPTS: reset timestamps to 0 for proper frame alignment
    # format=yuv420p: normalize pixel format to avoid silent mismatch errors
    filter_graph = (
        f"[0:v]setpts=PTS-STARTPTS,format=yuv420p[dist];"
        f"[1:v]setpts=PTS-STARTPTS,format=yuv420p[ref];"
        f"[dist][ref]libvmaf=model='path={escaped_model}'"
        f":log_fmt=json:log_path={escaped_log}:n_threads={n_threads}"
    )

    cmd = [
        ffmpeg, "-y",
        "-i", str(encoded_chunk),    # input 0 = distorted
        "-i", str(ffv1_chunk),       # input 1 = reference
        "-lavfi", filter_graph,
        "-f", "null", "-",
    ]

    proc = run_ffmpeg(cmd)
    # Drain the process (VMAF scores to log file, not progress events)
    for _ in proc:
        pass  # No frame= progress events from VMAF run; drain to completion

    # Parse score from JSON log file
    try:
        with open(log_path) as f:
            data = json.load(f)
        # VMAF JSON log structure: {"pooled_metrics": {"vmaf": {"mean": X, ...}}, ...}
        # Or: {"VMAF score": X} in older formats
        # Try pooled_metrics first (libvmaf 2.x JSON format)
        vmaf = data.get("pooled_metrics", {}).get("vmaf", {}).get("mean")
        if vmaf is None:
            # Fallback: parse from frames list (older format)
            frames = data.get("frames", [])
            if frames:
                scores = [f["metrics"]["vmaf"] for f in frames if "metrics" in f]
                vmaf = sum(scores) / len(scores) if scores else None
    except (json.JSONDecodeError, KeyError, FileNotFoundError):
        vmaf = None
    finally:
        log_path.unlink(missing_ok=True)

    # Fallback: parse "VMAF score: X.XX" from captured stderr
    if vmaf is None:
        stderr_text = "\n".join(proc.stderr_lines)
        m = _VMAF_SCORE_RE.search(stderr_text)
        if m:
            vmaf = float(m.group(1))

    if vmaf is None:
        raise PipelineError(
            f"Failed to obtain VMAF score for {encoded_chunk.name}. "
            "Check ffmpeg stderr in job log."
        )
    return vmaf
```

### Pattern 10: CRF Feedback Loop

**What:** Encode chunk, score VMAF, adjust CRF ±1 if outside target, repeat until score lands in range or CRF bounds are hit. Guard against oscillation.

**When to use:** Core per-chunk loop (Steps 5–7 in the pipeline).

```python
async def _encode_chunk_with_vmaf(
    ffmpeg: str,
    chunk_in: Path,
    chunk_out: Path,
    ffv1_chunk: Path,
    vmaf_model: Path,
    config: dict,
    cancel_event: threading.Event,
    db_path: str,
    chunk_id: int,
    chunk_label: str,  # e.g. "Chunk 3/12"
) -> tuple[int, float, int]:
    """Returns (final_crf, final_vmaf, iterations)."""
    crf = config["crf_start"]
    vmaf_min = config["vmaf_min"]
    vmaf_max = config["vmaf_max"]
    crf_min = config["crf_min"]
    crf_max = config["crf_max"]
    x264_params = config["x264_params"]

    visited_crfs: set[int] = set()
    max_iterations = 10
    best_crf, best_vmaf = crf, None

    for iteration in range(1, max_iterations + 1):
        _check_cancel(cancel_event)

        # Encode chunk at current CRF
        proc = run_ffmpeg(_chunk_encode_cmd(ffmpeg, chunk_in, chunk_out, crf, x264_params))
        for _ in proc:
            pass  # drain progress events

        # Score VMAF
        vmaf = await _vmaf_score(ffmpeg, chunk_out, ffv1_chunk, vmaf_model)
        best_crf, best_vmaf = crf, vmaf

        # Log every iteration to DB
        await append_job_log(
            db_path, chunk_id,
            f"  [{chunk_label}] iter {iteration}: CRF {crf} -> VMAF {vmaf:.2f}"
        )

        # Check if score is in range
        if vmaf_min <= vmaf <= vmaf_max:
            break

        # Detect oscillation: if we've tried this CRF before, accept best result
        if crf in visited_crfs:
            break
        visited_crfs.add(crf)

        # Adjust CRF
        if vmaf < vmaf_min and crf > crf_min:
            crf -= 1  # score too low → better quality (lower CRF)
        elif vmaf > vmaf_max and crf < crf_max:
            crf += 1  # score too high → save bits (higher CRF)
        else:
            break  # hit CRF bounds, accept result

    # Print final result to terminal
    status = "pass" if vmaf_min <= best_vmaf <= vmaf_max else "bounds"
    print(f"[{chunk_label}] CRF {best_crf} -> VMAF {best_vmaf:.2f} ({status})")

    return best_crf, best_vmaf, len(visited_crfs) + 1
```

### Pattern 11: Concat and Mux

**What:** Concatenate all encoded chunks into a single MP4, then mux with audio into final MKV.

**When to use:** Steps 8–9 of the pipeline.

```python
# Source: ffmpeg concat demuxer docs + PowerShell script
# -safe 0: required for absolute paths or paths with special chars
# Write one "file 'path'" line per chunk in order

def _write_concat_list(chunks: list[Path], list_file: Path) -> None:
    """Write ffmpeg concat demuxer list file."""
    with open(list_file, "w", encoding="utf-8") as f:
        for chunk in chunks:
            # Use POSIX paths (forward slashes) inside the concat file
            f.write(f"file '{chunk.as_posix()}'\n")

def _concat_cmd(ffmpeg: str, list_file: Path, output: Path) -> list[str]:
    return [
        ffmpeg, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c", "copy",
        str(output),
    ]

def _mux_cmd(ffmpeg: str, video: Path, audio: Path, output: Path) -> list[str]:
    return [
        ffmpeg, "-y",
        "-i", str(video),
        "-i", str(audio),
        "-c:v", "copy", "-c:a", "copy",
        str(output),
    ]
```

### Pattern 12: Cleanup

**What:** Remove all temp directories after pipeline completes or is cancelled.

**When to use:** Always — in a `finally` block wrapping the pipeline body.

```python
import shutil

def _cleanup(temp_dir: Path) -> None:
    """Remove all temp subdirectories. Called on success, failure, and cancel."""
    for subdir in ["chunks", "encoded", "intermediate"]:
        path = temp_dir / subdir
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
    # Remove any loose files in temp_dir root (concat list, audio file)
    for f in temp_dir.glob("*"):
        if f.is_file():
            f.unlink(missing_ok=True)
```

### Anti-Patterns to Avoid

- **Running PySceneDetect synchronously in the event loop:** It uses OpenCV under the hood and will block asyncio for the duration of detection (can be tens of seconds for long files). Always use `loop.run_in_executor(None, ...)`.
- **Using ffmpeg's built-in scene splitting instead of PySceneDetect:** ffmpeg's `-vf select=gt(scene,...)` filter cannot export a list of scene timestamps for use in the segment muxer. PySceneDetect is required.
- **Parsing VMAF score from stderr only:** The regex `VMAF score: X.XX` is a summary line that appears at the end of ffmpeg's run. On some builds/versions it may be absent. Always write to a JSON log file and parse it; use stderr regex only as a fallback.
- **Using `model_path=` syntax for libvmaf:** This is deprecated in ffmpeg 6+. Use `model='path=...'` syntax. Both work, but the new syntax is forward-compatible.
- **Skipping PTS reset in VMAF filter graph:** Without `setpts=PTS-STARTPTS`, VMAF will compare frames by absolute PTS value. If chunks don't start at PTS 0, frames from the two inputs will be misaligned, producing nonsensical scores.
- **Not normalizing pixel format in VMAF filter:** FFV1 can be encoded in yuv420p, yuv422p, yuv444p, or 10-bit variants. libx264 outputs yuv420p. Without `format=yuv420p` on both inputs, VMAF will return 0 silently.
- **Deleting temp dirs before ffmpeg processes are fully terminated:** Windows holds file handles open. Always ensure `run_ffmpeg()` has been fully drained (or `.cancel()` has completed) before calling `shutil.rmtree`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ffmpeg subprocess with deadlock-safe stderr drain | Custom Popen wrapper | `run_ffmpeg()` from Phase 1 | Already implemented, tested, handles Windows pipe deadlock (C1), CREATE_NEW_PROCESS_GROUP (C3) |
| VMAF path escaping for Windows | Custom escape logic | `escape_vmaf_path()` from Phase 1 | Already implemented, tested |
| DB step/chunk/log state management | Custom file-based logging | Phase 2 DB API (`create_step`, `update_step`, `create_chunk`, `update_chunk`, `append_job_log`) | Already implemented, async, WAL-mode safe |
| Scene splitting at exact frame boundaries | Manual timestamp math | PySceneDetect `FrameTimecode.get_seconds()` | Frame-accurate timecodes already provided |
| VMAF aggregate score calculation | Average per-frame scores manually | libvmaf's own pooling (`pool=harmonic_mean` or default mean in JSON output) | libvmaf handles pooling internally |
| Audio codec selection at encode time | Branching subprocess calls | Single dispatch table `AUDIO_CODECS` dict | ffmpeg handles all four codecs; dispatch table is 5 lines |

**Key insight:** This phase is almost entirely orchestration. The hard technical work (subprocess safety, DB schema, async patterns) was done in Phases 1–2. The primary risk is incorrect filter graph construction, not subprocess management.

---

## Common Pitfalls

### Pitfall 1: VMAF Score Returns Zero or NaN (C5)

**What goes wrong:** libvmaf silently returns 0.000 or NaN when pixel formats differ between the two inputs or when PTS values don't align.

**Why it happens:** FFV1 source chunks may have a different chroma subsampling (yuv420p10le, yuv422p, etc.) than the x264-encoded output (always yuv420p). libvmaf requires identical formats. Additionally, if chunks don't start at PTS 0 (even with `-reset_timestamps 1`, edge cases exist), frame pairing is wrong.

**How to avoid:** Always include `format=yuv420p` and `setpts=PTS-STARTPTS` on both inputs in the VMAF filter graph (Pattern 9 above). Validate VMAF scoring works correctly on a test chunk before building the full pipeline.

**Warning signs:** VMAF scores consistently at 0.0 or 100.0 regardless of CRF. CRF loop hits ceiling on every chunk. "could not compute VMAF" in ffmpeg stderr.

### Pitfall 2: CRF Loop Oscillation (m5)

**What goes wrong:** CRF 17 gives VMAF 96.0 (too low), so CRF decreases to 16 which gives VMAF 97.8 (too high), which increases CRF back to 17, repeating forever.

**Why it happens:** VMAF response to CRF is not always monotonic for short chunks. Small changes in CRF can sometimes flip VMAF across the target boundary.

**How to avoid:** Track visited CRF values in a set. If a CRF is revisited, exit the loop and accept the best result. Cap at 10 iterations regardless. (Pattern 10 above.)

**Warning signs:** A single chunk takes many minutes to encode (many re-encodes). Terminal output shows same CRF values alternating.

### Pitfall 3: Zero Scenes Detected

**What goes wrong:** PySceneDetect finds no scene boundaries (all frames pass below threshold), leaving `scenes` as an empty list. Pipeline proceeds to split with no segment_times, producing one chunk, then the loop runs but the chunk wasn't split correctly.

**Why it happens:** Source video may have no hard cuts (slow-motion, static camera, animated content). Threshold of 27 may be too high for some content.

**How to avoid:** Check `if not scenes` immediately after `detect()` and raise a hard error with a helpful message (CONTEXT.md decision). Do not fall through silently.

**Warning signs:** `No scenes detected in <source>. Check source file or lower --scene-threshold.`

### Pitfall 4: Concat List Unsafe File Name Error

**What goes wrong:** ffmpeg's concat demuxer rejects file paths that contain spaces, absolute Windows drive letters, or special characters when using the default `safe=1` mode.

**Why it happens:** The concat demuxer's safety check is on by default. Any path with a space (e.g., `D:\My Videos\`) fails.

**How to avoid:** Always pass `-safe 0` to the concat demuxer. Write paths using `.as_posix()` inside the concat list file. (Pattern 11 above.)

**Warning signs:** `Unsafe file name` in ffmpeg stderr during the concat step.

### Pitfall 5: Windows File Handle Prevents Cleanup

**What goes wrong:** `shutil.rmtree` raises `PermissionError` on Windows because ffmpeg still holds a file handle on a chunk or encoded file.

**Why it happens:** Windows file locking is mandatory (not advisory like POSIX). If the ffmpeg process has not fully exited when cleanup runs, its file handles are still open.

**How to avoid:** Ensure each `run_ffmpeg()` call has been fully drained (iterator exhausted OR `.cancel()` called and completed) before calling cleanup. The `finally` block in the pipeline should only call cleanup after all ffmpeg processes are confirmed done.

**Warning signs:** `PermissionError: [WinError 32] The process cannot access the file because it is being used by another process` during cleanup.

### Pitfall 6: Heartbeat Not Updated During Long Steps

**What goes wrong:** FFV1 encoding of a large source file can take 30+ minutes. If `update_heartbeat` is never called during the encode, Phase 4's `recover_stale_jobs` will reset the job to QUEUED mid-encode (after 60 seconds with no heartbeat).

**Why it happens:** The heartbeat timeout is 60 seconds (`HEARTBEAT_STALE_SECONDS = 60` from Phase 2). FFV1 encode is a single blocking `run_ffmpeg()` call.

**How to avoid:** Update heartbeat inside the `run_ffmpeg()` iteration loop. Call `await update_heartbeat(db_path, job_id)` every N progress events (e.g., every 30 events, approximately every ~10 seconds at typical ffmpeg progress rates). Since `run_ffmpeg()` returns sync progress events, use `asyncio.create_task` or call `asyncio.ensure_future` to schedule the heartbeat update without blocking the iteration.

**Pattern for heartbeat inside sync iteration:**

```python
import asyncio
event_count = 0
loop = asyncio.get_event_loop()
proc = run_ffmpeg(cmd)
for event in proc:
    event_count += 1
    if event_count % 30 == 0:
        # Schedule async heartbeat without awaiting (fire-and-forget)
        asyncio.ensure_future(update_heartbeat(db_path, job_id))
```

**Warning signs:** Job resets to QUEUED during a long FFV1 encode. Only manifests in Phase 4 when the scheduler is active, but the pattern must be in place from Phase 3.

### Pitfall 7: VMAF Model Path

**What goes wrong:** The VMAF filter fails with "could not parse model config" or "No such file" because the model path is incorrect or incorrectly escaped.

**Why it happens:** Three separate issues can cause this: (1) wrong path (model not in `assets/`), (2) Windows drive-letter colon not escaped in filter string, (3) using old `.pkl` model format with libvmaf 2.x (which requires `.json`).

**How to avoid:** Use `Path(__file__).parent.parent.parent / "assets" / "vmaf_v0.6.1.json"` for the model path (resolves to the `assets/` directory relative to `pipeline.py` in `src/encoder/`). Validate the path exists at pipeline startup. Use `escape_vmaf_path()` (already handles the colon escaping). Use `.json` model only — the `.pkl` and `.pkl.model` files in `assets/` are legacy formats from libvmaf 1.x.

**Warning signs:** "could not parse model config" in ffmpeg stderr. VMAF scoring step fails immediately.

---

## Code Examples

### Complete VMAF Filter Command (verified pattern)

```python
# Source: Netflix VMAF ffmpeg.md + Streaming Learning Center Windows guide
# Verified: escape_vmaf_path handles C\\:/ colon escaping (already in Phase 1)
# Input 0 = distorted (encoded), Input 1 = reference (FFV1)

filter_graph = (
    "[0:v]setpts=PTS-STARTPTS,format=yuv420p[dist];"
    "[1:v]setpts=PTS-STARTPTS,format=yuv420p[ref];"
    "[dist][ref]libvmaf=model='path={escaped_model_path}'"
    ":log_fmt=json:log_path={escaped_log_path}:n_threads=4"
)
cmd = [
    "C:/ffmpeg/ffmpeg.exe", "-y",
    "-i", "encoded_chunk.mov",   # input 0 = distorted
    "-i", "ffv1_chunk.mov",      # input 1 = reference
    "-lavfi", filter_graph,
    "-f", "null", "-",
]
```

### PySceneDetect Scene List to Segment Times

```python
# Source: https://www.scenedetect.com/docs/latest/api.html
# FrameTimecode.get_seconds() returns float (seconds since start)
# scenes[0] = (0.000, end_of_scene_1) — skip, ffmpeg starts from 0

from scenedetect import detect, ContentDetector

scenes = detect("intermediate.mov", ContentDetector(threshold=27))
# scenes = [(FrameTimecode(0), FrameTimecode(1249)), (FrameTimecode(1250), ...), ...]

segment_times = ",".join(
    f"{scene[0].get_seconds():.6f}"
    for scene in scenes[1:]  # skip first scene (starts at 0)
)
# e.g., "50.041667,102.125000,..."
```

### x264-params Dict to ffmpeg String

```python
# Source: ffmpeg docs (libx264.c) + WebSearch verification
# Colon is the separator; key=value pairs
# Matches original PowerShell script's -x264-params usage

x264_params = {
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
}

x264_params_str = ":".join(f"{k}={v}" for k, v in x264_params.items())
# "partitions=i4x4+p8x8+b8x8:trellis=2:deblock=-3:-3:..."
```

### Config JSON Schema (matches DB config blob from Phase 2)

```json
{
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
    "flags": "-loop"
  }
}
```

### VMAF JSON Log Parsing (libvmaf 2.x format)

```python
# libvmaf 2.x JSON log structure (vmaf_v0.6.1.json model)
# The "pooled_metrics" key contains aggregate scores
# Fallback: average the per-frame "vmaf" scores

import json

with open(log_path) as f:
    data = json.load(f)

# Primary: pooled_metrics (libvmaf 2.x)
vmaf = (data.get("pooled_metrics") or {}).get("vmaf", {}).get("mean")

# Fallback: average from frames array
if vmaf is None:
    frames = data.get("frames", [])
    scores = [f["metrics"]["vmaf"] for f in frames if "metrics" in f and "vmaf" in f["metrics"]]
    vmaf = sum(scores) / len(scores) if scores else None
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `model_path=` in libvmaf filter | `model='path=...'` syntax | ffmpeg 6+ (2023) | Old syntax still works but deprecated; use new syntax for Phase 3 |
| `.pkl` / `.pkl.model` VMAF models | `.json` VMAF models | libvmaf 2.0 | Only `.json` models work with libvmaf 2.x; `.pkl` files in `assets/` are unusable |
| Plex Transcoder for EAC3 audio | Direct ffmpeg EAC3 transcode | This project | ffmpeg built-in EAC3 encoder; cross-platform; no Plex dependency |
| PySceneDetect `VideoManager` API | `open_video()` / `detect()` API | PySceneDetect 0.6 | `VideoManager` is removed; 0.6+ uses `open_video()` and `SceneManager` |
| PySceneDetect CSV output parsing | Python API `FrameTimecode.get_seconds()` | PySceneDetect 0.6 | Python API is more reliable than CSV parsing; no file I/O needed |

**Deprecated/outdated in this project:**
- `.pkl` and `.pkl.model` files in `assets/`: These are libvmaf 1.x model format. Only `vmaf_v0.6.1.json` and `vmaf_4k_v0.6.1.json` are usable with current ffmpeg builds. Do not use the `.pkl` files.
- `model_path=` libvmaf filter option: Use `model='path=...'` instead.
- Plex Transcoder / EAE: Replaced by `ffmpeg -c:a eac3`.

---

## Open Questions

1. **VMAF log file path escaping on Windows when log path contains temp directory with spaces**
   - What we know: `escape_vmaf_path()` escapes drive-letter colons. The log_path inside the filter string also needs escaping.
   - What's unclear: Does `escape_vmaf_path()` also need to handle spaces in the log path? ffmpeg's filter string parser may require spaces to be escaped with `\\ ` (backslash-space).
   - Recommendation: Use a temp file in the system temp directory (no spaces in typical Windows temp paths like `C:\Users\Username\AppData\Local\Temp`). If the username contains spaces, the plan should use `tempfile.mkstemp` which places files in a system temp dir. Alternatively, write the log file into `--temp-dir` which the user controls.

2. **FFV1 source chunk for VMAF: which file to use as reference?**
   - What we know: The VMAF comparison is encoded chunk vs. its source material. The FFV1 intermediate is split into chunks via `ffmpeg -f segment`. Those chunk files are the FFV1 reference.
   - What's unclear: Do we compare each encoded chunk against the corresponding FFV1 chunk file, or against a time-range extracted from the full FFV1 intermediate?
   - Recommendation: Compare against the corresponding FFV1 chunk file (simpler, avoids timestamp arithmetic, matches the PowerShell script's approach). The chunk split step creates `chunks/chunk000000.mov` etc.; the VMAF step compares `encoded/chunk000000.mov` against `chunks/chunk000000.mov`.

3. **EAC3 encoder availability in the installed ffmpeg build**
   - What we know: STATE.md flags this as a Phase 3 readiness concern: "EAC3 encoding requires an ffmpeg build with the eac3 encoder — validate before Phase 3."
   - What's unclear: The BtbN FFmpeg-Builds binary installed at `C:/ffmpeg/ffmpeg.exe` should include the EAC3 encoder (it's in the full builds), but this was not verified.
   - Recommendation: The Wave 0 task should run `ffmpeg -encoders | grep eac3` and fail fast if absent. Include this as a startup validation in `pipeline.py`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest >=8.0 (already configured in pyproject.toml) |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` — already exists |
| Quick run command | `pytest tests/test_pipeline.py -x` |
| Full suite command | `pytest tests/ -v` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-01 | FFV1 intermediate is created from source | integration | `pytest tests/test_pipeline.py::test_ffv1_encode -x` | Wave 0 |
| PIPE-02 | Scene boundaries detected from FFV1 file | integration | `pytest tests/test_pipeline.py::test_scene_detect -x` | Wave 0 |
| PIPE-02 | Zero scenes raises PipelineError | unit | `pytest tests/test_pipeline.py::test_zero_scenes_error -x` | Wave 0 |
| PIPE-03 | FFV1 split into N chunk files at scene boundaries | integration | `pytest tests/test_pipeline.py::test_chunk_split -x` | Wave 0 |
| PIPE-04 | Audio transcoded to each supported codec (AAC, FLAC, copy) | integration | `pytest tests/test_pipeline.py::test_audio_transcode -x` | Wave 0 |
| PIPE-05 | Chunk encoded with x264 at specified CRF | integration | `pytest tests/test_pipeline.py::test_x264_encode -x` | Wave 0 |
| PIPE-06 | VMAF score obtained from libvmaf comparison | integration | `pytest tests/test_pipeline.py::test_vmaf_score -x` | Wave 0 |
| PIPE-07 | CRF adjusts ±1 when VMAF outside range; stops at bounds | unit | `pytest tests/test_pipeline.py::test_crf_feedback_loop -x` | Wave 0 |
| PIPE-07 | CRF loop detects oscillation and exits | unit | `pytest tests/test_pipeline.py::test_crf_oscillation_guard -x` | Wave 0 |
| PIPE-08 | All chunks concatenated and muxed into final MKV | integration | `pytest tests/test_pipeline.py::test_concat_mux -x` | Wave 0 |
| PIPE-09 | Temp dirs cleaned up after successful encode | integration | `pytest tests/test_pipeline.py::test_cleanup_on_success -x` | Wave 0 |
| PIPE-09 | Temp dirs cleaned up after cancel | integration | `pytest tests/test_pipeline.py::test_cleanup_on_cancel -x` | Wave 0 |
| CONF-01 | VMAF min/max range respected in loop | unit | covered by test_crf_feedback_loop | Wave 0 |
| CONF-02 | CRF bounds respected; never goes below min or above max | unit | covered by test_crf_feedback_loop | Wave 0 |
| CONF-03 | Audio codec selection dispatches correct ffmpeg flag | unit | `pytest tests/test_pipeline.py::test_audio_codec_dispatch -x` | Wave 0 |
| CONF-04 | x264_params dict serializes to correct -x264-params string | unit | `pytest tests/test_pipeline.py::test_x264_params_str -x` | Wave 0 |

**Test strategy notes:**
- Integration tests use real ffmpeg with lavfi synthetic sources (no binary test assets)
- For VMAF tests: generate two short (2–3 second) lavfi clips, one at higher quality, confirm VMAF score is non-zero and reasonable (>50)
- For pipeline end-to-end: a synthetic 10-second lavfi MKV with an embedded audio stream (use `aevalsrc` lavfi source)
- EAC3 test may need to be skipped if the ffmpeg build does not include the eac3 encoder (conditional skip)

### Sampling Rate

- **Per task commit:** `pytest tests/test_pipeline.py -x`
- **Per wave merge:** `pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/test_pipeline.py` — all test stubs above (RED state initially)
- [ ] `src/encoder/pipeline.py` — skeleton with `run_pipeline` raising `NotImplementedError`
- [ ] `assets/vmaf_v0.6.1.json` — already exists (confirmed in repo)
- [ ] Add `scenedetect[opencv]>=0.6.7,<0.7` to `pyproject.toml` dependencies

---

## Sources

### Primary (HIGH confidence)

- Phase 1 RESEARCH.md — ffmpeg subprocess patterns, VMAF path escaping, FfmpegProcess API
- Phase 2 db.py — DB API (create_step, update_step, create_chunk, update_chunk, append_job_log, update_heartbeat)
- `src/encoder/ffmpeg.py` — existing run_ffmpeg(), escape_vmaf_path() implementations
- `assets/` directory listing — vmaf_v0.6.1.json confirmed present
- PITFALLS.md — C4 (VMAF path escaping), C5 (VMAF resolution/format mismatch), m5 (CRF oscillation), M3 (concat unsafe filename), M6 (temp cleanup) — all directly applicable to Phase 3
- https://www.scenedetect.com/docs/latest/api.html — PySceneDetect 0.6.7 Python API: `detect()`, ContentDetector, FrameTimecode.get_seconds()
- PowerShell script `video-encode-web-1080p.ps1` — original pipeline reference for all ffmpeg command patterns

### Secondary (MEDIUM confidence)

- https://websites.fraunhofer.de/video-dev/calculating-vmaf-and-psnr-with-ffmpeg/ — VMAF filter_complex syntax with two inputs verified
- https://streaminglearningcenter.com/blogs/compute-vmaf-using-ffmpeg-on-windows.html — Windows VMAF path escaping pattern `C\\:/` verified (multiple sources agree)
- https://github.com/Netflix/vmaf/blob/master/resource/doc/ffmpeg.md — input order (distorted first, reference second), filter syntax, model='path=...' deprecation of model_path=
- WebSearch: x264-params colon separator format — verified against ffmpeg libx264.c source and encoding.com documentation

### Tertiary (LOW confidence)

- VMAF JSON log structure (`pooled_metrics.vmaf.mean`) — inferred from libvmaf 2.x documentation and ffmpeg-quality-metrics library source; exact key names should be validated against a real VMAF run during Wave 0

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all stdlib + Phase 1/2 foundations already in place; scenedetect pinned
- Architecture (pipeline structure, step tracking, cancel_event pattern): HIGH — derived from CONTEXT.md locked decisions and Phase 4 integration contract
- VMAF filter graph: MEDIUM-HIGH — input order, setpts, format normalization verified from multiple authoritative sources; JSON log key names need one-time validation
- PySceneDetect API: HIGH — official 0.6.7 docs, detect() + FrameTimecode.get_seconds() verified
- x264-params serialization: HIGH — colon separator is the documented format, confirmed in libx264.c source
- Pitfalls: HIGH — C4, C5, M3, m5, M6 all directly applicable, documented from prior project research

**Research date:** 2026-03-07
**Valid until:** 2026-06-07 (PySceneDetect API stable within 0.6.x; ffmpeg libvmaf syntax stable; VMAF JSON format stable in 2.x)
