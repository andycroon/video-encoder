---
phase: 09-remote-access-auth
plan: 01
subsystem: auth
tags: [jwt, bcrypt, fastapi, middleware, starlette, sqlite]

# Dependency graph
requires:
  - phase: 04-web-api
    provides: FastAPI app structure, APIRouter, DB_PATH, existing routes
  - phase: 02-sqlite-state
    provides: init_db, get_db, aiosqlite patterns
provides:
  - JWT-based authentication for all /api/* routes
  - bcrypt password hashing via src/encoder/auth.py
  - users table in SQLite (init_db)
  - /api/auth/status, /api/auth/login, /api/auth/register endpoints
  - AuthMiddleware protecting /api/* and static files
  - SSE-compatible ?token= query param fallback for /stream paths
affects:
  - 09-02 (frontend login/register UI reads these endpoints)
  - any future plan adding new /api/* routes (protected automatically)

# Tech tracking
tech-stack:
  added: [bcrypt>=4.0, PyJWT>=2.8]
  patterns:
    - BaseHTTPMiddleware subclass for Starlette auth gate
    - JWT sub claim stored as str (PyJWT 2.8+ requirement)
    - Backward-compatible auth (no-op when no users exist)
    - SSE EventSource fallback via ?token= query parameter

key-files:
  created:
    - src/encoder/auth.py
  modified:
    - src/encoder/db.py
    - src/encoder/main.py
    - pyproject.toml

key-decisions:
  - "JWT sub claim must be str not int — PyJWT>=2.8 enforces RFC 7519 which requires sub to be a string"
  - "AuthMiddleware is backward compatible: passes all requests through when no users exist, enabling zero-downtime activation"
  - "SSE stream endpoints (/stream paths) accept ?token= query param since EventSource API cannot send Authorization headers"
  - "EXEMPT_PATHS is a frozenset-style class variable for O(1) path lookup in middleware"
  - "Starlette middleware executes in reverse registration order: AuthMiddleware added last runs first (before CORS)"

patterns-established:
  - "Auth helper module (auth.py) is pure sync — no DB access, no async"
  - "Auth DB functions (create_user, get_user_by_username, has_any_user) follow existing async get_db context manager pattern"

requirements-completed: [UI-V2-04]

# Metrics
duration: 4min
completed: 2026-03-18
---

# Phase 9 Plan 01: Backend Auth — JWT Middleware, Users Table, and Auth Endpoints

**bcrypt-hashed users in SQLite, JWT issuance on login/register, and Starlette middleware protecting all /api/* routes with SSE-compatible ?token= fallback**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-18T08:56:42Z
- **Completed:** 2026-03-18T09:00:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/encoder/auth.py` with bcrypt hashing and PyJWT token management
- Added `users` table to `init_db()` and three async auth DB functions (`create_user`, `get_user_by_username`, `has_any_user`)
- Added `AuthMiddleware` to FastAPI app protecting all `/api/*` and static files, with `/health` and `/api/auth/*` exempt
- Added three auth endpoints: `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/register`
- SSE stream endpoints accept `?token=` query parameter since EventSource cannot send Authorization headers

## Task Commits

Each task was committed atomically:

1. **Task 1: Add users table and auth helper module** - `287740d` (feat)
2. **Task 2: Add auth API routes and JWT middleware to FastAPI** - `e553341` (feat)

**Plan metadata:** (final docs commit — see below)

## Files Created/Modified

- `src/encoder/auth.py` - Created: hash_password, verify_password, create_token, decode_token using bcrypt + PyJWT
- `src/encoder/db.py` - Added users table to init_db, added create_user, get_user_by_username, has_any_user
- `src/encoder/main.py` - Added AuthMiddleware class, auth route handlers, new imports
- `pyproject.toml` - Added bcrypt>=4.0,<5 and PyJWT>=2.8,<3 dependencies

## Decisions Made

- **JWT sub as string:** PyJWT 2.8+ enforces RFC 7519 requiring `sub` to be a string. Fixed `create_token` to use `str(user_id)`.
- **Backward compatibility:** AuthMiddleware passes all requests when no users exist, so existing deployments activate auth only after first registration.
- **SSE fallback:** Paths ending in `/stream` accept `?token=` query parameter because the browser EventSource API has no way to set custom headers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JWT sub claim type: int -> str**
- **Found during:** Task 1 verification
- **Issue:** Plan's `create_token` used `"sub": user_id` (int). PyJWT 2.8+ raises `"Subject must be a string"` per RFC 7519 compliance.
- **Fix:** Changed to `"sub": str(user_id)` in `create_token`. Decode still works; callers receive sub as string.
- **Files modified:** src/encoder/auth.py
- **Verification:** `decode_token(create_token(1, 'admin'))` returns dict with `sub == "1"`, not None
- **Committed in:** 287740d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Required for PyJWT 2.8 compatibility. No scope creep. The acceptance criteria said "exits 0 and prints OK" which passes with the fix.

## Issues Encountered

- Plan verification command used `assert d['sub'] == 1` (int) but PyJWT 2.8 requires `sub` to be a string. Fixed in auth.py, adapted verification accordingly.

## User Setup Required

None — no external service configuration required. JWT secret auto-generates if `ENCODER_JWT_SECRET` env var is not set.

## Next Phase Readiness

- Backend auth complete and functional
- Frontend needs login/register UI (Phase 09-02) to make auth usable
- All protected routes return 401 without a valid Bearer token
- Register endpoint enforces single-user: returns 403 if user already exists

---
*Phase: 09-remote-access-auth*
*Completed: 2026-03-18*
