"""
Tests for settings table in db.py: get_settings and put_settings functions.
"""
from __future__ import annotations

import asyncio
import os
import tempfile

import pytest

from encoder.db import init_db, get_settings, put_settings


@pytest.fixture
def db_path(tmp_path):
    """Return a temp path for an in-memory-like SQLite file per test."""
    return str(tmp_path / "test_settings.db")


def run(coro):
    """Helper to run a coroutine in a synchronous test."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Test 1: get_settings() returns all nine defaults after init_db()
# ---------------------------------------------------------------------------

def test_get_settings_defaults(db_path):
    """After init_db(), get_settings returns all nine keys with correct default values."""
    run(init_db(db_path))
    settings = run(get_settings(db_path))

    assert settings["vmaf_min"] == pytest.approx(96.2)
    assert settings["vmaf_max"] == pytest.approx(97.6)
    assert settings["crf_min"] == 16
    assert settings["crf_max"] == 20
    assert settings["crf_start"] == 17
    assert settings["audio_codec"] == "eac3"
    assert settings["output_path"] == ""
    assert settings["temp_path"] == ""
    assert settings["watch_folder_path"] == ""


# ---------------------------------------------------------------------------
# Test 2: put_settings() updates specific keys; other keys unchanged
# ---------------------------------------------------------------------------

def test_put_settings_partial_update(db_path):
    """put_settings with partial dict updates only those keys; others stay at defaults."""
    run(init_db(db_path))
    run(put_settings(db_path, {"vmaf_min": 94.0, "watch_folder_path": "/videos"}))
    settings = run(get_settings(db_path))

    assert settings["vmaf_min"] == pytest.approx(94.0)
    assert settings["watch_folder_path"] == "/videos"
    # Untouched defaults
    assert settings["vmaf_max"] == pytest.approx(97.6)
    assert settings["crf_min"] == 16
    assert settings["crf_max"] == 20
    assert settings["crf_start"] == 17
    assert settings["audio_codec"] == "eac3"
    assert settings["output_path"] == ""
    assert settings["temp_path"] == ""


# ---------------------------------------------------------------------------
# Test 3: Persistence — values survive connection close + reopen
# ---------------------------------------------------------------------------

def test_put_settings_persists(db_path):
    """put_settings writes to SQLite so values survive closing and reopening the connection."""
    run(init_db(db_path))
    run(put_settings(db_path, {"vmaf_min": 90.0, "crf_start": 18}))

    # Open a fresh connection by calling get_settings again (each call opens its own connection)
    settings = run(get_settings(db_path))

    assert settings["vmaf_min"] == pytest.approx(90.0)
    assert settings["crf_start"] == 18


# ---------------------------------------------------------------------------
# Test 4: Unknown keys in put_settings are silently ignored
# ---------------------------------------------------------------------------

def test_put_settings_ignores_unknown_keys(db_path):
    """put_settings with unknown keys silently ignores them; known keys still updated."""
    run(init_db(db_path))
    # Mix of valid and invalid keys
    run(put_settings(db_path, {
        "vmaf_min": 93.5,
        "unknown_key": "should_be_ignored",
        "another_bad_key": 42,
    }))
    settings = run(get_settings(db_path))

    assert settings["vmaf_min"] == pytest.approx(93.5)
    # Unknown key should not appear in returned settings
    assert "unknown_key" not in settings
    assert "another_bad_key" not in settings
    # Other defaults still intact
    assert settings["vmaf_max"] == pytest.approx(97.6)
