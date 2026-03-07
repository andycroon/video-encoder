---
phase: 1
slug: subprocess-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8.0,<9 + pytest-timeout >=2.3 |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` — Wave 0 creates this |
| **Quick run command** | `pytest tests/test_ffmpeg.py -x` |
| **Full suite command** | `pytest tests/ -v` |
| **Estimated runtime** | ~20 seconds (3s lavfi encode + 1s cancel test + unit tests) |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/test_ffmpeg.py -x`
- **After every plan wave:** Run `pytest tests/ -v`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | PIPE-10 | infra | `pytest --collect-only` | Wave 0 | pending |
| 1-01-02 | 01 | 1 | PIPE-10 | integration | `pytest tests/test_ffmpeg.py::test_progress_events_emitted -x` | Wave 0 | pending |
| 1-01-03 | 01 | 1 | PIPE-10 | integration | `pytest tests/test_ffmpeg.py::test_cancel_graceful -x` | Wave 0 | pending |
| 1-01-04 | 01 | 1 | PIPE-10 | integration | `pytest tests/test_ffmpeg.py::test_error_on_bad_command -x` | Wave 0 | pending |
| 1-01-05 | 01 | 1 | PIPE-10 | unit | `pytest tests/test_ffmpeg.py::test_escape_vmaf_path_windows -x` | Wave 0 | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `pyproject.toml` — project config, pytest config (`testpaths = ["tests"]`), src-layout package discovery
- [ ] `src/encoder/__init__.py` — empty, marks encoder as installable package
- [ ] `tests/__init__.py` — empty, marks tests as package
- [ ] `tests/test_ffmpeg.py` — stub tests for all four behaviors (PIPE-10 coverage)
- [ ] Framework install: `pip install pytest pytest-timeout` (or added to dev dependencies)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README.md exists with prerequisites | SC-5 | Content review required | Open README.md, verify: Python version, ffmpeg install path, scenedetect install, VMAF assets/ setup, how to run the app |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
