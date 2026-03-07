# Domain Pitfalls

**Domain:** Cross-platform Python video encoding web application (ffmpeg, VMAF, PySceneDetect, WebSocket/SSE)
**Researched:** 2026-03-07
**Overall Confidence:** HIGH (verified against official docs, GitHub issues, and multiple sources)

---

## Critical Pitfalls

These mistakes cause rewrites, data loss, or unrecoverable state.

---

### Pitfall C1: The Subprocess Pipe Deadlock

**What goes wrong:** The Python process hangs indefinitely when an ffmpeg subprocess generates enough stderr/stdout output to fill the OS pipe buffer. Nobody reads the pipe, ffmpeg blocks writing, and the parent blocks waiting for ffmpeg.

**Why it happens:** Any `Popen` call using `stdout=PIPE` or `stderr=PIPE` without actively draining those pipes will deadlock once the pipe buffer (typically 64KB on Linux, 4KB on Windows) fills. ffmpeg is especially prone because it writes verbose progress data continuously to stderr.

**Consequences:** The encode worker thread hangs permanently. No error is raised. The job appears to be running but makes no progress. On long encodes (FFV1 intermediates can be gigabytes), this happens reliably.

**Prevention:**
- Always drain both stdout AND stderr concurrently — use a dedicated reader thread per pipe, or use `asyncio.create_subprocess_exec` with async stream readers.
- The canonical safe pattern: spawn two threads (one per pipe) that continuously read and process output, then call `process.wait()`.
- Never use `process.communicate()` for long-running ffmpeg jobs — it buffers all output in memory before returning, blocking real-time progress parsing.
- Do not use `stdout=PIPE` if you do not need stdout; use `subprocess.DEVNULL` instead.

**Detection:** Worker thread CPU usage drops to zero while ffmpeg is supposedly running. Job progress stops updating. `psutil` shows ffmpeg process stuck in pipe write syscall.

**Phase:** Address in the worker/queue implementation phase (core pipeline), before any UI work.

---

### Pitfall C2: Windows Asyncio Event Loop Cannot Spawn Subprocesses

**What goes wrong:** `asyncio.create_subprocess_exec()` raises `NotImplementedError` on Windows when uvicorn uses `SelectorEventLoop` (which it does in some configurations).

**Why it happens:** Windows has two asyncio event loop implementations. `SelectorEventLoop` (the Windows default in Python < 3.8, and sometimes forced by frameworks) does not support subprocess creation. Only `ProactorEventLoop` supports it. Uvicorn's event loop selection strategy has changed across versions — as of 0.36.0+, overriding the policy with `WindowsSelectorEventLoopPolicy` before `uvicorn.run()` no longer works reliably.

**Consequences:** The entire encoding pipeline silently fails on Windows when trying to launch ffmpeg asynchronously. The error only surfaces at runtime.

**Prevention:**
- Do not use `asyncio.create_subprocess_exec` directly in FastAPI route handlers or background tasks.
- Run all ffmpeg subprocesses in a dedicated worker thread pool (`ThreadPoolExecutor`) using synchronous `subprocess.Popen`. Communicate results back to the asyncio event loop via `asyncio.Queue` or `janus` (mixed sync/async queue).
- Explicitly set `asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())` at application startup on Windows, OR avoid async subprocess entirely.
- Verify at application startup: `assert sys.platform != 'win32' or isinstance(asyncio.get_event_loop(), asyncio.ProactorEventLoop)`.

**Detection:** `NotImplementedError` from `asyncio.create_subprocess_exec` on Windows only.

**Phase:** Address at the very start of the worker architecture phase. This is a foundational Windows compatibility decision.

---

### Pitfall C3: ffmpeg Graceful Cancellation Kills the Parent on Windows

**What goes wrong:** Sending `CTRL_C_EVENT` to an ffmpeg subprocess on Windows also kills the Python parent process. `p.terminate()` calls `TerminateProcess()` which kills ffmpeg immediately without flushing output, leaving partial/corrupt intermediate files.

**Why it happens:** On Windows, `os.kill(pid, signal.CTRL_C_EVENT)` broadcasts the event to the entire process group, not just the target process. Without `CREATE_NEW_PROCESS_GROUP`, the Python process is in the same group and receives the signal too.

On Linux, `p.terminate()` sends SIGTERM which ffmpeg handles gracefully (flushes output, writes valid file trailer). On Windows, there is no SIGTERM equivalent — you must either send `CTRL_C_EVENT` to a separate process group, or write `q\n` to ffmpeg's stdin.

**Consequences:** Partial .mov chunk files left on disk. The job queue has no record of what was cleaned up. Subsequent job runs find corrupt or incomplete intermediate files.

**Prevention:**
- Always spawn ffmpeg with `creationflags=subprocess.CREATE_NEW_PROCESS_GROUP` on Windows.
- For graceful stop: write `q\n` to ffmpeg's stdin (ffmpeg interprets this as user-requested quit and finalizes output), then wait up to 5 seconds, then `p.kill()`.
- Cross-platform cancel strategy:
  ```python
  import sys, signal, subprocess
  if sys.platform == 'win32':
      proc = subprocess.Popen(..., creationflags=subprocess.CREATE_NEW_PROCESS_GROUP, stdin=subprocess.PIPE)
      # To cancel: proc.stdin.write(b'q\n'); proc.stdin.flush()
  else:
      proc = subprocess.Popen(..., stdin=subprocess.PIPE)
      # To cancel: proc.send_signal(signal.SIGTERM)
  ```
- After cancellation, always trigger temp file cleanup regardless of process exit code.

**Detection:** Python process exits when cancelling a job. Partial files in CHUNKS/ or ENCODED/ directories after cancellation.

**Phase:** Cancellation logic must be designed before the queue worker is built. Retrofitting cross-platform cancel is painful.

---

### Pitfall C4: VMAF Model File Path — Windows Path Escaping in ffmpeg Filter Strings

**What goes wrong:** libvmaf on Windows fails to find its model file because the path passed inside an ffmpeg filter string uses Windows-style backslashes, which ffmpeg's filter parser interprets as escape characters.

**Why it happens:** ffmpeg's `-lavfi` / `-filter_complex` argument parser has its own escaping rules. On Windows, the model path `C:\path\to\vmaf_v0.6.1.json` inside a filter string is parsed as escape sequences. On Linux, the model has a known default install path; on Windows, there is no standard install location and the path must always be explicitly specified.

The correct Windows encoding requires double-escaped colons:
- Wrong: `libvmaf=model_path=C:\vmaf\vmaf_v0.6.1.json`
- Wrong: `libvmaf=model_path=C:/vmaf/vmaf_v0.6.1.json`
- Correct: `libvmaf=model_path=C\\:/vmaf/vmaf_v0.6.1.json`

**Consequences:** VMAF scoring silently fails or raises "could not parse model config" error. The feedback loop cannot read VMAF scores, halting all encodes.

**Prevention:**
- Use a dedicated path-escaping function for Windows model paths in filter strings:
  ```python
  def vmaf_model_path_for_filter(path: Path) -> str:
      posix = path.as_posix()  # forward slashes
      if sys.platform == 'win32':
          # Escape the drive letter colon: C:/path -> C\:/path
          posix = posix.replace(':', '\\:')
      return posix
  ```
- Store the VMAF model file alongside the ffmpeg binary (or in a configurable `models/` directory). Never rely on system default paths, especially not on Windows.
- Download the `.json` model files from the Netflix VMAF GitHub repository and bundle them with the application.
- Validate that the model path exists at application startup before accepting any jobs.

**Detection:** "could not parse model config" or "No such file or directory" in ffmpeg stderr for VMAF operations. VMAF score returns -1 or is absent from the JSON log.

**Phase:** Core pipeline phase — the VMAF feedback loop cannot be built without this solved first.

---

### Pitfall C5: VMAF Returns Zero or Wrong Score Due to Resolution/Format Mismatch

**What goes wrong:** libvmaf silently returns 0 or a nonsensical score when the distorted and reference videos differ in resolution, pixel format, or are not frame-synchronized.

**Why it happens:** libvmaf requires both inputs to have identical width, height, and pixel format. The FFV1 intermediate chunks and the x264-encoded chunks may have identical content but differ in chroma subsampling or pixel format (e.g., `yuv420p10le` vs `yuv420p`). Additionally, VMAF compares frames by position, not by timestamp — if PTS is not normalized to 0, frame pairing will be wrong.

**Consequences:** VMAF score is wrong (often 0 or very low), causing the CRF feedback loop to run to its ceiling without terminating correctly. Or score is falsely high, producing poor quality output without triggering re-encoding.

**Prevention:**
- Always include explicit format normalization in the VMAF filter graph:
  ```
  [0:v]scale=WxH:flags=bicubic,format=yuv420p,setpts=PTS-STARTPTS[dist];
  [1:v]scale=WxH:flags=bicubic,format=yuv420p,setpts=PTS-STARTPTS[ref];
  [dist][ref]libvmaf=...
  ```
- Extract `W` and `H` from the reference chunk using `ffprobe` before running VMAF.
- `setpts=PTS-STARTPTS` is mandatory for chunk-based comparison to reset timestamps to 0.
- Match pixel format explicitly — don't assume the x264 output will match the FFV1 source format.

**Detection:** VMAF feedback loop runs to CRF ceiling on every chunk. VMAF scores are suspiciously uniform (all 0, all 100, or always the same value). Check ffmpeg stderr for libvmaf warnings about dimension mismatch.

**Phase:** Core pipeline phase — validate VMAF scoring works correctly against a known-good chunk pair before building the feedback loop logic.

---

## Moderate Pitfalls

These cause correctness bugs or reliability issues that are painful but recoverable.

---

### Pitfall M1: Job State "Running" After Crash — Ghost Jobs on Restart

**What goes wrong:** If the server crashes while a job is in `RUNNING` state, it restarts with that job still marked as running in the database. The worker never picks it back up. The job is stuck forever.

**Why it happens:** A simple status field with values `(queued, running, done, failed)` has no mechanism to distinguish "actively being processed" from "was processing when we crashed." SQLite has no row-level locks and no TTL mechanism.

**Consequences:** Queue accumulates ghost jobs. User cannot re-queue or retry the job because the system thinks it is running. Temp files from the aborted job are never cleaned up.

**Prevention:**
- Add a `heartbeat_at` timestamp column to the job record. The worker updates it every 10–30 seconds while the job is active.
- On startup, query for jobs in `RUNNING` state where `heartbeat_at < now() - 60s`. Transition these to `FAILED` with reason "Interrupted by server restart" and enqueue cleanup.
- Store `worker_pid` alongside job state. On startup, check if that PID is alive; if not, the job is orphaned.
- Always use a database transaction when transitioning job state to prevent partial updates.

**Detection:** Jobs stuck in "Running" after server restart. No ffmpeg process with the expected PID exists.

**Phase:** Queue persistence design phase.

---

### Pitfall M2: ffmpeg Progress Parsing — Carriage Return vs Newline

**What goes wrong:** ffmpeg writes progress updates using carriage return (`\r`) rather than newline (`\n`), overwriting the current line in a terminal. Reading stderr with `readline()` blocks indefinitely because no newline is ever written until the process ends.

**Why it happens:** ffmpeg's default stats output format writes `\r` + updated stats repeatedly on the same line. `readline()` only returns when it sees `\n`.

**Consequences:** Real-time progress updates never arrive. The UI shows no progress until the entire encode finishes, then all lines arrive at once.

**Prevention:**
- Read character-by-character from stderr and split on both `\r` and `\n`, OR
- Use ffmpeg's dedicated progress protocol: pass `-progress pipe:1 -nostats` which writes structured `key=value\n` pairs to stdout at regular intervals. This is parseable line-by-line and is the correct solution.
- The `-progress` output provides: `frame`, `fps`, `total_size`, `out_time_ms`, `dup_frames`, `drop_frames`, `speed`, `progress` (continues/end).
- Extract duration from a preliminary `ffprobe` call, then compute `out_time_ms / duration_ms * 100` for percentage.

**Detection:** Progress bar never moves until encode finishes. All progress lines arrive simultaneously at job completion.

**Phase:** Worker implementation phase, before connecting progress to the UI.

---

### Pitfall M3: Concat List File — "Unsafe File Name" and Path Spaces

**What goes wrong:** ffmpeg's concat demuxer rejects file paths in the concat list that contain spaces, absolute paths, or Windows drive letters when running with the default `safe=1` mode.

**Why it happens:** The concat demuxer's safety check rejects paths containing `..`, absolute paths, or paths with characters outside a safe set. Any user with spaces in their path (e.g., `D:\My Videos\`) will hit this.

**Consequences:** The final merge step fails silently or with a cryptic "Unsafe file name" error. All chunk encoding work is lost.

**Prevention:**
- Always pass `-safe 0` to the concat demuxer: `ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4`
- Write concat list files using absolute POSIX-style paths (using `Path.as_posix()`).
- Alternatively, use relative paths in the concat list by writing it to the same directory as the chunks and running ffmpeg from that directory (but this complicates process management).
- Quote paths in the concat list that contain spaces using single quotes: `file '/path/with spaces/chunk1.mov'`

**Detection:** "Unsafe file name" error in ffmpeg stderr during the concat step.

**Phase:** Pipeline implementation phase, during concat step development.

---

### Pitfall M4: PySceneDetect API Instability — Pin to Minor Version

**What goes wrong:** PySceneDetect 0.6 was a major breaking change from 0.5 (new backend system, deprecated `VideoManager`, new API surface). The API is documented as still evolving toward 1.0. Unpinned dependencies will pull in breaking changes silently.

**Why it happens:** PySceneDetect's own docs warn: "The current SceneDetector API is under development and expected to change somewhat before v1.0." The project is actively developed and makes breaking changes between minor versions.

Specific breaking changes in 0.6:
- `VideoManager` replaced by `scenedetect.backends` (e.g., `open_video`)
- `detect_scenes()` no longer shows a progress bar by default
- Logger is named `pyscenedetect` and has no default handlers (silently drops messages)

**Consequences:** Upgrading PySceneDetect breaks scene detection silently or with confusing errors. CSV output format may change.

**Prevention:**
- Pin PySceneDetect to a specific minor version: `scenedetect>=0.6.7,<0.7`
- Use only the stable CLI interface via subprocess (not the Python API) if stability is more important than integration depth. The CLI output format is more stable than the API.
- If using the Python API, wrap it in an adapter layer so changes are isolated.
- Variable framerate (VFR) sources are known-broken in PySceneDetect — detect VFR sources at input validation and warn the user.

**Detection:** `AttributeError` or `ImportError` on PySceneDetect after an upgrade. Scene detection produces no output or wrong scene count.

**Phase:** Input pipeline phase (scene detection step).

---

### Pitfall M5: WebSocket/SSE — Lost Progress Events on Reconnect

**What goes wrong:** The browser disconnects from the WebSocket or SSE stream (page refresh, tab sleep, network blip) and reconnects. The new connection receives no historical progress — it appears as if the job has no progress until the next event fires.

**Why it happens:** WebSocket connections are stateless — when a client reconnects, the server treats it as a brand-new connection with no shared state. If progress events are only pushed to active connections, reconnecting clients miss all prior events.

**Consequences:** User sees a blank progress bar after reconnecting. They cannot tell if the job is running or stuck.

**Prevention:**
- Maintain the last known progress state for each job in the job record (or an in-memory dict keyed by job ID).
- On WebSocket/SSE connection, immediately emit the current state for all active jobs before subscribing to future events.
- For SSE: use `id:` fields on events and honor `Last-Event-ID` on reconnect to replay missed events from a small ring buffer.
- Implement server-side heartbeat (ping every 15–30s) so the client can detect a stale connection before the user notices.

**Detection:** Progress bar resets to 0% when the browser tab is refreshed mid-encode.

**Phase:** Real-time progress phase, after the WebSocket/SSE transport is chosen.

---

### Pitfall M6: Temp File Accumulation on Crash or Cancellation

**What goes wrong:** FFV1 intermediates, chunk files, and encoded chunks are never deleted when a job is cancelled or the server crashes mid-encode. Over multiple failed jobs, disk space is exhausted.

**Why it happens:** `atexit` handlers are not called when Python receives an unhandled signal (SIGKILL, OOM killer, hard reboot). Cleanup code in a `finally` block is skipped if the process is forcibly killed. On Windows, temp files from a running process cannot be deleted until the process releases them.

**Consequences:** Disk fills up. Subsequent jobs fail to allocate temp space. Orphaned FFV1 files (which can be 10x the source size) are the primary risk.

**Prevention:**
- Store all temp file paths in the job database record (as a JSON array) at the moment each file is created — before writing to it.
- On job startup, the worker registers what it will create. On job failure or cancellation, the cleanup routine queries the database for the file list and deletes them.
- On server startup, run a cleanup pass: any job in `FAILED` or `CANCELLED` state that still has files listed in its `temp_files` column should have those files deleted.
- Use a dedicated temp directory per job (e.g., `TEMP/{job_id}/`) so that `shutil.rmtree(job_temp_dir)` cleans everything in one call.
- On Windows: ffmpeg holds file handles open during encoding. Ensure the ffmpeg process is fully terminated (not just "killing" its PID) before attempting file deletion.

**Detection:** Disk usage grows monotonically. TEMP/ directory contains directories from old job IDs.

**Phase:** Queue/worker phase, during job lifecycle design.

---

## Minor Pitfalls

These cause friction but are straightforward to fix.

---

### Pitfall m1: pathlib on Windows Returns WindowsPath — ffmpeg Args Need Strings

**What goes wrong:** Passing a `pathlib.WindowsPath` object directly to `subprocess.Popen` args list works in Python, but `Path.as_posix()` returns forward-slash paths that some Windows tools or ffmpeg filter arguments still misinterpret.

**Prevention:**
- Always call `str(path)` when building subprocess argument lists — Python handles the OS-correct format.
- Use `Path.as_posix()` only when building ffmpeg filter strings (e.g., VMAF model paths, concat list paths) where the ffmpeg filter parser expects forward slashes.
- Use `pathlib.Path` for all file operations internally; only convert to string at the boundary (subprocess args, filter strings, database storage).
- Store paths in the database as POSIX strings (forward slashes) for portability; reconstruct as `Path` objects on load.

**Phase:** Foundational — establish this convention in Phase 1, not retrofitted later.

---

### Pitfall m2: ffmpeg Progress Protocol — Duration Not Available for All Operations

**What goes wrong:** ffmpeg's `-progress` output provides `out_time_ms` (elapsed encode time) but not `total_duration`. Without knowing total duration, percentage cannot be computed.

**Prevention:**
- Run `ffprobe -v quiet -print_format json -show_format -show_streams input.mkv` before each encode to extract duration.
- Cache the probe result in the job record. Do not re-probe during encoding.
- Some container formats (notably MPEG-TS) do not report accurate duration from ffprobe — fall back to frame-count-based progress (`frame / total_frames`).
- For FFV1 intermediate encoding, duration is known from the source probe. For chunk encoding, duration is known per-chunk from the split metadata.

**Phase:** Worker implementation phase.

---

### Pitfall m3: PySceneDetect Scene CSV Timestamp Format — Parsing Fragility

**What goes wrong:** PySceneDetect's CSV output uses timecode strings (`HH:MM:SS.mmm`) not frame numbers. If parsed naively or if framerate detection is wrong, the ffmpeg split timestamps are off by a fraction of a frame, causing scene boundaries to fall mid-frame.

**Prevention:**
- Use PySceneDetect's `--output-dir` with `--save-images` disabled and `--stats-file` to get frame-accurate output.
- Prefer using PySceneDetect's Python API (despite version caveats) to get scene objects with both timecode and frame-number fields, rather than parsing CSV output.
- If using CLI output, parse the `Start Frame` column directly rather than the timecode string.
- Validate that ffmpeg split output chunk count matches PySceneDetect scene count ±1.

**Phase:** Scene detection / chunking pipeline phase.

---

### Pitfall m4: SQLite WAL Mode Not Enabled — Blocking Reads During Writes

**What goes wrong:** With default SQLite journal mode, a write transaction (job status update from worker) blocks all readers (web UI polling for job list). The UI appears to freeze or times out.

**Prevention:**
- Enable WAL mode at database creation: `PRAGMA journal_mode=WAL;`
- Set `check_same_thread=False` when creating the SQLite connection for multi-threaded access, and use a connection-per-thread or connection pool strategy.
- Keep write transactions short — update only the status field, not the entire job row, during hot-path worker loops.

**Phase:** Database schema phase.

---

### Pitfall m5: CRF Feedback Loop — No Convergence Guard

**What goes wrong:** The VMAF feedback loop adjusts CRF by ±1 per iteration. If VMAF oscillates around the target (e.g., CRF 18 gives VMAF 96.1, CRF 17 gives VMAF 97.8, alternating forever), the loop never terminates.

**Prevention:**
- Track CRF values already tried in the current iteration. If a CRF is revisited, accept the closest result and exit.
- Add a maximum iteration count (e.g., `max_iterations=10`).
- If `crfMin` and `crfMax` are both exhausted without hitting the target, accept the best result and log a warning.
- Store all VMAF results per chunk to surface quality outliers in the UI.

**Phase:** VMAF feedback loop implementation phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Worker architecture | Windows asyncio event loop (C2) | Decide sync-in-thread vs async subprocess strategy before writing any worker code |
| ffmpeg subprocess launch | Pipe deadlock (C1) | Use dedicated reader threads per pipe from the start; never use `communicate()` |
| Job cancellation | Windows graceful kill (C3) | Use `CREATE_NEW_PROCESS_GROUP` + stdin `q\n` cancel from day one |
| VMAF integration | Model path on Windows (C4) | Write path escaping utility and validate at startup before any other VMAF work |
| VMAF scoring | Resolution/format mismatch (C5) | Add explicit scale+format normalization to all VMAF filter graphs |
| Database design | Ghost jobs on restart (M1) | Add heartbeat column and startup recovery query to schema |
| Progress reporting | Carriage return parsing (M2) | Use `-progress pipe:1 -nostats` from the start instead of stderr parsing |
| Merge/concat step | Unsafe file names (M3) | Always use `-safe 0`; write test with space-containing paths |
| PySceneDetect | API breaking changes (M4) | Pin version at `>=0.6.7,<0.7` and wrap in adapter |
| WebSocket/SSE | State on reconnect (M5) | Emit current state on connect; implement heartbeat ping |
| Temp file cleanup | Crash orphans (M6) | Store temp file list in DB at creation time; run cleanup on startup |
| Path handling | Windows pathlib types (m1) | Establish `str()` vs `as_posix()` convention before writing any file I/O code |
| PySceneDetect | Scene CSV parsing (m3) | Use Python API or `Start Frame` column, not timecode strings |
| Database | SQLite blocking (m4) | Enable WAL mode in schema migration |
| VMAF loop | Non-convergence (m5) | Add visited-CRF set and max-iteration guard from the start |

---

## Sources

- Python subprocess documentation — pipe deadlock warning: https://docs.python.org/3/library/subprocess.html
- ffmpeg-progress-yield PyPI: https://pypi.org/project/ffmpeg-progress-yield/
- Graceful ffmpeg stop on Windows (Camratus blog): https://camratus.com/blog/_Python__Graceful_stop_FFMPEG_recording_process_on_Windows-55
- Windows CTRL_C_EVENT process group (concourse issue): https://github.com/concourse/concourse/issues/2368
- Netflix VMAF ffmpeg documentation: https://github.com/netflix/vmaf/blob/master/resource/doc/ffmpeg.md
- VMAF Windows path escaping (Streaming Learning Center): https://streaminglearningcenter.com/blogs/compute-vmaf-using-ffmpeg-on-windows.html
- VMAF Windows path escaping (FFMetrics issue): https://github.com/fifonik/FFMetrics/issues/81
- VMAF score zero (Netflix VMAF issue #217): https://github.com/Netflix/vmaf/issues/217
- VMAF resolution mismatch (Netflix VMAF issue #248): https://github.com/Netflix/vmaf/issues/248
- PySceneDetect changelog: https://www.scenedetect.com/changelog/
- PySceneDetect migration guide: https://www.scenedetect.com/docs/0.6.5/api/migration_guide.html
- persist-queue SQLite crash recovery: https://github.com/peter-wangxu/persist-queue
- FastAPI WebSocket disconnection issue: https://github.com/fastapi/fastapi/discussions/9031
- FastAPI long-running background tasks: https://github.com/fastapi/fastapi/discussions/7930
- uvicorn Windows event loop issue: https://github.com/Kludex/uvicorn/issues/1220
- asyncio Windows subprocess support: https://docs.python.org/3/library/asyncio-platforms.html
- ffmpeg concat unsafe file name: https://copyprogramming.com/howto/ffmpeg-concat-unsafe-file-name
- atexit signal handler limitations: https://docs.python.org/3/library/atexit.html
- VMAF libvmaf model path issue #465: https://github.com/Netflix/vmaf/issues/465
- janus mixed sync/async queue: https://github.com/aio-libs/janus
