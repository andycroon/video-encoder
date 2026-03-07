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
