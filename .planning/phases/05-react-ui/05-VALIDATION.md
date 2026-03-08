---
phase: 5
slug: react-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x + React Testing Library |
| **Config file** | `frontend/vite.config.ts` (vitest config inline) |
| **Quick run command** | `cd frontend && npm test -- --run` |
| **Full suite command** | `cd frontend && npm test -- --run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm test -- --run`
- **After every plan wave:** Run `cd frontend && npm test -- --run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green + manual README review
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 0 | QUEUE-01 | unit | `npm test -- --run src/components/TopBar.test.tsx` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 0 | QUEUE-02, QUEUE-04 | unit | `npm test -- --run src/components/JobRow.test.tsx` | ❌ W0 | ⬜ pending |
| 5-01-03 | 01 | 0 | QUEUE-03 | unit | `npm test -- --run src/components/CancelDialog.test.tsx` | ❌ W0 | ⬜ pending |
| 5-01-04 | 01 | 0 | PROG-01, PROG-02 | unit | `npm test -- --run src/hooks/useJobStream.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-05 | 01 | 0 | PROG-04 | unit | `npm test -- --run src/hooks/useEta.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-06 | 01 | 0 | PROG-02 | unit | `npm test -- --run src/components/ChunkTable.test.tsx` | ❌ W0 | ⬜ pending |
| 5-01-07 | 01 | 0 | PROG-03 | unit | `npm test -- --run src/components/LogPanel.test.tsx` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 1 | QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04 | unit | `cd frontend && npm test -- --run` | ✅ W0 | ⬜ pending |
| 5-03-01 | 03 | 2 | PROG-01, PROG-02, PROG-03, PROG-04 | unit | `cd frontend && npm test -- --run` | ✅ W0 | ⬜ pending |
| 5-04-01 | 04 | 3 | DOC-01 | manual | — | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/` directory — scaffold with `npm create vite@latest`
- [ ] `frontend/src/hooks/useJobStream.test.ts` — stubs for PROG-01, PROG-02
- [ ] `frontend/src/hooks/useEta.test.ts` — stubs for PROG-04
- [ ] `frontend/src/components/TopBar.test.tsx` — stubs for QUEUE-01
- [ ] `frontend/src/components/JobRow.test.tsx` — stubs for QUEUE-02, QUEUE-04
- [ ] `frontend/src/components/CancelDialog.test.tsx` — stubs for QUEUE-03
- [ ] `frontend/src/components/ChunkTable.test.tsx` — stubs for PROG-02
- [ ] `frontend/src/components/LogPanel.test.tsx` — stubs for PROG-03
- [ ] Vitest config: `test: { environment: 'jsdom' }` added to `vite.config.ts`
- [ ] Framework install: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README.md contains all required sections | DOC-01 | Content quality judgment | Open README.md, verify: getting-started walkthrough, UI feature overview, troubleshooting section, all prior phase sections accurate |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
