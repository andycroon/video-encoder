# VibeCoder Video Encoder

## What This Is

A cross-platform (Windows + Linux) web application that replaces a PowerShell video encoding script. It provides a browser-based UI to manage a queue of video encoding jobs, each running a scene-aware x264 encoding pipeline with per-chunk VMAF quality feedback, configurable audio output, and real-time progress monitoring.

## Core Value

Every source video can be encoded to a precise VMAF quality target with zero manual intervention — queue it, watch it, get the result.

## Current Milestone: v1.1 Quality & Manageability

**Goal:** Improve pipeline quality (parallel encoding, job resume, smart CRF), expand file input options, add proper job history management, and polish the UI with charts and dark mode.

**Target features:**
- Parallel chunk encoding with configurable concurrency
- Job resume from last completed step after crash/restart
- Smart CRF oscillation resolution (pick encode closest to VMAF window center)
- Browser file upload and server-side directory browser
- Job deletion, bulk-clear, history view, and auto-cleanup
- VMAF history chart, CRF convergence indicator, dark mode

## Requirements

### Validated

- ✓ Cross-platform backend (Python) runs on Windows and Linux — v1.0
- ✓ Web UI queue management (add, pause, cancel, retry) — v1.0
- ✓ Real-time progress display (stage, chunk, VMAF, CRF, ETA) — v1.0
- ✓ Per-job and global configuration (VMAF range, CRF bounds, audio codec, paths) — v1.0
- ✓ Scene-based chunking pipeline (FFV1 → scenedetect → split → x264+VMAF → mux) — v1.0
- ✓ Watch folder auto-enqueue — v1.0
- ✓ SSE real-time streaming, SQLite persistence, encoding profiles — v1.0

### Active

- [ ] Parallel chunk encoding with configurable concurrency limit
- [ ] Job resume from last completed pipeline step after crash/restart
- [ ] Smart CRF oscillation — select encode whose VMAF is closest to window center
- [ ] Browser file upload for source files
- [ ] Server-side directory browser for file selection
- [ ] User can delete individual completed/failed jobs
- [ ] User can bulk-clear all completed or all failed jobs
- [ ] Completed jobs separated into history view; active queue stays clean
- [ ] Auto-remove completed jobs after configurable time period
- [ ] VMAF score history chart per job (per-chunk line chart)
- [ ] CRF convergence indicator per chunk (re-encode count)
- [ ] Dark mode

### Out of Scope

- Plex Transcoder / EAE for audio — Windows-only, replaced by configurable ffmpeg audio encoding
- Hardcoded Windows paths — all paths must be configurable
- PowerShell — replaced entirely by Python backend

## Context

The original pipeline (from the PowerShell script):
1. Re-encode source MKV to FFV1 lossless intermediate (preserves quality for scene splitting)
2. PySceneDetect detects scene boundaries and outputs a CSV
3. FFmpeg splits the FFV1 intermediate at scene boundaries into `.mov` chunks
4. Audio extracted from source → FLAC → target codec (was EAC3 via Plex, now configurable)
5. Each chunk encoded with libx264 using high-quality slow settings
6. VMAF scored against FFV1 source per chunk; CRF adjusted ±1 and re-encoded until VMAF is in [vmafMin, vmafMax]
7. All encoded chunks concatenated, then muxed with audio into final MKV
8. Temp/chunk/encoded directories cleaned up

x264 settings used: `partitions=i4x4+p8x8+b8x8 trellis 2 deblock -3:-3 subq 10 me_method umh me_range 24 b_strategy 2 fixed GOP 48 sc_threshold 0`

Default quality targets: CRF 17, VMAF 96.2–97.6, CRF floor 16, CRF ceiling 20.

PySceneDetect is already Python-based, making Python the natural backend language.

## Constraints

- **Platform**: Must run natively on both Windows and Linux — no OS-specific dependencies
- **Dependencies**: ffmpeg and scenedetect must be on PATH; no Plex/Windows-only tools
- **Pipeline fidelity**: Scene-based chunking and VMAF feedback loop must be preserved

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python backend | scenedetect is Python; strong ffmpeg/subprocess support | — Pending |
| Scene-based chunking preserved | Per-scene CRF tuning gives more accurate VMAF targeting than whole-file | — Pending |
| Audio codec configurable | Removes Plex dependency; supports EAC3, AAC, FLAC, copy | — Pending |
| Multiple file input methods | Path entry + watch folder + browser upload covers local, NAS, and remote workflows | — Pending |

---
*Last updated: 2026-03-17 after v1.1 milestone start*
