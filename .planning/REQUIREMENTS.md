# Requirements: VibeCoder Video Encoder

**Defined:** 2026-03-07
**Core Value:** Every source video can be encoded to a precise VMAF quality target with zero manual intervention — queue it, watch it, get the result.

## v1 Requirements

### Pipeline

- [ ] **PIPE-01**: System encodes source MKV to FFV1 lossless intermediate via ffmpeg
- [ ] **PIPE-02**: System detects scene boundaries using PySceneDetect (pin >=0.6.7,<0.7)
- [ ] **PIPE-03**: System splits FFV1 intermediate into scene-boundary chunks via ffmpeg
- [ ] **PIPE-04**: System extracts and transcodes audio to user-selected codec (EAC3, AAC, FLAC, or copy) via ffmpeg
- [ ] **PIPE-05**: System encodes each chunk with libx264 using configurable encoding parameters
- [ ] **PIPE-06**: System scores each encoded chunk against FFV1 source using VMAF (libvmaf) with models from the bundled assets/ directory
- [ ] **PIPE-07**: System adjusts CRF ±1 and re-encodes chunk if VMAF score is outside configured [vmafMin, vmafMax] range, within configured [crfMin, crfMax] bounds
- [ ] **PIPE-08**: System concatenates all encoded chunks and muxes with audio into final MKV
- [ ] **PIPE-09**: System cleans up temp files (FFV1 intermediate, chunks, encoded chunks) after job completes or is cancelled
- [x] **PIPE-10**: System runs cross-platform (Windows and Linux) with no OS-specific dependencies

### Job Queue

- [ ] **QUEUE-01**: User can add a job by entering a source file path in the web UI
- [ ] **QUEUE-02**: User can pause an active or queued job (waits for current pipeline step to finish)
- [ ] **QUEUE-03**: User can cancel an active or queued job (graceful ffmpeg termination, temp file cleanup)
- [ ] **QUEUE-04**: User can retry a failed job
- [ ] **QUEUE-05**: Job state persists across application restarts (SQLite)
- [ ] **QUEUE-06**: System monitors a configurable watch folder and auto-adds new MKV files to the queue

### Progress & Monitoring

- [ ] **PROG-01**: User sees named pipeline stage for each active job (FFV1 encode, scene detect, chunk split, audio transcode, chunk encode N/total, merge, mux, cleanup)
- [ ] **PROG-02**: User sees per-chunk VMAF score and final CRF value as each chunk completes
- [ ] **PROG-03**: User can view full ffmpeg stderr log per job
- [ ] **PROG-04**: User sees estimated time remaining per active job (based on chunk throughput)
- [ ] **PROG-05**: System warns user before starting a job if estimated disk space (3–5× source size) is insufficient

### Configuration

- [ ] **CONF-01**: User can set VMAF target range (vmafMin / vmafMax) per job (default: 96.2–97.6)
- [ ] **CONF-02**: User can set CRF bounds (crfMin / crfMax) per job (default: 16–20, starting CRF: 17)
- [ ] **CONF-03**: User can select audio codec per job (EAC3, AAC, FLAC, copy)
- [ ] **CONF-04**: User can select video encoding preset per job with the 1080p H.264 default exposing current script parameters (partitions=i4x4+p8x8+b8x8, trellis 2, deblock -3:-3, b_qfactor 1, i_qfactor 0.71, qcomp 0.50, maxrate 12000K, bufsize 24000k, qmax 40, subq 10, me_method umh, me_range 24, b_strategy 2, bf 2, sc_threshold 0, g 48, keyint_min 48, -flags -loop)
- [ ] **CONF-05**: User can configure global defaults (VMAF range, CRF bounds, audio codec, output path, temp path) in a settings panel
- [ ] **CONF-06**: User can configure watch folder path in settings

### Documentation

- [ ] **DOC-01**: README.md is built incrementally across all phases — each phase contributes its relevant section (installation prerequisites in Phase 1, pipeline config params in Phase 3, API/watch folder in Phase 4, full usage guide in Phase 5) so documentation stays current with the code

## v2 Requirements

### File Input

- **INPUT-01**: User can upload source files via browser
- **INPUT-02**: User can browse server-side directory tree to select files

### Pipeline

- **PIPE-V2-01**: Multiple chunks can encode in parallel (configurable concurrency limit)
- **PIPE-V2-02**: Job resumes from last completed step after application crash/restart

### UI

- **UI-V2-01**: VMAF score history chart per job (line chart showing per-chunk scores)
- **UI-V2-02**: CRF convergence indicator per chunk (shows how many re-encodes were needed)
- **UI-V2-03**: Dark mode
- **UI-V2-04**: Optional basic-auth gate for remote access

## Out of Scope

| Feature | Reason |
|---------|--------|
| Distributed multi-node encoding | Single-user local tool; Tdarr-style complexity not warranted |
| Library scanning / media management | Out of scope — this is an encoder, not a media manager |
| Plugin system | Premature abstraction |
| GPU encoding (NVENC, QSV, etc.) | Pipeline is specifically x264; GPU paths change quality model |
| Multi-user authentication | Single-user local tool |
| Browser upload (v1) | Path entry + watch folder sufficient for v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 3: Pipeline Runner | Pending |
| PIPE-02 | Phase 3: Pipeline Runner | Pending |
| PIPE-03 | Phase 3: Pipeline Runner | Pending |
| PIPE-04 | Phase 3: Pipeline Runner | Pending |
| PIPE-05 | Phase 3: Pipeline Runner | Pending |
| PIPE-06 | Phase 3: Pipeline Runner | Pending |
| PIPE-07 | Phase 3: Pipeline Runner | Pending |
| PIPE-08 | Phase 3: Pipeline Runner | Pending |
| PIPE-09 | Phase 3: Pipeline Runner | Pending |
| PIPE-10 | Phase 1: Subprocess Foundation | Complete |
| QUEUE-01 | Phase 5: React UI | Pending |
| QUEUE-02 | Phase 5: React UI | Pending |
| QUEUE-03 | Phase 5: React UI | Pending |
| QUEUE-04 | Phase 5: React UI | Pending |
| QUEUE-05 | Phase 2: SQLite State Layer | Pending |
| QUEUE-06 | Phase 4: Web API + Scheduler | Pending |
| PROG-01 | Phase 5: React UI | Pending |
| PROG-02 | Phase 5: React UI | Pending |
| PROG-03 | Phase 5: React UI | Pending |
| PROG-04 | Phase 5: React UI | Pending |
| PROG-05 | Phase 4: Web API + Scheduler | Pending |
| CONF-01 | Phase 3: Pipeline Runner | Pending |
| CONF-02 | Phase 3: Pipeline Runner | Pending |
| CONF-03 | Phase 3: Pipeline Runner | Pending |
| CONF-04 | Phase 3: Pipeline Runner | Pending |
| CONF-05 | Phase 4: Web API + Scheduler | Pending |
| CONF-06 | Phase 4: Web API + Scheduler | Pending |
| DOC-01 | Phase 5: React UI | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 after roadmap creation — traceability complete*
