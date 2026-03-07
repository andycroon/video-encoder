---
phase: 2
slug: sqlite-state-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x (already installed, `pyproject.toml` dev dependency) |
| **Config file** | `pyproject.toml` — `[tool.pytest.ini_options]` section (existing) |
| **Quick run command** | `pytest tests/test_db.py -v` |
| **Full suite command** | `pytest tests/ -v` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/test_db.py -v`
- **After every plan wave:** Run `pytest tests/ -v`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-xx-01 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_job_survives_restart -x` | ❌ W0 | ⬜ pending |
| 2-xx-02 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_wal_mode_active -x` | ❌ W0 | ⬜ pending |
| 2-xx-03 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_stale_job_recovery -x` | ❌ W0 | ⬜ pending |
| 2-xx-04 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_chunk_crud -x` | ❌ W0 | ⬜ pending |
| 2-xx-05 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_step_crud -x` | ❌ W0 | ⬜ pending |
| 2-xx-06 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_log_append -x` | ❌ W0 | ⬜ pending |
| 2-xx-07 | TBD | 0 | QUEUE-05 | integration | `pytest tests/test_db.py::test_config_roundtrip -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_db.py` — stubs for all QUEUE-05 behaviors (job restart, WAL, stale recovery, chunk CRUD, step CRUD, log append, config round-trip)
- [ ] `src/encoder/db.py` — skeleton module (deliverable stub so tests can import)
- [ ] Add `aiosqlite>=0.22.1,<0.23` to `pyproject.toml` dependencies and install

*No missing test framework — pytest already present.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README.md documents DB file location, state persistence, reset instructions | QUEUE-05 | Documentation review, not automatable | Read README.md section; verify all three items present |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
