---
phase: 09-remote-access-auth
plan: 02
subsystem: auth
tags: [react, zustand, jwt, localStorage, sse, login, onboarding, typescript]

# Dependency graph
requires:
  - phase: 09-01
    provides: JWT auth endpoints (/api/auth/status, /api/auth/login, /api/auth/register), AuthMiddleware protecting /api/* routes, ?token= SSE fallback
  - phase: 05-react-ui
    provides: React 19 + TypeScript + Vite app, Zustand store pattern, existing API files (jobs.ts, settings.ts, profiles.ts, browse.ts), useJobStream.ts
provides:
  - Zustand authStore with JWT persistence to localStorage (vce_auth_token)
  - authFetch wrapper injecting Bearer token and auto-clearing on 401
  - LoginPage full-screen component (400px card, Sign In button, error display)
  - OnboardingWizard full-screen component (440px card, Create Account, 3-field form with validation)
  - App.tsx auth routing: OnboardingWizard | LoginPage | main app
  - SSE EventSource passing JWT via ?token= query parameter
  - README Authentication section with logout, reset, and disable instructions
affects:
  - any future plan adding new API calls (use authFetch, not fetch)
  - any future SSE stream (must pass ?token= if auth is active)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - authFetch wrapper pattern (injects Bearer, auto-clears token on 401)
    - Zustand auth store with localStorage persistence (no zustand-persist needed)
    - App-level auth routing via conditional render (no react-router)
    - SSE auth via ?token= query param (EventSource cannot send headers)
    - useAuthStore.getState() for imperative store access outside React render

key-files:
  created:
    - frontend/src/store/authStore.ts
    - frontend/src/api/auth.ts
    - frontend/src/api/authFetch.ts
    - frontend/src/components/LoginPage.tsx
    - frontend/src/components/OnboardingWizard.tsx
    - frontend/src/components/LoginPage.test.tsx
    - frontend/src/components/OnboardingWizard.test.tsx
  modified:
    - frontend/src/App.tsx
    - frontend/src/api/jobs.ts
    - frontend/src/api/settings.ts
    - frontend/src/api/profiles.ts
    - frontend/src/api/browse.ts
    - frontend/src/hooks/useJobStream.ts
    - README.md

key-decisions:
  - "authFetch uses useAuthStore.getState() (not hook) so it works outside React render cycle"
  - "OnboardingWizard calls setSetupRequired(false) before setToken so App re-renders to main app in correct order"
  - "Validation fires on submit, not on blur — simpler UX for a single-session setup screen"
  - "README logout uses localStorage.removeItem console snippet — no dedicated logout button needed for single-user app"

patterns-established:
  - "All API calls use authFetch (not fetch) — auto-injects Bearer token and handles 401"
  - "SSE streams append ?token= to EventSource URL — EventSource API cannot send Authorization headers"
  - "Zustand auth state uses individual selectors only — object selectors cause infinite re-renders (React 19 + Zustand 5)"

requirements-completed: [UI-V2-04]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 9 Plan 02: Frontend Auth Layer — LoginPage, OnboardingWizard, Auth Store, and API Token Injection

**Zustand JWT store with localStorage persistence, authFetch wrapper for all API calls, full-screen LoginPage and OnboardingWizard per UI-SPEC, App.tsx auth routing, and SSE ?token= query param**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-18T08:22:07Z
- **Completed:** 2026-03-18T08:25:25Z
- **Tasks:** 3 (+ 1 human-verify checkpoint)
- **Files modified:** 13

## Accomplishments

- Created `authStore.ts` with JWT persisted to `localStorage` under `vce_auth_token`, individual setters (`setToken`, `clearToken`, `setSetupRequired`)
- Created `authFetch.ts` wrapper injecting `Authorization: Bearer` header and auto-clearing token + throwing on 401
- Created `auth.ts` with `checkAuthStatus`, `login`, and `register` wrappers for all three backend auth endpoints
- Replaced `fetch()` with `authFetch()` in all four existing API files (jobs, settings, profiles, browse)
- Updated `useJobStream.ts` to append `?token=` to EventSource URL (SSE cannot send Authorization headers)
- Created `LoginPage.tsx` and `OnboardingWizard.tsx` following UI-SPEC exactly (card sizes, colors, labels, validation, interaction states)
- Updated `App.tsx` to check auth status on mount and route between OnboardingWizard / LoginPage / main app
- Added README Authentication section documenting setup, login, logout, credential reset, and disabling auth
- Created frontend tests for both new components; all 25 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Auth store, API wrappers, and 401 interceptor** - `fdfa9bd` (feat)
2. **Task 2: LoginPage, OnboardingWizard, and App.tsx auth routing** - `f8258a5` (feat)
3. **Task 3: README auth section and frontend tests** - `f8670a6` (feat)

**Plan metadata:** (final docs commit — see below)

## Files Created/Modified

- `frontend/src/store/authStore.ts` - Created: Zustand store, JWT in localStorage, token/isAuthenticated/setupRequired state
- `frontend/src/api/auth.ts` - Created: checkAuthStatus, login, register wrappers
- `frontend/src/api/authFetch.ts` - Created: fetch wrapper with Bearer header injection and 401 auto-clear
- `frontend/src/components/LoginPage.tsx` - Created: full-screen 400px card, username/password inputs, Sign In button, error display
- `frontend/src/components/OnboardingWizard.tsx` - Created: full-screen 440px card, 3-field form, client-side validation, Create Account button
- `frontend/src/components/LoginPage.test.tsx` - Created: 3 tests (renders, labels, disabled state)
- `frontend/src/components/OnboardingWizard.test.tsx` - Created: 3 tests (renders, heading, confirm label)
- `frontend/src/App.tsx` - Modified: auth routing on mount, OnboardingWizard/LoginPage/main app conditional render
- `frontend/src/api/jobs.ts` - Modified: all 8 fetch() calls replaced with authFetch()
- `frontend/src/api/settings.ts` - Modified: fetch() replaced with authFetch()
- `frontend/src/api/profiles.ts` - Modified: fetch() replaced with authFetch()
- `frontend/src/api/browse.ts` - Modified: fetch() replaced with authFetch()
- `frontend/src/hooks/useJobStream.ts` - Modified: ?token= query param on EventSource URL, token from authStore
- `README.md` - Modified: Added Authentication section

## Decisions Made

- `authFetch` uses `useAuthStore.getState()` (imperative access) not a React hook — enables use in async API wrappers outside React render cycle.
- `OnboardingWizard` calls `setSetupRequired(false)` before `setToken` so App.tsx re-renders to the main app via the `isAuthenticated` path, not the onboarding path.
- Validation fires on submit, not on blur — appropriate for a one-time setup screen.
- README logout is a console snippet rather than a dedicated button — single-user app, no persistent session management UI needed.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled clean, build passed, all 25 tests passed on first run.

## User Setup Required

None — no external service configuration required. Auth activates automatically after first account registration.

## Next Phase Readiness

- Complete auth UI flow ships after human verification (Task 4 checkpoint)
- Backend auth (Plan 01) + frontend auth (Plan 02) form the complete Phase 9 feature
- Any future plan adding API routes: backend routes are automatically protected by AuthMiddleware; frontend API calls must use `authFetch`

---
*Phase: 09-remote-access-auth*
*Completed: 2026-03-18*
