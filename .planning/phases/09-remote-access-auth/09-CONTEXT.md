# Phase 9: Remote Access Auth - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add authentication to the web app so it can be safely exposed over a network. First-run shows an onboarding wizard to create credentials; subsequent visits show a login page. All API endpoints and static frontend files are protected. `/health` stays public. No env files — credentials stored in the existing SQLite database.

</domain>

<decisions>
## Implementation Decisions

### Credential storage
- Store username + bcrypt-hashed password in a new `users` table in the existing `encoder.db`
- No env files, no separate auth database, no plaintext passwords
- Single user model — one account, no roles or multi-user support

### First-run onboarding
- Backend checks at startup whether the `users` table has any rows
- Frontend checks a public endpoint (e.g. `GET /api/auth/status`) on load: returns `{ setup_required: true }` or `{ setup_required: false }`
- If `setup_required: true` → show full-screen onboarding wizard
- Onboarding wizard collects: username + password + confirm password (nothing else)
- Submitting onboarding creates the account, issues a JWT, and redirects to the main app

### Login page
- If `setup_required: false` and no valid JWT in localStorage → show full-screen login form
- Login form: username + password fields, submit button
- Successful login → backend returns a signed JWT → stored in localStorage → redirect to main app

### Session management
- JWT issued by backend on successful login/onboarding
- Frontend stores JWT in `localStorage`
- Every API request sends `Authorization: Bearer <token>`
- React API layer intercepts 401 responses and redirects to login (clears JWT from localStorage first)

### Protected endpoints
- All `/api/*` routes require valid JWT (except `/api/auth/*` — login and status endpoints are public)
- Static frontend files also protected — unauthenticated requests to `/` return 401
- `GET /health` stays public (exempted from auth middleware)
- CORS stays `allow_origins=["*"]` — no change

### README
- Brief section covering: first-run onboarding flow, how to log out, how to reset credentials if locked out (delete the users row from encoder.db via SQLite CLI or DB browser)

### Claude's Discretion
- JWT signing algorithm and expiry duration (HS256 with reasonable expiry, e.g. 30 days)
- Password validation rules (minimum length, etc.)
- Exact visual design of the login/onboarding forms (follow existing industrial aesthetic)
- Whether JWT expiry triggers a silent re-auth or a hard logout

</decisions>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above.

Phase requirement: `UI-V2-04` in `.planning/REQUIREMENTS.md` — "Optional basic-auth gate for remote access"

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/encoder/main.py` — FastAPI app, `CORSMiddleware` already registered, `api` router with `/api` prefix; add auth middleware here
- `src/encoder/db.py` — `init_db()` runs on startup; add `users` table creation here
- `frontend/src/store/` — Zustand store pattern established; add auth state slice (token, isAuthenticated)
- `frontend/src/api/` — existing API wrappers; add Authorization header injection and 401 interceptor
- `frontend/src/components/` — existing component patterns; new `LoginPage` and `OnboardingWizard` components follow established style

### Established Patterns
- Middleware: registered via `app.add_middleware()` in main.py before router inclusion
- DB access: `aiosqlite` with `async with aiosqlite.connect(db_path)` pattern throughout `db.py`
- Frontend routing: React app is a SPA; conditional rendering at root level controls which "page" shows (no react-router in use — check before adding a router dependency)
- Zustand: individual selectors only (`useStore(s => s.field)`) — never inline object selectors

### Integration Points
- `GET /health` lives outside the `/api` prefix in `main.py` — exemption is straightforward
- `/api/auth/status`, `/api/auth/login`, `/api/auth/register` are new routes — add to the `api` router before the auth middleware check
- Static file serving (`StaticFiles`) is mounted last — auth middleware must run before it to protect frontend files
- `init_db()` in `db.py` — add `CREATE TABLE IF NOT EXISTS users` migration here

</code_context>

<specifics>
## Specific Ideas

- User explicitly does not want credentials in `.env` files — must be database-only
- "If a user profile exists in the DB, present login page; if not, present onboarding" — this is the core routing logic
- Onboarding is a wizard feel, not just a form — though content is minimal (username + password)

</specifics>

<deferred>
## Deferred Ideas

- Multi-user support — out of scope (single user only per REQUIREMENTS.md)
- Password change / account settings UI — future phase if needed
- Secure HTTP-only cookie session — considered but deferred in favor of simpler JWT localStorage approach

</deferred>

---

*Phase: 09-remote-access-auth*
*Context gathered: 2026-03-18*
