# VibeCoder Video Encoder

A cross-platform web application for batch video encoding with VMAF-targeted quality. Queue `.mkv` files through a browser UI, watch them encode in real time, and get the result — no manual tuning required.

**Pipeline:** FFV1 intermediate → scene detection → parallel chunk encoding with x264 → VMAF feedback loop → mux → cleanup

---

## Features

- **VMAF quality targeting** — each scene chunk is re-encoded until its VMAF score lands in your configured range
- **Parallel chunk encoding** — configurable concurrency to saturate CPU cores
- **Job queue** — add, pause, cancel, retry jobs from the browser
- **Live progress** — per-stage pipeline status, per-chunk VMAF/CRF, ETA
- **History view** — completed jobs separated from the active queue with VMAF score charts
- **Watch folder** — drop files in a folder and they are auto-queued
- **Encoder profiles** — save named configurations with custom VMAF targets, CRF bounds, and x264 parameters
- **Authentication** — JWT-protected UI for safe remote exposure
- **Dark / light mode**

---

## Requirements

### Python

Python 3.9 or higher. Download from [python.org](https://www.python.org/downloads/).

```bash
python --version
```

### ffmpeg

Must be built with **libx264** and **libvmaf** support.

**Windows** — place `ffmpeg.exe` at `C:\ffmpeg\ffmpeg.exe`. Use a full GPL build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) which includes both codecs.

**Linux** — the system ffmpeg on Ubuntu/Debian does **not** include libvmaf. Remove it and install a static build instead:

```bash
# Remove the system ffmpeg if already installed
sudo apt remove --purge ffmpeg

# Download a static build with libvmaf included (amd64)
wget https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz
tar -xf ffmpeg-master-latest-linux64-gpl.tar.xz
sudo mv ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /usr/local/bin/
sudo mv ffmpeg-master-latest-linux64-gpl/bin/ffprobe /usr/local/bin/

# Clear bash's cached path, then verify
hash -r
ffmpeg -version
# Should show --enable-libvmaf in the configuration line
```

Alternatively, use John Van Sickle's static builds at [johnvansickle.com/ffmpeg](https://johnvansickle.com/ffmpeg/) which also include libvmaf.

Verify both codecs are present:
```bash
ffmpeg -version
# Configuration line should include --enable-libx264 and --enable-libvmaf
```

### Node.js and npm

Required to build the frontend. Download from [nodejs.org](https://nodejs.org/) (LTS recommended).

```bash
node --version
npm --version
```

### PySceneDetect

```bash
pip install "scenedetect[opencv]>=0.6.7,<0.7"
scenedetect version
```

### Plex Transcoder (optional)

Only required if you use the **EAC3** audio codec option. Expected at:
```
C:\Program Files\Plex\Plex Media Server\Plex Transcoder.exe
```
All other audio codecs (AAC, FLAC, copy) use ffmpeg directly.

---

## Installation

```bash
# 1. Clone
git clone <repo-url>
cd video-encoder

# 2. Install Python package
pip install .

# 3. Build the frontend
npm run build
```

The `npm run build` command installs frontend dependencies and produces `frontend/dist/`, which the backend serves automatically.

---

## Running the Server

### Local access

```bash
uvicorn encoder.main:app --port 8000
```

Open `http://localhost:8000` in a browser.

### Remote access (other machines on your network)

```bash
uvicorn encoder.main:app --host 0.0.0.0 --port 8000
```

Then open `http://<server-ip>:8000` from any machine on the network.

### Exposing via a reverse proxy (Caddy example)

If you want to serve the app at a domain with HTTPS, add a block to your Caddyfile:

```
encoder.yourdomain.com {
    reverse_proxy localhost:8000
}
```

Then reload Caddy:
```bash
caddy reload --config /path/to/Caddyfile
```

Make sure your domain's DNS A record points to the server's public IP.

---

## First-Time Setup

On first launch the app shows a **setup screen** where you create a username and password (minimum 8 characters). Credentials are stored as bcrypt hashes in the SQLite database — no config files needed.

After setup, every browser session begins with a **login screen**. Sessions are not persisted between browser tab closures — re-opening the app requires logging in again.

**Resetting credentials** — if locked out, delete the user row and the onboarding screen reappears:
```bash
sqlite3 encoder.db "DELETE FROM users;"
```

**Disabling authentication** — auth is only active when a user account exists. With no user rows, the app runs without authentication.

---

## Using the App

### Adding a job

1. Type or paste the full path to a `.mkv` source file in the top input bar
2. Select an encoder profile from the dropdown
3. Click **Add** — the job appears in the queue with QUEUED status

### Monitoring progress

Click any job row to expand it:
- **Pipeline** column — all stages with checkmarks and timing
- **Chunks** column — per-chunk CRF, VMAF score, and re-encode count (live)
- **ETA** — estimated time remaining based on chunk throughput
- **ffmpeg log** — full captured stderr output, auto-scrolls

### History

Completed and failed jobs appear in the **History** tab, separate from the active queue. You can delete individual jobs or bulk-clear all completed or all failed jobs.

### Watch folder

Configure a directory path in **Settings → Watch Folder**. Any `.mkv` file dropped into that folder is automatically queued within ~10 seconds.

---

## Configuration Reference

Access via **Settings** in the top bar.

| Setting | Default | Description |
|---------|---------|-------------|
| VMAF Min | 96.2 | Minimum acceptable VMAF score |
| VMAF Max | 97.6 | Maximum acceptable VMAF score |
| CRF Start | 17 | Initial CRF value per chunk |
| CRF Min | 16 | CRF floor (never encode below this) |
| CRF Max | 20 | CRF ceiling (never encode above this) |
| Audio Codec | eac3 | `eac3`, `aac`, `flac`, or `copy` |
| Output Path | `./output` | Destination for final MKV files |
| Temp Path | `./temp` | Working directory for intermediates |
| Watch Folder | _(disabled)_ | Directory to auto-queue new files |
| Max Parallel Chunks | 1 | Concurrent chunk encodes |
| Auto-Cleanup | 7 days | Remove completed jobs after N days (0 = disabled) |

Settings persist in SQLite across server restarts.

---

## Database

`encoder.db` is created in the current working directory on first run. All job state, chunk results, and settings are stored here.

**Resetting the database:**
```bash
rm encoder.db encoder.db-wal encoder.db-shm     # Linux/macOS
del encoder.db encoder.db-wal encoder.db-shm    # Windows
```

The schema is recreated automatically on the next server start.

Jobs in `RUNNING` state when the server was last stopped are automatically recovered to `QUEUED` on restart so they re-encode from their last completed step.

---

## Development

```bash
# Install with dev dependencies (upgrade pip first for editable install support)
pip install --upgrade pip
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Frontend dev server (hot reload, proxies API to localhost:8000)
# Terminal 1
uvicorn encoder.main:app --reload

# Terminal 2
cd frontend
npm run dev
# Open http://localhost:5173
```

Tests use synthetic ffmpeg sources — no test video files needed. Ensure ffmpeg is on PATH before running.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| Frontend shows blank page | `frontend/dist/` not built | Run `npm run build` from the project root |
| VMAF score is 0 | VMAF model not found | Ensure `assets/vmaf_v0.6.1.json` exists |
| Watch folder not picking up files | File still being written | Watcher waits for 5 s of size stability; large files take longer |
| `EncoderError: ffmpeg exited with code 1` | Wrong ffmpeg path or missing codec | Verify ffmpeg includes libx264 and libvmaf (`ffmpeg -version`) |
| Can't reach app from another machine | Server bound to localhost only | Start with `--host 0.0.0.0` |
| Domain returns 404 via reverse proxy | DNS or proxy misconfiguration | Check DNS A record and that the proxy port matches the server port |
