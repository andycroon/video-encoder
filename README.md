# VibeCoder Video Encoder

VibeCoder Video Encoder — batch x264 encoding with VMAF-targeted quality, designed for a single-user local workflow.

## What This Is

This project converts a PowerShell encoding script into a cross-platform Python library, CLI, and (eventually) web application. The current state is a Python library and CLI (Phases 1–3) that will gain a browser-based UI in Phase 5. See [the roadmap](.planning/ROADMAP.md) for the full build plan and phase breakdown.

---

## Tech Stack

### Backend

| Technology | Version Pin | Role |
|------------|-------------|------|
| Python | >=3.9 | Runtime |
| FastAPI | (latest stable) | HTTP framework + SSE streaming via StreamingResponse |
| uvicorn | (latest stable) | ASGI server |
| aiosqlite | >=0.22,<0.23 | Async SQLite access |
| SQLite | (stdlib) | State persistence — jobs, chunks, steps, settings |
| asyncio | (stdlib) | Async event loop, Queue, create_subprocess_exec |
| ThreadPoolExecutor | (stdlib) | Runs blocking ffmpeg subprocesses on Windows (SelectorEventLoop workaround) |
| PySceneDetect | >=0.6.7,<0.7 | Scene boundary detection (opencv variant) |
| ffmpeg | external binary | Video encode/decode, VMAF scoring, audio transcode |

### Frontend (Phase 5 — in progress)

| Technology | Version Pin | Role |
|------------|-------------|------|
| React | 19 | UI framework |
| TypeScript | (latest stable) | Type safety |
| Vite | (latest stable) | Dev server + build tool |

### Key Architecture Notes

- Job queue: asyncio.Queue + asyncio.create_subprocess_exec (no Celery, no Redis)
- Progress streaming: SSE (Server-Sent Events) — no WebSockets
- Windows subprocess: ThreadPoolExecutor + sync Popen (asyncio SelectorEventLoop cannot run subprocesses on Windows)
- Database mode: SQLite WAL — one writer, concurrent readers, survives restarts
- VMAF model: bundled in assets/vmaf_v0.6.1.json (no runtime download needed)

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

---

## Phase 4: Web API + Scheduler

### Starting the Server

From the project root, start uvicorn:

```bash
python -m uvicorn encoder.main:app --host 127.0.0.1 --port 8000
```

Wait for the line: `Application startup complete.`

To change host or port:

```bash
python -m uvicorn encoder.main:app --host 0.0.0.0 --port 9000
```

The database is created automatically as `encoder.db` in the current working directory on first run.

On startup the server:
1. Initialises the SQLite database (creates tables if missing)
2. Recovers stale RUNNING jobs → QUEUED so they re-encode after a crash
3. Re-enqueues any QUEUED jobs that survived a restart
4. Starts the serial job scheduler (one job at a time)
5. Starts the watch folder poller (if `watch_folder_path` is configured in settings)

### Testing the API

The following steps verify the server, job submission, and SSE streaming are all working. Run them in order with the server already started in a separate terminal.

**Step 1 — confirm the server is up:**

```bash
curl http://127.0.0.1:8000/
```

Expected response: `{"status": "ok"}` (or similar). If curl times out, the server is not running.

**Step 2 — read default settings:**

```bash
curl http://127.0.0.1:8000/settings
```

Expected response: JSON object with all 9 keys (`vmaf_min`, `vmaf_max`, `crf_start`, etc.) at their default values.

**Step 3 — open the SSE stream in a second terminal:**

Open a second terminal and run this before submitting the job, so you don't miss any events:

```bash
curl -N http://127.0.0.1:8000/jobs/1/stream
```

This will show `: ping` every 15 seconds until the job starts. Leave it running.

**Step 4 — submit a job (back in the first terminal):**

Submitting a job starts it automatically — no separate start command is needed.

Replace the path with the absolute path to any MKV file on disk.

**Linux / macOS / Git Bash:**
```bash
curl -X POST http://127.0.0.1:8000/jobs \
  -H "Content-Type: application/json" \
  -d '{"source_path": "/path/to/your/file.mkv"}'
```

**Windows (Command Prompt / PowerShell):**
```bash
curl -X POST http://127.0.0.1:8000/jobs -H "Content-Type: application/json" -d "{\"source_path\": \"C:\\path\\to\\your\\file.mkv\"}"
```

Expected response:
```json
{"id": 1, "source_path": "...", "status": "QUEUED", ...}
```

Expected output (events arrive within seconds of job starting):
```
event: stage
data: {"job_id": 1, "stage": "ffv1", ...}

event: stage
data: {"job_id": 1, "stage": "scenedetect", ...}

: ping

event: job_complete
data: {"job_id": 1, "status": "DONE"}
```

If the source file does not exist, you will see `event: error` followed by `event: job_complete` with `"status": "FAILED"` — this is expected and still confirms SSE is working correctly. The stream will close automatically after `job_complete`.

If the stream hangs with no output, check the server terminal for errors.

### Job Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /jobs | Submit a new encoding job |
| GET | /jobs | List all jobs (optional `?status=QUEUED`) |
| GET | /jobs/{id} | Get a single job by ID |
| PATCH | /jobs/{id}/pause | Pause or unpause an active job |
| DELETE | /jobs/{id} | Cancel a job |
| POST | /jobs/{id}/retry | Retry a failed or cancelled job |
| GET | /jobs/{id}/stream | SSE stream of job progress events |

SSE named events emitted on `/jobs/{id}/stream`: `stage`, `chunk_progress`, `chunk_complete`, `job_complete`, `error`, `warning`.

### Settings API

| Method | Path | Description |
|--------|------|-------------|
| GET | /settings | Read all global defaults |
| PUT | /settings | Update one or more global defaults |

**Read current settings:**

```bash
curl http://127.0.0.1:8000/settings
```

**Update one or more settings** (any subset of keys is valid — omitted keys are unchanged):

```bash
curl -X PUT http://127.0.0.1:8000/settings \
  -H "Content-Type: application/json" \
  -d '{"vmaf_min": 95.0, "vmaf_max": 97.0}'
```

Settings are persisted in SQLite and survive server restarts.

### Global Defaults Reference

| Key | Default | Description |
|-----|---------|-------------|
| `vmaf_min` | 96.2 | Minimum acceptable VMAF score |
| `vmaf_max` | 97.6 | Maximum acceptable VMAF score |
| `crf_start` | 17 | Starting CRF value per chunk |
| `crf_min` | 16 | CRF floor (never encode below this) |
| `crf_max` | 20 | CRF ceiling (never encode above this) |
| `audio_codec` | eac3 | Audio codec: `eac3`, `aac`, `flac`, or `copy` |
| `output_path` | `` | Output directory for final MKVs (empty = `./output`) |
| `temp_path` | `` | Working directory for intermediates (empty = `./temp`) |
| `watch_folder_path` | `` | Directory to watch for new MKV files (empty = disabled) |

### Watch Folder

Set `watch_folder_path` to an absolute directory path to enable automatic job submission. The server polls every 10 seconds. A file is only enqueued after its size has been stable for 5 consecutive seconds — this handles slow network copies and NAS transfers. Source files are never moved or deleted.

**Enable:**
```bash
curl -X PUT http://127.0.0.1:8000/settings \
  -H "Content-Type: application/json" \
  -d '{"watch_folder_path": "/path/to/watch/folder"}'
```

**Disable:**
```bash
curl -X PUT http://127.0.0.1:8000/settings \
  -H "Content-Type: application/json" \
  -d '{"watch_folder_path": ""}'
```

After enabling, drop any `.mkv` file into the watch folder and the server will pick it up within 10 seconds and submit it as a new job automatically.

### Disk Space Pre-flight

Before starting each job, the server checks that available disk space on the output drive is at least 3× the source file size. If space is insufficient, a `warning` SSE event is emitted on the job's `/stream` endpoint and a warning is logged to the server console. The job proceeds regardless — it is a warning only, not a block.

