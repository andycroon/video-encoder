# Phase 5: React UI - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Browser interface surfacing all queue management, progress monitoring, and configuration. No new pipeline capabilities — every action calls the FastAPI endpoints already built in Phase 4. New backend work is limited to a `/profiles` CRUD endpoint (new DB table) to support encoder profiles.

</domain>

<decisions>
## Implementation Decisions

### Layout structure
- Single-page app, no routing, no navigation tabs
- Top bar: persistent path text field + Add button (always visible)
- Below path field: profile picker dropdown + [Edit] button (opens profile editor modal)
- Job queue occupies the main content area
- No separate settings page or collapsible settings section — settings live in profiles

### Encoder profiles
- Profiles replace the global settings concept in the UI — users pick a named profile per job
- Profile fields: name, vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, x264_params (the full parameter block)
- "Default" profile seeded with the exact original script parameters:
  - VMAF: 96.2–97.6, CRF: 16–20, start 17, audio: EAC3
  - x264 params: `partitions=i4x4+p8x8+b8x8`, `trellis 2`, `deblock -3:-3`, `b_qfactor 1`, `i_qfactor 0.71`, `qcomp 0.50`, `maxrate 12000K`, `bufsize 24000k`, `qmax 40`, `subq 10`, `me_method umh`, `me_range 24`, `b_strategy 2`, `bf 2`, `sc_threshold 0`, `g 48`, `keyint_min 48`, `-flags -loop`
- Profiles stored in SQLite via new `/profiles` endpoints (new table, not localStorage)
- Profile editor modal: opened via [Edit] button next to picker — create, edit, delete profiles from there
- When adding a job: profile snapshot is passed as `config` override on `POST /jobs` (existing API field)

### Job list presentation
- Expandable rows — each job is a compact collapsed row that expands on click
- **Collapsed row shows:** filename, status badge, current pipeline stage, ETA, action buttons (Pause/Cancel or Retry)
- **Completed jobs collapsed row shows:** filename, DONE badge, avg VMAF, avg CRF, total duration, [Retry] button
- Action buttons on collapsed row: RUNNING → [Pause][Cancel], QUEUED → [Cancel], FAILED/CANCELLED → [Retry], DONE → [Retry]

### Expanded job card layout
- Two-column layout inside expanded card:
  - **Left column:** pipeline stage list with checkmarks (FFV1 encode, Scene detect, Chunk split, Audio transcode, Chunk encode N/total, Merge, Mux, Cleanup) — completed stages show ✔ + duration, active stage shows ▶, pending stages dimmed
  - **Right column:** chunk data table (only meaningful during/after chunk encode stage)
- Below the two columns: collapsible ffmpeg log section

### Live chunk data table
- Table columns: Chunk #, CRF, VMAF, Passes
- Rows populate live as `chunk_complete` SSE events arrive
- Currently-encoding chunk row shows "--" for VMAF with a subtle running indicator
- Table fills in from top; no pagination needed (chunks are numbered, finite)

### ETA calculation
- ETA = chunks remaining × average time per completed chunk
- Updates after each `chunk_complete` event
- Shown in collapsed row next to stage name: "Chunk encode 4/12   ETA 8m 30s"
- ETA only shown during chunk encode stage (other stages are fast and variable)

### ffmpeg log panel
- Toggle: "Show ffmpeg log ▾" / "Hide ffmpeg log ▴" at the bottom of the expanded card
- Full captured stderr output in a fixed-height (≈300px) scrollable monospace box
- Auto-scrolls to bottom as new lines arrive; pauses auto-scroll if user scrolls up; resumes when user scrolls back to bottom
- No truncation — full log retained

### Claude's Discretion
- Visual design, color palette, typography — must be polished and non-generic (use frontend-design skill)
- Exact status badge colors and styling
- Pipeline stage list icon/animation for active stage
- Transition animations for row expand/collapse
- How to handle very long file paths in the collapsed row (truncation strategy)

</decisions>

<specifics>
## Specific Ideas

- HandBrake-style encoder profiles — named presets user can build themselves; "Default" is the current script's parameters
- Completed job collapsed row should show avg VMAF **and** avg CRF (mirroring what the original PowerShell script reported)
- Pipeline stage list + chunk table side-by-side (not stacked) inside expanded card

</specifics>

<code_context>
## Existing Code Insights

### API Endpoints (Phase 4)
- `POST /jobs` — `{ source_path, config: {} }` — config accepts vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec
- `GET /jobs` / `GET /jobs/{id}` — job object with status, source_path, config, created_at
- `PATCH /jobs/{id}/pause`, `DELETE /jobs/{id}`, `POST /jobs/{id}/retry`
- `GET /jobs/{id}/stream` — SSE with named events: `stage`, `chunk_progress`, `chunk_complete`, `job_complete`, `error`, `warning`
- `GET /settings`, `PUT /settings` — global defaults (vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, output_path, temp_path, watch_folder_path)

### SSE Event Payloads (Phase 4)
- `stage` — `{ name, started_at }`
- `chunk_complete` — `{ chunk_index, crf_used, vmaf_score }`
- `chunk_progress` — `{ chunk_index, crf, pass }`
- `job_complete` — `{ status, duration }`
- `error` — `{ message, step }`

### New Backend Work Required
- `/profiles` CRUD endpoints (new table in SQLite alongside jobs/settings)
- Profile schema: `id`, `name`, `config` (JSON blob with encoding params), `is_default` flag
- Seed "Default" profile from current settings on first run

### Established Patterns
- CORS already open (`allow_origins=["*"]`) — React dev server can call API without proxy config
- All DB access via aiosqlite — new profiles table follows same pattern as settings table
- Stack: React 19 + TypeScript + Vite (from MEMORY.md)

### Integration Points
- React opens one SSE connection per visible/active job via `GET /jobs/{id}/stream`
- Profile picker sends selected profile's config fields as the `config` dict on `POST /jobs`
- Settings endpoint (`GET /settings`) still used to seed the Default profile on first load

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-react-ui*
*Context gathered: 2026-03-08*
