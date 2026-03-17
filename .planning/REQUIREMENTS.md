# Requirements: VibeCoder Video Encoder

**Defined:** 2026-03-07
**Core Value:** Every source video can be encoded to a precise VMAF quality target with zero manual intervention — queue it, watch it, get the result.

## v1 Requirements

### Pipeline

- [x] **PIPE-01**: System encodes source MKV to FFV1 lossless intermediate via ffmpeg
- [x] **PIPE-02**: System detects scene boundaries using PySceneDetect (pin >=0.6.7,<0.7)
- [x] **PIPE-03**: System splits FFV1 intermediate into scene-boundary chunks via ffmpeg
- [x] **PIPE-04**: System extracts and transcodes audio to user-selected codec (EAC3, AAC, FLAC, or copy) via ffmpeg
- [x] **PIPE-05**: System encodes each chunk with libx264 using configurable encoding parameters
- [x] **PIPE-06**: System scores each encoded chunk against FFV1 source using VMAF (libvmaf) with models from the bundled assets/ directory
- [x] **PIPE-07**: System adjusts CRF ±1 and re-encodes chunk if VMAF score is outside configured [vmafMin, vmafMax] range, within configured [crfMin, crfMax] bounds
- [x] **PIPE-08**: System concatenates all encoded chunks and muxes with audio into final MKV
- [x] **PIPE-09**: System cleans up temp files (FFV1 intermediate, chunks, encoded chunks) after job completes or is cancelled
- [x] **PIPE-10**: System runs cross-platform (Windows and Linux) with no OS-specific dependencies

### Job Queue

- [x] **QUEUE-01**: User can add a job by entering a source file path in the web UI
- [x] **QUEUE-02**: User can pause an active or queued job (waits for current pipeline step to finish)
- [x] **QUEUE-03**: User can cancel an active or queued job (graceful ffmpeg termination, temp file cleanup)
- [x] **QUEUE-04**: User can retry a failed job
- [x] **QUEUE-05**: Job state persists across application restarts (SQLite)
- [x] **QUEUE-06**: System monitors a configurable watch folder and auto-adds new MKV files to the queue

### Progress & Monitoring

- [x] **PROG-01**: User sees named pipeline stage for each active job (FFV1 encode, scene detect, chunk split, audio transcode, chunk encode N/total, merge, mux, cleanup)
- [x] **PROG-02**: User sees per-chunk VMAF score and final CRF value as each chunk completes
- [x] **PROG-03**: User can view full ffmpeg stderr log per job
- [x] **PROG-04**: User sees estimated time remaining per active job (based on chunk throughput)
- [x] **PROG-05**: System warns user before starting a job if estimated disk space (3–5× source size) is insufficient

### Configuration

- [x] **CONF-01**: User can set VMAF target range (vmafMin / vmafMax) per job (default: 96.2–97.6)
- [x] **CONF-02**: User can set CRF bounds (crfMin / crfMax) per job (default: 16–20, starting CRF: 17)
- [x] **CONF-03**: User can select audio codec per job (EAC3, AAC, FLAC, copy)
- [x] **CONF-04**: User can select video encoding preset per job with the 1080p H.264 default exposing current script parameters (partitions=i4x4+p8x8+b8x8, trellis 2, deblock -3:-3, b_qfactor 1, i_qfactor 0.71, qcomp 0.50, maxrate 12000K, bufsize 24000k, qmax 40, subq 10, me_method umh, me_range 24, b_strategy 2, bf 2, sc_threshold 0, g 48, keyint_min 48, -flags -loop)
- [x] **CONF-05**: User can configure global defaults (VMAF range, CRF bounds, audio codec, output path, temp path) in a settings panel
- [x] **CONF-06**: User can configure watch folder path in settings

### Documentation

- [x] **DOC-01**: README.md is built incrementally across all phases — each phase contributes its relevant section (installation prerequisites in Phase 1, pipeline config params in Phase 3, API/watch folder in Phase 4, full usage guide in Phase 5) so documentation stays current with the code

## v1.1 Requirements

### Pipeline

- [ ] **PIPE-V2-01**: Multiple chunks can encode in parallel (configurable concurrency limit)
- [x] **PIPE-V2-02**: Job resumes from last completed step after application crash/restart
- [x] **PIPE-V2-03**: CRF oscillation resolution picks the encode whose VMAF was closest to the center of the target window (e.g. 96.9 for a 96.2–97.6 range), rather than the last encode the loop happened to land on. If both candidates are equidistant, prefer the lower CRF (slightly over-quality is safer than slightly under).

### Job Management

- [ ] **JMGMT-01**: User can delete individual completed or failed jobs
- [ ] **JMGMT-02**: User can bulk-clear all completed jobs or all failed jobs in one action
- [ ] **JMGMT-03**: Completed jobs appear in a separate history view; active queue shows only queued and running jobs
- [ ] **JMGMT-04**: System auto-removes completed jobs after a configurable time period (default: 7 days)

### UI

- [ ] **UI-V2-01**: User sees VMAF score history chart per job (line chart showing per-chunk scores)
- [ ] **UI-V2-02**: User sees CRF convergence count per chunk (how many re-encodes were needed)
- [ ] **UI-V2-03**: User can toggle dark mode; preference persists across sessions

## v2 Requirements

### File Input

- **INPUT-01**: User can upload source files via browser (deferred — chunked upload for multi-GB files is significant lift; validate remote-access need first)

### Pipeline

- **PIPE-V2-04**: System supports 4K HDR H.265 (HEVC) encoding — libx265, HDR10 metadata passthrough (master-display, max-cll), BT.2020 colorspace, 10-bit pixel format.
  - **Research required before planning:** Validate whether VMAF can be calculated directly on HDR content (10-bit BT.2020) or whether the reference and encoded frames must first be tone-mapped to SDR for a valid comparison. Also evaluate whether `vmaf_v0.6.1` is appropriate for 4K HDR or if the `vmaf_4k` model (or a HDR-specific model) should be used instead.
- **PIPE-V2-05**: System supports cross-resolution encoding from a 4K HDR source to a 1080p SDR output — includes downscale (e.g. Lanczos), HDR-to-SDR tone mapping (e.g. Hable or reinhard via zscale/tonemap filters), and BT.709 colorspace conversion.

### UI

- **UI-V2-04**: Optional basic-auth gate for remote access

## Out of Scope

| Feature | Reason |
|---------|--------|
| Distributed multi-node encoding | Single-user local tool; Tdarr-style complexity not warranted |
| Library scanning / media management | Out of scope — this is an encoder, not a media manager |
| Plugin system | Premature abstraction |
| GPU encoding (NVENC, QSV, etc.) | Pipeline is specifically x264; GPU paths change quality model |
| Multi-user authentication | Single-user local tool |
| Browser upload (v1.1) | Multi-GB chunked upload protocol; deferred to v2 pending remote-access validation |
| Server-side directory browser (v1.1) | Already implemented in v1.0 (/api/browse exists) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 3: Pipeline Runner | Complete |
| PIPE-02 | Phase 3: Pipeline Runner | Complete |
| PIPE-03 | Phase 3: Pipeline Runner | Complete |
| PIPE-04 | Phase 3: Pipeline Runner | Complete |
| PIPE-05 | Phase 3: Pipeline Runner | Complete |
| PIPE-06 | Phase 3: Pipeline Runner | Complete |
| PIPE-07 | Phase 3: Pipeline Runner | Complete |
| PIPE-08 | Phase 3: Pipeline Runner | Complete |
| PIPE-09 | Phase 3: Pipeline Runner | Complete |
| PIPE-10 | Phase 1: Subprocess Foundation | Complete |
| QUEUE-01 | Phase 5: React UI | Complete |
| QUEUE-02 | Phase 5: React UI | Complete |
| QUEUE-03 | Phase 5: React UI | Complete |
| QUEUE-04 | Phase 5: React UI | Complete |
| QUEUE-05 | Phase 2: SQLite State Layer | Complete |
| QUEUE-06 | Phase 4: Web API + Scheduler | Complete |
| PROG-01 | Phase 5: React UI | Complete |
| PROG-02 | Phase 5: React UI | Complete |
| PROG-03 | Phase 5: React UI | Complete |
| PROG-04 | Phase 5: React UI | Complete |
| PROG-05 | Phase 4: Web API + Scheduler | Complete |
| CONF-01 | Phase 3: Pipeline Runner | Complete |
| CONF-02 | Phase 3: Pipeline Runner | Complete |
| CONF-03 | Phase 3: Pipeline Runner | Complete |
| CONF-04 | Phase 3: Pipeline Runner | Complete |
| CONF-05 | Phase 4: Web API + Scheduler | Complete |
| CONF-06 | Phase 4: Web API + Scheduler | Complete |
| DOC-01 | Phase 5: React UI | Complete |
| PIPE-V2-01 | Phase 6: Pipeline Reliability | Pending |
| PIPE-V2-02 | Phase 6: Pipeline Reliability | Complete |
| PIPE-V2-03 | Phase 6: Pipeline Reliability | Complete |
| JMGMT-01 | Phase 7: Job Management | Pending |
| JMGMT-02 | Phase 7: Job Management | Pending |
| JMGMT-03 | Phase 7: Job Management | Pending |
| JMGMT-04 | Phase 7: Job Management | Pending |
| UI-V2-01 | Phase 8: UI Enhancements | Pending |
| UI-V2-02 | Phase 8: UI Enhancements | Pending |
| UI-V2-03 | Phase 8: UI Enhancements | Pending |

**Coverage:**
- v1 requirements: 28 total — all Complete
- v1.1 requirements: 10 total
- Mapped to phases: 10 (Phases 6-8)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-17 after v1.1 roadmap creation*
