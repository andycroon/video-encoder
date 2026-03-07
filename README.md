# VibeCoder Video Encoder

VibeCoder Video Encoder — batch x264 encoding with VMAF-targeted quality, designed for a single-user local workflow.

## What This Is

This project converts a PowerShell encoding script into a cross-platform Python library, CLI, and (eventually) web application. The current state is a Python library and CLI (Phases 1–3) that will gain a browser-based UI in Phase 5. See [the roadmap](.planning/ROADMAP.md) for the full build plan and phase breakdown.

---

## System Prerequisites

### Python

Python 3.9 or higher is required.

Download from: https://www.python.org/downloads/

Verify:

```bash
python --version
```

### ffmpeg

ffmpeg must be built with libx264 and libvmaf support.

**Windows:**

Place `ffmpeg.exe` at `C:\ffmpeg\ffmpeg.exe`. The encoder expects this exact path on Windows.

Download from: https://ffmpeg.org/download.html — use a build that lists libx264 and libvmaf in its configuration (e.g., a full gpl build from https://github.com/BtbN/FFmpeg-Builds/releases).

**Linux:**

Install via package manager:

```bash
sudo apt install ffmpeg
```

Or compile from source with the required codec support:

```bash
./configure --enable-libx264 --enable-libvmaf
make && sudo make install
```

**Verify (both platforms):**

```bash
ffmpeg -version
```

The output should include `--enable-libx264` and `--enable-libvmaf` in the configuration line.

### PySceneDetect

```bash
pip install "scenedetect[opencv]>=0.6.7,<0.7"
```

Verify:

```bash
scenedetect version
```

### Plex Transcoder (optional)

Plex Transcoder is only required if you use the EAC3 audio codec option (a Phase 3 feature). It is not needed for Phases 1 or 2. If required, it is expected at:

```
C:\Program Files\Plex\Plex Media Server\Plex Transcoder.exe
```

---

## VMAF Model Setup

The encoder expects VMAF model files in the `assets/` directory at the project root.

**Model file required:** `vmaf_v0.6.1.json` (standard HD model)

**Location:** `assets/vmaf_v0.6.1.json`

Download from: https://github.com/Netflix/vmaf/tree/master/model

The `assets/` directory is already present in this repository with the model file included. If you cloned this repo, no action is required.

---

## Development Setup

```bash
# Clone the repo
git clone <repo-url>
cd video-encoder

# Install the encoder package in editable mode + dev dependencies
pip install -e ".[dev]"

# Run the test suite
pytest tests/ -v
```

Tests use real ffmpeg with lavfi synthetic sources — no binary test assets are committed to the repo. Ensure ffmpeg is on PATH (or placed at `C:\ffmpeg\ffmpeg.exe` on Windows) before running tests.

Expected runtime: ~20 seconds.

---

## Database

### File Location

`encoder.db` is created in the current working directory by default. The path is passed as a parameter to all `db.py` functions; Phase 4 will expose it as a configurable setting. During testing, pytest uses a temporary directory (`tmp_path`) so no `encoder.db` is left in the project root after a test run.

### State Persistence

SQLite WAL (Write-Ahead Logging) mode is enabled on every connection. WAL mode persists at the file level — once set, all subsequent connections see WAL mode automatically.

A job's full lifecycle (`QUEUED` → `RUNNING` → `DONE` / `FAILED` / `CANCELLED`) is stored in the `jobs` table. Per-chunk VMAF scores and CRF values are stored in the `chunks` table. Pipeline stage progress (FFV1 encode, scene detect, chunk split, audio extraction, concat, mux) is stored in the `steps` table.

All state survives application restarts. Jobs left in `RUNNING` state with a stale heartbeat (no update for more than 60 seconds) are automatically reset to `QUEUED` at startup via `recover_stale_jobs()`.

### Resetting the Database

Delete the database file and its WAL companions:

```bash
rm encoder.db encoder.db-wal encoder.db-shm
```

The next application start recreates the schema automatically via `init_db()`.

---

## Phase 3: Pipeline Runner

The pipeline CLI encodes a source MKV file through the full 10-step process: FFV1 intermediate encode, scene detection, chunk splitting, audio transcode, per-chunk x264 encode with VMAF CRF feedback loop, concat, mux, and cleanup.

### CLI Usage

```bash
python -m encoder.pipeline source.mkv [options]
```

**Arguments:**

| Flag | Default | Description |
|------|---------|-------------|
| `source` | (required) | Path to source MKV file |
| `--config` | (none) | Path to config JSON file |
| `--output-dir` | `./output` | Destination directory for the final MKV |
| `--temp-dir` | `./temp` | Working directory for intermediates, chunks, and encoded files |
| `--scene-threshold` | `27.0` | PySceneDetect ContentDetector threshold |

### Pipeline Configuration

The pipeline is controlled by a JSON config file (or the built-in defaults). Pass it via `--config path/to/config.json`.

**Config schema:**

```json
{
  "vmaf_min": 96.2,
  "vmaf_max": 97.6,
  "crf_start": 17,
  "crf_min": 16,
  "crf_max": 20,
  "audio_codec": "eac3",
  "scene_threshold": 27.0,
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

**Key parameters:**

- `vmaf_min` / `vmaf_max` — Acceptable VMAF score range (default: 96.2–97.6). Each chunk is re-encoded until its VMAF score lands in this window.
- `crf_start` — Initial CRF value per chunk (default: 17). Lower = higher quality, larger file.
- `crf_min` / `crf_max` — CRF bounds for the feedback loop (default: 16–20). The loop will not go below `crf_min` or above `crf_max`.
- `audio_codec` — Audio encoder. Options: `eac3`, `aac`, `flac`, `copy`. Default: `eac3`.
- `scene_threshold` — PySceneDetect ContentDetector sensitivity (default: 27.0). Lower = more scene cuts detected.
- `x264_params` — libx264 encoding parameters passed via `-x264-params`. Defaults reflect the original high-quality slow preset from the PowerShell script.

### Output and Temp Paths

- `--output-dir` receives the final `<source-stem>.mkv` output file.
- `--temp-dir` holds all intermediates (FFV1 lossless, chunks, encoded chunks, audio, concat list). The temp directory is wiped after a successful encode or on cancel.
- The SQLite database (`encoder.db`) is created inside `--temp-dir`.

### Cancel Behavior

Press `Ctrl+C` during encoding to trigger a graceful cancel:

1. The active ffmpeg process is stopped.
2. All temp subdirectories (`chunks/`, `encoded/`, `intermediate/`) are removed.
3. The job status in the database is set to `CANCELLED` (distinct from `FAILED`).
4. The output directory is left untouched if muxing had not started.

In scripts, send SIGINT to the process. The `run_pipeline` function accepts a `cancel_event: threading.Event` that can be set externally (Phase 4 uses this from the web API).

### Pipeline Steps

The pipeline executes these steps in order, writing step status to the DB after each:

1. **FFV1** — Source MKV → lossless FFV1 `.mov` intermediate (preserves quality for scene splitting)
2. **SceneDetect** — PySceneDetect finds scene cut boundaries
3. **ChunkSplit** — FFmpeg splits the FFV1 intermediate at scene boundaries into chunk files
4. **AudioTranscode** — Source audio → target codec (default: EAC3)
5. **Per-chunk encode + VMAF loop** — Each chunk encoded with libx264; CRF adjusted ±1 until VMAF score lands in `[vmaf_min, vmaf_max]`, bounded by `[crf_min, crf_max]`
6. **Concat** — Encoded chunks merged into a single MP4 via ffmpeg concat demuxer
7. **Mux** — Video + audio muxed into the final `.mkv` output
8. **Cleanup** — Temp subdirectories removed

### Python API

```python
import asyncio
import threading
from pathlib import Path
from encoder.pipeline import run_pipeline, DEFAULT_CONFIG

cancel_event = threading.Event()
config = dict(DEFAULT_CONFIG)

asyncio.run(run_pipeline(
    source_path=Path("source.mkv"),
    db_path=Path("encoder.db"),
    job_id=job_id,          # from encoder.db.create_job()
    config=config,
    cancel_event=cancel_event,
    output_dir=Path("output/"),
    temp_dir=Path("temp/"),
))
```

