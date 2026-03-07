# Feature Landscape

**Domain:** Video encoding queue management web application
**Project:** VibeCoder Video Encoder (x264 + VMAF-targeted quality pipeline)
**Researched:** 2026-03-07
**Reference apps:** Tdarr, Unmanic, HandBrake, Jellyfin, Adobe Media Encoder, Bitmovin

---

## Table Stakes

Features users expect from any video encoding queue manager. Missing = product feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Job list with current status | Core affordance — users must see what is queued, running, done, failed | Low | Statuses: queued, running, done, failed, cancelled |
| Add job by file path | Standard for server-side tools; primary input for NAS/local-file workflows | Low | PROJECT.md requires this |
| Real-time progress display | Encoding takes minutes-to-hours; users abandon tools with no feedback | Medium | Requires WebSocket or SSE; show % and stage |
| Pause / resume queue | Long encode sessions need to be interruptible without losing work | Medium | Pause stops starting new jobs; running job may need graceful stop |
| Cancel individual job | Users add wrong files; must be able to abort without killing the whole queue | Low-Medium | Must clean up temp files on cancel |
| Retry failed job | Encoding fails for file-level reasons (corrupt source, codec mismatch); retry without re-entering settings | Low | Re-enqueue same job with same config |
| Per-job configuration | Different source files need different VMAF targets, audio codecs | Medium | PROJECT.md requires per-job: VMAF range, CRF bounds, audio codec |
| Global defaults / presets | Without defaults, every job requires full manual config — unusable | Low | Users set defaults once; per-job config overrides |
| Job history / completion list | Users need to verify output and diagnose failures after the fact | Low-Medium | Persist completed and failed jobs with final status |
| Encoding log per job | Diagnosing encoding failures requires seeing FFmpeg stderr output | Medium | Capture and store per-job log; display on demand |
| Output file size + compression ratio | Primary outcome metric: did the encode actually save space or hit quality target? | Low | Computed after completion; show input vs output bytes |
| Configurable directory paths | Input, output, temp paths must be configurable for cross-platform use | Low | PROJECT.md requires this |

---

## Differentiators

Features that distinguish this tool from generic queue managers. Not universally expected, but high value for the target workflow.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-chunk VMAF progress display | Unique to this pipeline; shows CRF adjustment in real time as each scene chunk encodes | High | Exposes VMAF score per chunk and CRF adjustments (±1 loop); no reference app does this at chunk granularity in a web UI |
| VMAF score history per job | After completion, show per-chunk VMAF scores and final CRF used; proves quality target was hit | Medium | Store per-chunk results in DB; render as a table or sparkline chart |
| Stage-by-stage progress | Pipeline has 8 distinct stages (FFV1 intermediate → scene detect → split → audio extract → chunk encode → merge → mux → cleanup); showing the current stage gives far better UX than a raw percentage | Medium | Each stage maps to a named subprocess; expose stage name + stage-level % |
| Watch folder input | Drop files in a folder; they auto-queue. Covers NAS and automation workflows | Medium | Requires background polling or inotify; PROJECT.md requires this |
| Browser file upload | Enables remote workflows where the server is headless | Medium | Requires multipart upload handling; temp storage on server; PROJECT.md requires this |
| Folder browse (server-side) | Browse the server's filesystem from the UI to pick a source file | Medium | Tree or flat directory listing via API; simpler than upload for local use |
| Estimated time remaining | Encoding duration is unpredictable; ETA reduces anxiety for long jobs | Medium | Calculated from current chunk encode rate vs remaining chunks |
| CRF convergence indicator | Show whether the VMAF feedback loop is converging (CRF is stable) or oscillating (encoding quality is hard to hit for this content) | Medium | Derived from per-chunk CRF change history; early warning of problem encodes |
| Disk space warnings | Temp files from the FFV1 intermediate + chunks can be 3–5x source size; running out of disk mid-encode is catastrophic | Low-Medium | Check available space before starting; warn if projected temp usage exceeds threshold |
| Dark mode | Standard quality-of-life expectation for power users running terminal-adjacent tools | Low | CSS prefers-color-scheme + theme toggle |

---

## Anti-Features

Features to deliberately NOT build in the initial phases. These create scope creep or complexity with little return given the project's single-user, quality-over-throughput focus.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Distributed / multi-node encoding | Tdarr's primary differentiator; immense infrastructure complexity for a single-machine personal tool | Run one worker on the host; design backend so a second worker node could be added later without a rewrite |
| Hardware accelerator (GPU/NVENC/VAAPI) selection | This pipeline is x264 (CPU only) by design; quality targets require software encoder; GPU options would require separate quality calibration | Keep as a future extension point in config, do not implement |
| Library scanning / media management | Tdarr/Unmanic solve this; adds database-heavy features (codec inventory, pie charts, health checks) orthogonal to the queue goal | Accept individual files only; no library-wide scanning |
| Subtitle handling / container manipulation | Out of scope; the pipeline is video + configurable audio only | Audio codec is already configurable; subtitles are pass-through or dropped at mux stage |
| Multi-profile output (one source → many renditions) | Cloud encoding platforms (AWS MediaConvert, Bitmovin) solve this; the use case here is single-output archive quality | One job = one output file |
| Plugin system | Tdarr/Unmanic complexity tradeoff; plugins require a stable API contract and test surface that slows initial development | Hard-code the pipeline; add CLI hooks for post-processing scripts only if demand emerges |
| User authentication / multi-user | Single-user personal tool; auth adds session management, password reset, RBAC surface | Bind to localhost or trust network; add optional basic auth header as a lightweight gate if needed |
| Cloud storage integration (S3, Dropbox) | Network-based sources complicate the temp-file model; the tool operates on locally mounted paths | Support UNC/network paths; leave cloud sync to the filesystem layer |
| Mobile-first responsive UI | The dashboard shows dense technical data (VMAF scores, chunk tables, log output); mobile is a poor fit | Ensure the layout is readable on a tablet; do not optimize for phone-screen widths |

---

## Feature Dependencies

```
Global defaults
  └── Per-job configuration (overrides defaults; defaults must exist first)
        └── Job queue (jobs carry their config snapshot at submission time)

File input methods (path entry, folder browse, watch folder, browser upload)
  └── Job queue (all inputs create queue entries)

Job queue
  └── Real-time progress display (requires running jobs to report state)
  └── Job history (completed/failed jobs land here)
  └── Encoding log per job (generated during job execution)

Per-chunk VMAF progress
  └── Stage-by-stage progress (VMAF loop is a sub-stage of chunk encoding)
  └── VMAF score history per job (per-chunk data accumulated during job)

Watch folder
  └── Configurable directory paths (watch folder path must be configurable)

Browser file upload
  └── Configurable directory paths (uploaded files need a landing directory)

Disk space warnings
  └── Configurable directory paths (must know temp dir to check free space)

Estimated time remaining
  └── Real-time progress display (ETA is part of the progress model)

CRF convergence indicator
  └── Per-chunk VMAF progress (derived from CRF adjustment history per chunk)
```

---

## MVP Recommendation

Prioritize these for first working release:

1. **Global defaults** — VMAF range, CRF bounds, audio codec; stored in config file; editable via UI settings page
2. **Add job by file path** — typed path entry, validated server-side; creates queue entry with defaults applied
3. **Job queue list** — shows queued, running, done, failed status; pause/resume queue; cancel individual job; retry failed
4. **Stage-by-stage progress** — named pipeline stage + stage-level percentage; updated via WebSocket/SSE
5. **Per-chunk VMAF progress** — chunk index, current VMAF score, current CRF; live-updated during chunk encode loop
6. **Encoding log per job** — capture FFmpeg stderr; display in expandable panel; persist on disk

Defer (Phase 2+):

- **Watch folder** — useful but not needed for initial validation; adds background polling complexity
- **Browser file upload** — lower priority than path entry for a local/NAS tool; add after core pipeline is stable
- **Server-side folder browse** — convenience feature; path entry covers the core need
- **VMAF score history visualization** — build the data model in MVP; chart/table rendering is Phase 2
- **Disk space warnings** — important but not blocking; add after core pipeline works
- **Estimated time remaining** — requires baseline data from completed jobs to estimate accurately
- **Dark mode** — cosmetic; implement when UI is otherwise complete

---

## Sources

- Tdarr documentation and GitHub: https://docs.tdarr.io/docs/welcome/what and https://github.com/HaveAGitGat/Tdarr (MEDIUM confidence — official docs, but Tdarr features evolve rapidly)
- Unmanic GitHub and documentation: https://github.com/Unmanic/unmanic and https://docs.unmanic.app/docs/configuration/plugins/overview/ (MEDIUM confidence — official source)
- HandBrake queue documentation: https://handbrake.fr/docs/en/1.3.0/advanced/queue.html and https://deepwiki.com/HandBrake/HandBrake/3.1.2-main-window-and-queue-management (HIGH confidence — official docs)
- Bitmovin blog on encoding queue priorities: https://bitmovin.com/blog/control-video-encoding-queue-priorities/ (MEDIUM confidence — vendor blog, but technically accurate)
- FFmpeg progress reporting via `-progress` flag: https://ffmpeg.org/ffmpeg.html (HIGH confidence — official FFmpeg docs)
- Tdarr Apprise notification plugin: https://docs.tdarr.io/docs/plugins/flow-plugins/index/tools/Apprise (MEDIUM confidence — official Tdarr docs)
- ffdash terminal encoding dashboard with VMAF display: https://github.com/bcherb2/ffdash (LOW confidence — single independent project, useful as pattern reference)
- Adobe Media Encoder log files: https://helpx.adobe.com/media-encoder/using/log-files.html (HIGH confidence — official Adobe docs)
- Unmanic vs Tdarr comparison: https://www.oreateai.com/blog/unmanic-vs-tdarr-navigating-your-media-librarys-optimization-landscape/83f4bd9e5b00f265387a8e383b8ebfb0 (LOW confidence — third-party blog, limited detail)
