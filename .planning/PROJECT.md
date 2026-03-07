# VibeCoder Video Encoder

## What This Is

A cross-platform (Windows + Linux) web application that replaces a PowerShell video encoding script. It provides a browser-based UI to manage a queue of video encoding jobs, each running a scene-aware x264 encoding pipeline with per-chunk VMAF quality feedback, configurable audio output, and real-time progress monitoring.

## Core Value

Every source video can be encoded to a precise VMAF quality target with zero manual intervention — queue it, watch it, get the result.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Cross-platform backend (Python) runs on Windows and Linux
- [ ] Web UI allows adding jobs via file path entry, folder browse, browser upload, or watch folder
- [ ] Queue management: pause, cancel, reorder, and retry failed jobs
- [ ] Real-time progress display per job (current stage, chunk progress, VMAF scores, CRF)
- [ ] Per-job configuration: VMAF target range, CRF bounds, audio codec (EAC3, AAC, FLAC, copy)
- [ ] Scene-based chunking pipeline preserved (FFV1 intermediate → scenedetect → split → encode chunks → merge → mux)
- [ ] VMAF feedback loop per chunk (adjust CRF ±1 until score lands in target range)
- [ ] Configurable input/output/temp directory paths
- [ ] Remove Plex Transcoder dependency — audio encoding via ffmpeg or other cross-platform tools

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
*Last updated: 2026-03-07 after initialization*
