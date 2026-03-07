# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains a single PowerShell script (`video-encode-web-1080p.ps1`) for batch video encoding with adaptive quality control. It encodes MKV source files to x264 with VMAF-targeted quality, using scene-based chunking for parallelism potential and EAC3 audio via Plex Transcoder.

## Running the Script

```powershell
# Run from PowerShell (must be run as administrator or with appropriate permissions)
.\video-encode-web-1080p.ps1
```

The script is not parameterized — edit variables at the top of the file to configure paths, CRF range, and VMAF targets before running.

## Dependencies

- **ffmpeg** at `C:\ffmpeg\ffmpeg.exe` — video/audio processing and VMAF scoring
- **scenedetect** (PySceneDetect) — scene boundary detection, must be on PATH
- **Plex Transcoder** at `C:\Program Files\Plex\Plex Media Server\Plex Transcoder.exe` — EAC3 audio encoding via EAE

## Directory Structure (all on D:\Videos\)

| Path | Purpose |
|------|---------|
| `SOURCE\` | Input `.mkv` files |
| `TEMP\` | FFV1 intermediate, audio files, concat list, scene CSV |
| `CHUNKS\` | Scene-split `.mov` chunks (FFV1) |
| `ENCODED\` | x264-encoded chunks |
| `EAE\` | Audio working directory for Plex EAE |
| `FINAL\` | Output `.mkv` files + `encodinglog.txt` |

## Pipeline Architecture

1. **Intermediate encode** — Source MKV → FFV1 lossless `.mov` (preserves quality for scene splitting)
2. **Scene detection** — PySceneDetect writes a CSV with scene timestamps
3. **Chunk splitting** — FFmpeg segments the FFV1 intermediate at scene boundaries
4. **Audio extraction** — Source audio → FLAC → EAC3 via Plex Transcoder
5. **Per-chunk encoding** — Each chunk encoded with libx264 at starting CRF 17
6. **VMAF feedback loop** — VMAF scored against FFV1 source; CRF adjusted ±1 and re-encoded until score lands in `[vmafMin, vmafMax]` (default 96.2–97.6), bounded by `crfMin=16` / `crfMax=20`
7. **Concat** — All encoded chunks merged into `TEMP\1080p.mp4`
8. **Mux** — Video + EAC3 audio muxed into `FINAL\<sourcename>.mkv`
9. **Cleanup** — CHUNKS, ENCODED, and TEMP directories wiped

## Key Configuration Variables

```powershell
$crf = 17          # Starting CRF per chunk
$vmafMin = 96.2    # Minimum acceptable VMAF score
$vmafMax = 97.6    # Maximum acceptable VMAF score
$crfMin = 16       # CRF floor (won't go below this)
$crfMax = 20       # CRF ceiling (won't go above this)
$fileExtention = "mov"  # Chunk output format
```

## x264 Encoding Parameters

The encode uses high-quality slow settings:
- `partitions=i4x4+p8x8+b8x8`, `trellis 2`, `subq 10`, `me_method umh`, `me_range 24`
- `maxrate 12000K`, `bufsize 14000k` (first encode) / `24000k` (re-encodes)
- Fixed GOP: `-g 48 -keyint_min 48 -sc_threshold 0` (scene cuts handled by chunking, not x264)
- `-flags -loop` disables loop filter deblocking
