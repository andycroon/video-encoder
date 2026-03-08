# Phase 5: React UI - Research

**Researched:** 2026-03-08
**Domain:** React 19 + TypeScript + Vite SPA with SSE streaming, FastAPI static serving, encoder profile CRUD
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layout structure**
- Single-page app, no routing, no navigation tabs
- Top bar: persistent path text field + Add button (always visible)
- Below path field: profile picker dropdown + [Edit] button (opens profile editor modal)
- Job queue occupies the main content area
- No separate settings page or collapsible settings section — settings live in profiles

**Encoder profiles**
- Profiles replace the global settings concept in the UI — users pick a named profile per job
- Profile fields: name, vmaf_min, vmaf_max, crf_min, crf_max, crf_start, audio_codec, x264_params (the full parameter block)
- "Default" profile seeded with the exact original script parameters: VMAF 96.2–97.6, CRF 16–20, start 17, audio EAC3, x264 params: `partitions=i4x4+p8x8+b8x8`, `trellis 2`, `deblock -3:-3`, `b_qfactor 1`, `i_qfactor 0.71`, `qcomp 0.50`, `maxrate 12000K`, `bufsize 24000k`, `qmax 40`, `subq 10`, `me_method umh`, `me_range 24`, `b_strategy 2`, `bf 2`, `sc_threshold 0`, `g 48`, `keyint_min 48`, `-flags -loop`
- Profiles stored in SQLite via new `/profiles` endpoints (new table, not localStorage)
- Profile editor modal: opened via [Edit] button next to picker — create, edit, delete profiles from there
- When adding a job: profile snapshot is passed as `config` override on `POST /jobs` (existing API field)

**Job list presentation**
- Expandable rows — each job is a compact collapsed row that expands on click
- Collapsed row shows: filename, status badge, current pipeline stage, ETA, action buttons
- Completed jobs collapsed row shows: filename, DONE badge, avg VMAF, avg CRF, total duration, [Retry]
- Action buttons: RUNNING → [Pause][Cancel], QUEUED → [Cancel], FAILED/CANCELLED → [Retry], DONE → [Retry]

**Expanded job card layout**
- Two-column layout inside expanded card:
  - Left column: pipeline stage list with checkmarks (8 named stages), completed ✔ + duration, active ▶, pending dimmed
  - Right column: chunk data table (only during/after chunk encode stage)
- Below the two columns: collapsible ffmpeg log section

**Live chunk data table**
- Table columns: Chunk #, CRF, VMAF, Passes
- Rows populate live as `chunk_complete` SSE events arrive
- Currently-encoding chunk shows "--" for VMAF with subtle running indicator
- Table fills in from top; no pagination

**ETA calculation**
- ETA = chunks remaining × average time per completed chunk
- Updates after each `chunk_complete` event
- Shown in collapsed row: "Chunk encode 4/12   ETA 8m 30s"
- ETA only shown during chunk encode stage

**ffmpeg log panel**
- Toggle: "Show ffmpeg log ▾" / "Hide ffmpeg log ▴" at bottom of expanded card
- Full captured stderr in a fixed-height (~300px) scrollable monospace box
- Auto-scrolls to bottom; pauses if user scrolls up; resumes when user scrolls back to bottom
- No truncation

### Claude's Discretion

- Visual design, color palette, typography — must be polished and non-generic (use frontend-design skill)
- Exact status badge colors and styling
- Pipeline stage list icon/animation for active stage
- Transition animations for row expand/collapse
- How to handle very long file paths in the collapsed row (truncation strategy)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUEUE-01 | User can add a job by entering a source file path in the web UI | Top-bar path input + POST /jobs; profile picker sends config snapshot |
| QUEUE-02 | User can pause an active or queued job | PATCH /jobs/{id}/pause; Pause button on collapsed row |
| QUEUE-03 | User can cancel an active or queued job (graceful termination + cleanup) | DELETE /jobs/{id} + confirmation modal (Radix AlertDialog); cancel button on collapsed row |
| QUEUE-04 | User can retry a failed job | POST /jobs/{id}/retry; Retry button on collapsed/done rows |
| PROG-01 | User sees named pipeline stage for each active job | SSE `stage` events update per-job stage state; left column of expanded card |
| PROG-02 | User sees per-chunk VMAF score and final CRF live | SSE `chunk_complete` events populate chunk table; `chunk_progress` shows active row |
| PROG-03 | User can view full ffmpeg stderr log per job | GET /jobs/{id} log field + collapsible log panel with auto-scroll |
| PROG-04 | User sees estimated time remaining per active job | ETA derived from chunk_complete timestamps in client state; shown in collapsed row |
| DOC-01 | README.md complete — getting-started walkthrough, UI feature overview, troubleshooting | Final phase; synthesize all prior README sections + add Phase 5 section |
</phase_requirements>

---

## Summary

Phase 5 is a React 19 + TypeScript + Vite single-page application that consumes the FastAPI backend built in Phase 4. No new pipeline capabilities — the UI surfaces exactly what the API already exposes. The one backend addition is a `/profiles` CRUD endpoint with a new SQLite table; everything else is pure frontend work.

The most technically significant frontend concerns are: (1) SSE subscription management — one `EventSource` per active job, opened and torn down correctly as jobs start/finish; (2) ETA computation fully in the React client from `chunk_complete` event timestamps; (3) the auto-scroll/pause log panel pattern; and (4) the profile editor modal with controlled form state.

For serving, FastAPI mounts the Vite `dist/` output as static files so the app ships as a single deployment. In development, the Vite dev server proxies `/api` to `http://127.0.0.1:8000` — no CORS configuration changes needed since CORS is already wide open on the backend.

The `frontend-design` skill MUST be applied when implementing the visual design. The planner should allocate a dedicated wave for design/visual polish using that skill. This is the user-facing product — generic AI aesthetics are explicitly unacceptable.

**Primary recommendation:** Build the frontend as a Vite React-TS project in a `frontend/` subdirectory. One SSE hook (`useJobStream`) per job handles all event types. Zustand for global jobs list state. Radix UI AlertDialog for cancel confirmation. Motion (Framer Motion) for expand/collapse. `react-scroll-to-bottom` or a hand-rolled ref approach for the log panel.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.x | UI framework | Locked in project memory |
| react-dom | 19.x | DOM renderer | Paired with React |
| typescript | 5.x | Type safety | Locked in project memory |
| vite | 6.x (or 7.x latest stable) | Build tool & dev server | Locked in project memory |
| @vitejs/plugin-react | latest | React fast refresh | Required Vite React plugin |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tailwindcss | 4.x | Utility CSS | Fastest way to implement polished design; v4 stable since Jan 2025 |
| @tailwindcss/vite | 4.x | Vite plugin for Tailwind v4 | Replaces PostCSS setup; zero-config |
| zustand | 4.x | Global jobs list state | Lightweight (<1KB), no providers, React 19 compatible |
| motion (framer-motion) | 11.x | Row expand/collapse animation | CSS-only height animation for dynamic content |
| @radix-ui/react-alert-dialog | latest | Cancel confirmation modal | Accessible, focus-trapped, headless (style with Tailwind) |
| @radix-ui/react-dialog | latest | Profile editor modal | Same rationale; separate primitive for non-destructive modals |
| react-scroll-to-bottom | 4.x | Log panel auto-scroll with pause/resume | Handles sticky detection out of the box; avoids hand-rolling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand | TanStack Query | TanStack Query excels at REST polling; SSE is the primary data channel here so a simple Zustand store is lower ceremony |
| Radix AlertDialog | Custom modal | Custom modals miss focus trap, keyboard dismiss, accessibility — use Radix |
| react-scroll-to-bottom | Hand-rolled useRef | Hand-rolled works but `react-scroll-to-bottom` has the sticky/unsticky distinction already solved |
| Motion (Framer Motion) | CSS transitions | Dynamic height (auto) cannot be transitioned in CSS alone; Motion handles it via layout animations |
| Tailwind v4 | Tailwind v3 | v4 is stable since Jan 2025; v4 + @tailwindcss/vite plugin is the current standard setup |

### Installation
```bash
# In frontend/ directory
npm create vite@latest . -- --template react-ts
npm install react@19 react-dom@19 @types/react@19 @types/react-dom@19
npm install tailwindcss @tailwindcss/vite
npm install zustand
npm install motion
npm install @radix-ui/react-alert-dialog @radix-ui/react-dialog @radix-ui/react-select
npm install react-scroll-to-bottom
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

---

## Architecture Patterns

### Recommended Project Structure
```
frontend/
├── src/
│   ├── api/             # Typed fetch wrappers for all API calls
│   │   ├── jobs.ts      # POST/GET/PATCH/DELETE/retry
│   │   ├── profiles.ts  # GET/POST/PUT/DELETE /profiles
│   │   └── settings.ts  # GET /settings (for initial Default seed)
│   ├── hooks/
│   │   ├── useJobStream.ts   # SSE EventSource subscription per job
│   │   └── useEta.ts         # ETA computation from chunk timestamps
│   ├── store/
│   │   └── jobsStore.ts  # Zustand store: jobs[], profiles[], activeExpanded
│   ├── components/
│   │   ├── TopBar.tsx           # Path input + Add button + profile picker
│   │   ├── ProfileModal.tsx     # Create/edit/delete profiles (Radix Dialog)
│   │   ├── JobList.tsx          # Maps jobs to JobRow
│   │   ├── JobRow.tsx           # Collapsed row + expand animation
│   │   ├── JobCard.tsx          # Expanded two-column layout
│   │   ├── StageList.tsx        # Left column: pipeline stages
│   │   ├── ChunkTable.tsx       # Right column: live chunk data
│   │   ├── LogPanel.tsx         # ffmpeg log with auto-scroll
│   │   ├── StatusBadge.tsx      # Status chip with colors
│   │   └── CancelDialog.tsx     # Radix AlertDialog for cancel confirm
│   ├── types/
│   │   └── index.ts     # Job, Profile, StageEvent, ChunkEvent types
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css        # @import "tailwindcss" only
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Pattern 1: SSE hook — one connection per active job
**What:** Custom hook that opens an `EventSource` for a job when it becomes RUNNING, dispatches events into Zustand, and closes cleanly on job_complete/error or component unmount.
**When to use:** Attach to each JobRow when `job.status === 'RUNNING'`

```typescript
// Source: MDN EventSource + React pattern
function useJobStream(jobId: number, enabled: boolean) {
  const dispatch = useJobsStore(s => s.handleSseEvent);
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    const handle = (type: string) => (e: MessageEvent) => {
      dispatch(jobId, type, JSON.parse(e.data));
    };
    ['stage', 'chunk_progress', 'chunk_complete', 'job_complete', 'error', 'warning']
      .forEach(t => es.addEventListener(t, handle(t)));
    es.onerror = () => es.close(); // backend closes stream; EventSource auto-closes
    return () => es.close();
  }, [jobId, enabled]);
}
```

**Key detail:** Named SSE events (`event: stage\n`) require `es.addEventListener('stage', handler)` — NOT `es.onmessage`. The backend uses named events throughout.

### Pattern 2: Zustand store — flat jobs list + SSE event reducer
**What:** Single store holds `jobs[]`, `profiles[]`, and `expandedJobId`. SSE events mutate individual job entries in place.

```typescript
// Source: Zustand docs pattern
interface JobsState {
  jobs: Job[];
  profiles: Profile[];
  expandedJobId: number | null;
  handleSseEvent: (jobId: number, type: string, data: unknown) => void;
  setExpanded: (id: number | null) => void;
}

const useJobsStore = create<JobsState>((set) => ({
  jobs: [],
  profiles: [],
  expandedJobId: null,
  handleSseEvent: (jobId, type, data) =>
    set(state => ({
      jobs: state.jobs.map(j =>
        j.id === jobId ? applyEvent(j, type, data) : j
      )
    })),
  setExpanded: (id) => set({ expandedJobId: id }),
}));
```

### Pattern 3: ETA computation in client
**What:** After each `chunk_complete` event, compute average seconds-per-chunk from timestamps stored in job state. Multiply by remaining chunks.
**When to use:** Only displayed during chunk encode stage. Reset on each job.

```typescript
// Derived value — not stored, computed on render
function computeEta(completedChunks: ChunkData[], totalChunks: number): number | null {
  if (completedChunks.length === 0) return null;
  const avgMs = completedChunks.reduce((sum, c) => sum + c.durationMs, 0) / completedChunks.length;
  const remaining = totalChunks - completedChunks.length;
  return remaining * avgMs;
}
```

**Critical:** `chunk_complete` event provides `chunk_index` and timing. The client must record `Date.now()` when `chunk_progress` fires for chunk N and when `chunk_complete` fires for chunk N to derive per-chunk duration.

### Pattern 4: Profile snapshot on job submit
**What:** When the user clicks Add, read the selected profile's config fields and pass them as the `config` object to `POST /jobs`.

```typescript
// Profile config maps directly to the POST /jobs config field
const submitJob = async (sourcePath: string, profile: Profile) => {
  await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_path: sourcePath,
      config: {
        vmaf_min: profile.vmaf_min,
        vmaf_max: profile.vmaf_max,
        crf_min: profile.crf_min,
        crf_max: profile.crf_max,
        crf_start: profile.crf_start,
        audio_codec: profile.audio_codec,
        x264_params: profile.x264_params,
      }
    })
  });
};
```

### Pattern 5: Vite dev proxy → FastAPI
**What:** Proxy `/api` requests from the Vite dev server to the FastAPI backend at port 8000. Production: FastAPI serves the built `frontend/dist/` as static files.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  }
});
```

**Production FastAPI mount (in main.py, new code):**
```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
```
This must be added AFTER all API routes — StaticFiles catch-all will intercept API routes if mounted first.

### Anti-Patterns to Avoid
- **Opening one SSE connection for all jobs:** EventSource cannot filter by job — open one per active job and close it when done.
- **Storing SSE-derived data in component state only:** If the expanded card unmounts (user collapses), data is lost. Store chunk data in Zustand.
- **Using `onmessage` for named SSE events:** `onmessage` only catches events without an `event:` line. Named events require `addEventListener`.
- **Mounting StaticFiles before API routes:** The catch-all `html=True` will intercept all unmatched paths including API endpoints.
- **Relying on EventSource auto-reconnect for terminal streams:** The backend closes the SSE stream after `job_complete`. EventSource will try to reconnect — handle this by checking the last received event type and not reopening.

---

## Backend Work Required (Phase 5 scope)

### New `/profiles` Endpoints
The CONTEXT.md specifies this as a Phase 5 backend task. The frontend cannot function without it.

**New SQLite table:**
```sql
CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    config     TEXT NOT NULL,   -- JSON blob: all encoding params
    is_default INTEGER NOT NULL DEFAULT 0
);
```

**Required endpoints:**
```
GET    /profiles          → list all profiles
POST   /profiles          → create new profile
PUT    /profiles/{id}     → update profile
DELETE /profiles/{id}     → delete profile (block if is_default)
```

**Seed logic:** On `init_db()`, insert Default profile from current `SETTINGS_DEFAULTS` if `profiles` table is empty. This follows the same `INSERT OR IGNORE` pattern used for settings.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cancel confirmation dialog | Custom modal | Radix AlertDialog | Focus trap, keyboard dismiss, ARIA `role="alertdialog"`, screen reader support |
| Profile editor modal | Custom modal | Radix Dialog | Same accessibility requirements |
| Log auto-scroll with pause | Manual scroll detection | react-scroll-to-bottom | `useSticky` hook handles the sticky/unsticky boundary correctly |
| Row expand height animation | CSS `max-height` hack | Motion `AnimatePresence` + `layout` | `max-height` transition requires a fixed maximum; dynamic content breaks it |
| Dropdown select | `<select>` element | Radix Select | Styled consistently, keyboard navigable, accessible |

**Key insight:** Accessibility for interactive elements (modals, dialogs) requires significant work to get right from scratch. Radix primitives are unstyled but fully accessible — they are the correct foundation for this project's interactive components.

---

## Common Pitfalls

### Pitfall 1: EventSource auto-reconnect on terminal stream
**What goes wrong:** The backend closes the SSE connection after `job_complete`. EventSource treats a closed connection as an error and tries to reconnect every 3 seconds. The React component now opens a new connection to a finished job, getting no events.
**Why it happens:** EventSource is designed for long-lived streams and reconnects on any close/error.
**How to avoid:** In the SSE hook, track whether a terminal event (`job_complete` or `error`) was received. If yes, call `es.close()` before the EventSource auto-reconnects. Check `es.readyState === EventSource.CLOSED` in the `onerror` handler.
**Warning signs:** Seeing repeated connection attempts in the Network tab after a job finishes.

### Pitfall 2: Named SSE events ignored by `onmessage`
**What goes wrong:** The backend emits `event: stage\ndata: {...}\n\n`. The `onmessage` handler never fires.
**Why it happens:** `onmessage` only fires for events without an `event:` type line (i.e., unnamed events). Named events require `addEventListener`.
**How to avoid:** Register `es.addEventListener('stage', ...)`, `es.addEventListener('chunk_complete', ...)` etc. for each named event type.
**Warning signs:** SSE stream is open (Network tab shows data), but no React state updates.

### Pitfall 3: StaticFiles mount intercepting API routes
**What goes wrong:** `GET /jobs` returns the `index.html` page instead of JSON.
**Why it happens:** `StaticFiles(html=True)` catches all unmatched paths. If mounted before API routes are registered, it intercepts everything.
**How to avoid:** Mount StaticFiles as the last statement in `main.py`, after all `@app.get`, `@app.post`, etc. decorators.
**Warning signs:** API calls return HTML; no 404 from FastAPI.

### Pitfall 4: Profile x264_params is a structured object, not a flat string
**What goes wrong:** The profile editor sends x264_params as a JSON object `{"trellis": "2", ...}`. The existing API `POST /jobs` `config` field accepts this but the pipeline assembles the `-x264-params` ffmpeg argument from this dict. If the editor sends a flat string instead, the pipeline breaks.
**Why it happens:** The profile editor needs to let users edit individual x264 param key-value pairs, not a raw string.
**How to avoid:** Profile editor stores `x264_params` as `Record<string, string>`. Display as a key-value form or a well-formatted text area that parses to/from the dict format.
**Warning signs:** Encoding fails with ffmpeg x264-params error after profile edit.

### Pitfall 5: ETA computation requires client-side timestamps
**What goes wrong:** ETA is wrong or never appears.
**Why it happens:** The SSE events don't include per-chunk wall-clock duration. The client must record timestamps when `chunk_progress` (chunk started) and `chunk_complete` (chunk finished) arrive.
**How to avoid:** In the Zustand event handler, record `Date.now()` when a `chunk_progress` event for a new chunk_index arrives. Compute duration when `chunk_complete` arrives for the same index.
**Warning signs:** ETA always shows 0 or NaN.

### Pitfall 6: Chunk table loses data when card collapses
**What goes wrong:** User collapses a job card, chunk data disappears. On re-expand, the table is empty (or shows only new events).
**Why it happens:** If ChunkTable state is local to the component, it is destroyed on unmount.
**How to avoid:** Store all received chunk data in the Zustand job record, not in component state. ChunkTable reads from the store.

---

## Code Examples

### Tailwind v4 + Vite setup (no config file)
```css
/* src/index.css */
@import "tailwindcss";
```

```typescript
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
// add to plugins array — no tailwind.config.js needed
```

### Log panel auto-scroll with pause/resume
```typescript
// Using react-scroll-to-bottom
import ScrollToBottom from 'react-scroll-to-bottom';

function LogPanel({ log }: { log: string }) {
  return (
    <ScrollToBottom className="h-72 font-mono text-xs overflow-y-auto bg-neutral-950 p-3">
      <pre className="whitespace-pre-wrap">{log}</pre>
    </ScrollToBottom>
  );
}
// ScrollToBottom shows a "jump to bottom" button automatically when user scrolls up
```

### Radix AlertDialog for cancel confirmation
```typescript
import * as AlertDialog from '@radix-ui/react-alert-dialog';

function CancelDialog({ jobId, onConfirm }: { jobId: number; onConfirm: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button>Cancel</button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/60" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ...">
          <AlertDialog.Title>Cancel encoding job?</AlertDialog.Title>
          <AlertDialog.Description>ffmpeg will be stopped and temp files cleaned up.</AlertDialog.Description>
          <AlertDialog.Cancel asChild><button>Keep running</button></AlertDialog.Cancel>
          <AlertDialog.Action asChild><button onClick={onConfirm}>Cancel job</button></AlertDialog.Action>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
```

### Motion expand/collapse for job card
```typescript
import { AnimatePresence, motion } from 'motion/react';

// Inside JobRow
<AnimatePresence>
  {isExpanded && (
    <motion.div
      key="card"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <JobCard job={job} />
    </motion.div>
  )}
</AnimatePresence>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 + PostCSS config + tailwind.config.js | Tailwind v4 + @tailwindcss/vite plugin, zero config | Jan 2025 | No config files needed; @import "tailwindcss" in CSS |
| `npm create react-app` | `npm create vite@latest -- --template react-ts` | 2022+ | CRA is deprecated; Vite is the standard |
| Redux for global state | Zustand (or Jotai) | 2023+ | 1KB, no boilerplate, hook-first |
| Framer Motion (package name) | Motion (new package name `motion`) | 2024 | Import from `motion/react`, not `framer-motion` |
| Vite proxy with `rewrite` for `/api` | Same pattern, still standard | — | No change; still the correct dev approach |

**Deprecated/outdated:**
- `framer-motion` package name: Framer Motion is now published as `motion` — import from `motion/react`
- Tailwind v3 `tailwind.config.js`: Not needed in v4
- `@tailwind base; @tailwind components; @tailwind utilities` directives: Replaced by `@import "tailwindcss"` in v4
- `create-react-app`: Deprecated, do not use

---

## Open Questions

1. **Vite output base path for FastAPI static serving**
   - What we know: FastAPI `StaticFiles(html=True)` serves from root. Vite defaults to absolute asset paths (`/assets/...`).
   - What's unclear: Whether `base: './'` in vite.config.ts is needed or whether serving from root works with defaults.
   - Recommendation: Leave Vite base at default `/` since FastAPI mounts at `/`. If asset paths break, add `base: './'`.

2. **SSE reconnect behavior for jobs that finish while UI is closed**
   - What we know: Jobs completed before the browser tab opened have no active SSE stream. Their state must be loaded via `GET /jobs`.
   - What's unclear: Whether polling `GET /jobs` periodically is needed for jobs added via watch folder (no SSE subscription active).
   - Recommendation: Poll `GET /jobs` every 5 seconds as a baseline; SSE streams provide real-time updates for jobs the user adds during the session. This covers watch-folder jobs appearing without user action.

3. **Polling interval for `GET /jobs` list refresh**
   - What we know: The UI needs to show watch-folder-added jobs. SSE only covers jobs the client subscribes to.
   - Recommendation: 5-second polling of `GET /jobs` is simple and correct for a single-user local tool.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x + React Testing Library |
| Config file | `frontend/vite.config.ts` (vitest config inline) or `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && npm test -- --run` |
| Full suite command | `cd frontend && npm test -- --run --reporter=verbose` |

Backend tests remain `pytest tests/ -v` (unchanged from prior phases).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-01 | Add job form submits POST /jobs with correct payload | unit (component) | `npm test -- --run src/components/TopBar.test.tsx` | ❌ Wave 0 |
| QUEUE-02 | Pause button calls PATCH /jobs/{id}/pause | unit (component) | `npm test -- --run src/components/JobRow.test.tsx` | ❌ Wave 0 |
| QUEUE-03 | Cancel dialog shows confirmation before DELETE | unit (component) | `npm test -- --run src/components/CancelDialog.test.tsx` | ❌ Wave 0 |
| QUEUE-04 | Retry button calls POST /jobs/{id}/retry | unit (component) | `npm test -- --run src/components/JobRow.test.tsx` | ❌ Wave 0 |
| PROG-01 | Stage events update stage list display | unit (hook) | `npm test -- --run src/hooks/useJobStream.test.ts` | ❌ Wave 0 |
| PROG-02 | chunk_complete events populate chunk table | unit (component) | `npm test -- --run src/components/ChunkTable.test.tsx` | ❌ Wave 0 |
| PROG-03 | Log panel renders log text, toggle works | unit (component) | `npm test -- --run src/components/LogPanel.test.tsx` | ❌ Wave 0 |
| PROG-04 | ETA computed correctly from chunk timestamps | unit (hook) | `npm test -- --run src/hooks/useEta.test.ts` | ❌ Wave 0 |
| DOC-01 | README.md contains all required sections | manual review | — | manual-only |

### Sampling Rate
- **Per task commit:** `cd frontend && npm test -- --run`
- **Per wave merge:** `cd frontend && npm test -- --run --reporter=verbose`
- **Phase gate:** All Vitest tests green + manual README review before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `frontend/` directory — scaffold with `npm create vite@latest`
- [ ] `frontend/src/hooks/useJobStream.test.ts` — covers PROG-01, PROG-02
- [ ] `frontend/src/hooks/useEta.test.ts` — covers PROG-04
- [ ] `frontend/src/components/TopBar.test.tsx` — covers QUEUE-01
- [ ] `frontend/src/components/JobRow.test.tsx` — covers QUEUE-02, QUEUE-04
- [ ] `frontend/src/components/CancelDialog.test.tsx` — covers QUEUE-03
- [ ] `frontend/src/components/ChunkTable.test.tsx` — covers PROG-02
- [ ] `frontend/src/components/LogPanel.test.tsx` — covers PROG-03
- [ ] Vitest config: add `test: { environment: 'jsdom' }` to `vite.config.ts`
- [ ] Framework install: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`

---

## Sources

### Primary (HIGH confidence)
- Vite official docs (vite.dev/guide, vite.dev/config/server-options) — proxy config, static files
- Tailwind CSS v4 blog post (tailwindcss.com/blog/tailwindcss-v4) — v4 stable Jan 2025, @tailwindcss/vite plugin
- React v19 announcement (react.dev/blog/2024/12/05/react-19) — stable release Dec 2024
- Radix UI docs (radix-ui.com/primitives/docs/components/alert-dialog, /dialog) — AlertDialog and Dialog API
- MDN EventSource — named event handling via `addEventListener`
- FastAPI static files docs (fastapi.tiangolo.com/tutorial/static-files/) — StaticFiles mount pattern

### Secondary (MEDIUM confidence)
- WebSearch: Tailwind v4 + Vite integration (multiple guides, Jan–Mar 2025) — confirmed with official docs
- WebSearch: Zustand vs Context 2025 (dev.to, makersden.io) — Zustand is current standard for lightweight global state
- WebSearch: Motion (Framer Motion) accordion height animation — confirmed package renamed to `motion`
- WebSearch: react-scroll-to-bottom npm page — sticky/unsticky pattern for log panels

### Tertiary (LOW confidence)
- WebSearch: SSE + TanStack Query integration — limited native support; custom hook approach confirmed as correct pattern
- WebSearch: Vite 7.x latest — version number (7.3.1 mentioned) could not be independently verified against npm; plan for Vite 6.x, use whatever latest stable resolves

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — React 19 + Vite + Tailwind v4 all verified as stable from official sources
- Architecture: HIGH — patterns derived from actual API code (main.py, sse.py) already built in Phase 4
- Pitfalls: HIGH — SSE named event pitfall and StaticFiles mount order derived directly from reading backend code
- Validation: MEDIUM — Vitest for Vite projects is well-established; test file structure is speculative until scaffold exists

**Research date:** 2026-03-08
**Valid until:** 2026-06-08 (Tailwind v4 and React 19 are stable; ecosystem is not moving rapidly on these choices)
