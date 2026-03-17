# Phase 8: UI Enhancements - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Visual quality evidence for completed jobs: a VMAF line chart per job and a CRF convergence indicator per chunk. Plus a dark/light theme toggle that persists across sessions with no flash of wrong theme. No new pipeline stages or API endpoints.

</domain>

<decisions>
## Implementation Decisions

### VMAF Chart placement
- Chart appears **below ChunkTable** inside the expanded job card (both visible simultaneously — table shows exact numbers, chart shows trend)
- Visible for **both in-progress and completed jobs** — chart grows chunk-by-chunk as encodes complete during a live run
- Layout order inside expanded card: Stage list (left) + Chunk table (right) → VMAF chart (full width, below) → ffmpeg log (collapsed, below chart)
- Chart uses `recharts` LineChart with a `ReferenceArea` for the VMAF target band

### VMAF Chart data
- Target band (ReferenceArea) uses the **job's configured vmaf_min/vmaf_max** from `job.config` (already in the Job type) — not hardcoded defaults
- Data source: `job.chunks` array (ChunkData[]), plotting `vmaf` per `chunkIndex`
- In-progress chunks with `vmaf: null` are omitted from the line; the chart reflects only completed chunks

### CRF convergence indicator
- The existing `Passes` column in ChunkTable is **replaced** with a mini horizontal progress bar per row
- Bar is proportional to pass count (out of max 10 CRF iterations)
- Color is quality-tiered (same mental model as VMAF colors):
  - 1 pass → green (`#22c55e`)
  - 2–3 passes → amber (`#f59e0b`)
  - 4+ passes → red (`#ef4444`)
- Pass count shown as a number next to the bar for precision

### Dark/light theme
- Light mode is a **desaturated dark (dim mode)** — lifts the existing dark palette to grays, not a full contrast inversion
  - Example shift: `--bg: #0d0d0f` → `#1e1e22`, `--panel: #141417` → `#252528`, `--raised: #1a1a1f` → `#2d2d32`, `--border: #2a2a35` → `#3a3a45`, `--txt: #f4f4f6` → `#e8e8f0`
- Theme applied via `data-theme` attribute on `<html>` element, with CSS `[data-theme="light"] { }` block overriding the custom properties
- Default is dark (no localStorage entry = dark)

### Theme toggle
- Sun/moon icon button added to the TopBar **controls row**, next to the existing `Profiles` and `Settings` buttons
- Shows 🌙 when in dark mode, ☀️ when in light mode (or equivalent SVG icons)
- Calls a `useTheme` hook that updates `localStorage` and the `data-theme` attribute

### Flash prevention
- **Inline `<script>` in `index.html`** before the React bundle reads localStorage and sets `data-theme` on `<html>` synchronously — zero flash guaranteed
- React `useTheme` hook hydrates from the already-set attribute (not from localStorage directly) to stay in sync

### Claude's Discretion
- Exact recharts styling (axis labels, tooltip design, line stroke width, dot size)
- Exact icon assets for sun/moon toggle (SVG inline or unicode)
- Chart height and responsive behavior
- Whether to show Y-axis tick labels or just the reference band bounds

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — UI-V2-01 (VMAF chart), UI-V2-02 (CRF convergence count), UI-V2-03 (dark mode toggle + localStorage persistence)

### Roadmap
- `.planning/ROADMAP.md` §"Phase 8: UI Enhancements" — Success criteria (3 items), pre-defined plan outlines for 08-01 and 08-02

### Established UI patterns
- `.planning/phases/05-react-ui/05-CONTEXT.md` — Inline styles with `var(--*)`, expanded card layout (stage list left + chunk table right), ChunkTable spec
- `.planning/phases/07-job-management/07-CONTEXT.md` — Queue/History tab, HistoryList, JobCard expansion behavior

No external ADRs — requirements fully captured above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/components/ChunkTable.tsx` — Passes column already exists with amber highlight for passes > 1; replace with mini progress bar; `vmafColor()` function already defined, reuse color logic
- `frontend/src/components/TopBar.tsx` — Controls row with Profiles/Settings buttons; add theme toggle button here
- `frontend/src/index.css` — All CSS custom properties (`--bg`, `--panel`, `--raised`, `--border`, `--txt`, etc.) already centralized; add `[data-theme="light"]` override block here
- `frontend/index.html` — Add inline `<script>` for flash-free theme init before React bundle

### Established Patterns
- **Inline styles with `var(--*)` everywhere** — theme changes must go through CSS custom properties, not Tailwind or hardcoded values
- **Individual Zustand selectors** — `useStore(s => s.field)`, never inline object selectors (React 19 + Zustand 5 re-render issue)
- **`import type { Foo }`** for all TypeScript interfaces (verbatimModuleSyntax)
- `vmafColor(v: number)` in ChunkTable.tsx: green ≥96, amber ≥93, red below — reuse this scale for convergence bar colors

### Integration Points
- `ChunkTable.tsx` — modify Passes column in place
- `TopBar.tsx` — add theme toggle button to controls row; wire `onToggleTheme` prop from App.tsx
- `frontend/index.html` — add flash-prevention inline script
- `frontend/src/index.css` — add `[data-theme="light"]` CSS variable overrides
- New `VmafChart.tsx` component — rendered inside `JobCard.tsx` below ChunkTable
- New `useTheme.ts` hook — manages `data-theme` attribute + localStorage sync

</code_context>

<specifics>
## Specific Ideas

- The VMAF target band should feel like a reference zone, not a hard boundary — semi-transparent fill (`#4080ff20`) over the chart area between vmaf_min and vmaf_max
- Dim mode light theme should feel like "night mode relaxed" not "full daylight" — the app is media software and users probably encode at night

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-ui-enhancements*
*Context gathered: 2026-03-17*
