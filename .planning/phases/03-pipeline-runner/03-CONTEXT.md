# Phase 3: Pipeline Runner - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete 10-step encoding pipeline runnable from the command line. A real source MKV file goes in, a final output MKV comes out. Delivers: `src/encoder/pipeline.py` as a `python -m encoder.pipeline` CLI. No web server, no scheduler — encoding logic is independently testable before Phase 4 adds HTTP on top.

Steps: FFV1 intermediate → scene detection → chunk splitting → audio transcode → per-chunk x264 encode → VMAF CRF feedback loop → concat → mux → cleanup.

</domain>

<decisions>
## Implementation Decisions

### CLI invocation
- `python -m encoder.pipeline source.mkv` — module-style, no install step required
- Consistent with the test runner pattern established in Phases 1 and 2
- Required positional arg: source file path

### CLI flags
- `--config path/to/config.json` — per-job config override (optional; defaults apply if omitted)
- `--output-dir ./output` — output MKV destination (default: `./output/` relative to cwd)
- `--temp-dir ./temp` — temp/intermediate/chunk working directory (default: `./temp/` relative to cwd)
- `--scene-threshold 27` — ContentDetector threshold (default: 27)
- No `--dump-defaults` flag — web UI and README handle config discovery

### Terminal output style
- Per-step status lines: print when each pipeline step starts and when it completes with duration
  - Example: `[FFV1] Encoding intermediate... done (42s)`
- One line per chunk showing final CRF and VMAF result:
  - Example: `[Chunk 3/12] CRF 17 -> VMAF 96.8 (pass)`
- No live frame/fps progress bar overwriting — clean readable lines only
- All detail (every VMAF iteration, ffmpeg stderr) goes to the DB log blob only

### Log storage
- DB only — jobs.log blob in SQLite, appended per chunk as encoding progresses
- No separate encodinglog.txt written to disk
- Phase 5 reads and renders the log blob in the web UI log panel

### Config / encoding preset
- Config JSON schema matches the Phase 2 DB `config` blob exactly:
  `vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, x264_params`
- When `--config` is omitted, all original script defaults apply:
  - vmaf_min=96.2, vmaf_max=97.6, crf_start=17, crf_min=16, crf_max=20
  - audio_codec=eac3
  - x264_params: partitions=i4x4+p8x8+b8x8, trellis=2, deblock=-3:-3, subq=10,
    me_method=umh, me_range=24, b_strategy=2, bf=2, sc_threshold=0, g=48,
    keyint_min=48, maxrate=12000K, bufsize=24000k, qmax=40, qcomp=0.50,
    b_qfactor=1, i_qfactor=0.71, flags=-loop
- x264_params lives as a nested object in the config JSON
- Phase 5's settings panel generates/manages this JSON; CLI is just a consumer

### Scene detection
- Algorithm: ContentDetector (HSV content-based, the standard choice)
- No minimum scene length — split at every detected boundary (matches original PowerShell script)
- If PySceneDetect finds zero scene boundaries: raise an error and stop the pipeline immediately
  - Clear error message: "No scenes detected in <source>. Check source file or lower --scene-threshold."
- Threshold configurable via `--scene-threshold` (default 27)

### Cancel / interrupt behavior
- Ctrl+C: cancel the active ffmpeg process via `.cancel()`, then delete all temp dirs
  (CHUNKS, ENCODED, TEMP subdirs under `--temp-dir`). Output dir untouched if mux never started.
- Job status in DB set to CANCELLED (distinct from FAILED — Phase 4 treats these differently)
- Pipeline function accepts a `cancel_event: threading.Event` parameter
  - Phase 3 polls it between pipeline steps and after each chunk's VMAF loop
  - Phase 4 sets this event from the web API to trigger graceful cancellation
  - Ctrl+C sets the same event (signal handler sets it; pipeline polls and cleans up)
- No interactive prompts on cancel — must work cleanly in CI/scripts

### Claude's Discretion
- Exact VMAF filter graph structure (how the libvmaf filter compares FFV1 source vs encoded chunk)
- VMAF model file selection (vmaf_v0.6.1.json vs vmaf_4k_v0.6.1.json) — pick appropriate model
- PySceneDetect API call pattern for >=0.6.7,<0.7 (synchronous, run via run_in_executor)
- Heartbeat update frequency during encoding (how often update_heartbeat is called)
- Exact error exception types for pipeline failures
- How x264_params nested object maps to ffmpeg -x264-params string

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/encoder/ffmpeg.py`: `run_ffmpeg(cmd) -> FfmpegProcess` — all ffmpeg invocations use this
  - `.cancel()` for graceful ffmpeg stop (already handles CREATE_NEW_PROCESS_GROUP on Windows)
  - `.stderr_lines` — captured stderr for building per-chunk log entries
- `src/encoder/ffmpeg.py`: `escape_vmaf_path(path)` — already handles Windows drive-letter colon escaping for VMAF filter strings
- `src/encoder/db.py`: full DB API already implemented:
  - `create_job`, `update_job_status`, `update_heartbeat`, `append_job_log`
  - `create_chunk`, `update_chunk`, `get_chunks`
  - `create_step`, `update_step`, `get_steps`
  - `recover_stale_jobs` — call at CLI startup to reset stale RUNNING jobs
- `src/encoder/__init__.py`: existing package — `pipeline.py` slots in as `src/encoder/pipeline.py`

### Established Patterns
- Windows subprocess: sync Popen via `run_ffmpeg()` — all ffmpeg calls must go through this
- No asyncio subprocesses — ThreadPoolExecutor for any blocking calls (including PySceneDetect)
- No mocking in tests — integration tests with real ffmpeg (lavfi sources for unit-testable steps)
- Public API pattern: `from encoder.pipeline import run_pipeline`
- Tests at root: `tests/test_pipeline.py`
- DB calls are async (aiosqlite) — pipeline runner uses `asyncio.run()` at CLI entry point

### Integration Points
- Phase 4 (Web API) will import `run_pipeline` and wrap it with asyncio task management
- Phase 4 passes its own `cancel_event` when submitting a job to the pipeline
- Phase 4 reads `jobs`, `chunks`, `steps` tables for SSE progress streaming
- Phase 5 reads `jobs.log` blob for the log panel and `chunks.vmaf_score` / `chunks.crf_used` for per-chunk display

</code_context>

<specifics>
## Specific Ideas

- Terminal output should feel like a clean build tool (not noisy ffmpeg stderr)
- The cancel_event pattern deliberately mirrors threading.Event so Phase 4 can use asyncio.Event via a wrapper or just pass a threading.Event
- "No scenes detected" is a hard error — not a silent fallback. Source files should always have detectable scene cuts.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-pipeline-runner*
*Context gathered: 2026-03-07*
