# Phase 1: Subprocess Foundation - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Cross-platform ffmpeg and ffprobe subprocess execution — proven correct on Windows and Linux. Delivers: a subprocess wrapper module with progress streaming, graceful cancellation, VMAF path escaping, and typed error handling. No pipeline logic, no DB, no web server. Everything subsequent phases build on.

</domain>

<decisions>
## Implementation Decisions

### Progress interface
- Sync generator — wrapper yields progress dicts, caller iterates with `for event in run_ffmpeg(...)`
- Each event is a parsed dict: `{frame, fps, time_seconds, bitrate, speed, raw_line}`
- After iteration completes, caller can also access captured full stderr (for VMAF score parsing in Phase 3, error detail, logging)
- Progress events are only `frame=` lines; other stderr lines are captured silently and returned at end

### Package structure
- `src/encoder/` package with standard src-layout
- Phase 1 module: `src/encoder/ffmpeg.py` (named after what it wraps, not the mechanism)
- Public API example: `from encoder.ffmpeg import run_ffmpeg, escape_vmaf_path`
- Tests at root: `tests/test_ffmpeg.py`
- Future modules slot in: `src/encoder/db.py`, `src/encoder/pipeline.py`, `src/encoder/api.py`

### Test strategy
- Integration tests with real ffmpeg (no mocking)
- Test input: ffmpeg lavfi synthetic sources (`-f lavfi -i testsrc`) — no binary assets in repo
- Short duration (3 seconds) to keep tests fast
- Cancellation test: start a 60-second lavfi encode, cancel after 1 second, assert process exits cleanly and Python continues
- Tests verify cross-platform behavior — must pass on both Windows and Linux

### Claude's Discretion
- Exact error exception class name and fields
- pyproject.toml / requirements.txt structure and pinned versions
- ThreadPoolExecutor pool size and lifecycle
- Exact progress regex pattern
- How stderr buffering is handled to avoid deadlock (never use communicate())

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `video-encode-web-1080p.ps1`: Reference implementation of the full pipeline — x264 params, VMAF filter graph, CRF feedback loop logic. Read this when implementing Phase 3, not Phase 1.
- `assets/`: VMAF model files already present — will be referenced by the path escaping utility in Phase 1.

### Established Patterns
- No Python patterns exist yet — this phase establishes them.
- Windows subprocess constraint: ThreadPoolExecutor + sync Popen (asyncio SelectorEventLoop cannot spawn subprocesses on Windows). This is non-negotiable.
- Cancellation sequence: write `q\n` to ffmpeg stdin → wait briefly → terminate() fallback. Must use `CREATE_NEW_PROCESS_GROUP` on Windows to avoid killing parent.
- VMAF path escaping: Windows drive-letter paths need triple-escaped colons in ffmpeg filter strings: `C\\:/path/vmaf.json`.

### Integration Points
- Phase 1 establishes the import path (`from encoder.ffmpeg import ...`) that Phases 2–5 will use
- No existing routes, DB, or app to integrate with yet

</code_context>

<specifics>
## Specific Ideas

- No specific UI or interaction references for this phase (it's infrastructure)
- The PowerShell script's ffmpeg invocations are the canonical reference for correct parameter syntax

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-subprocess-foundation*
*Context gathered: 2026-03-07*
