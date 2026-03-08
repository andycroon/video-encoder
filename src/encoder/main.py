"""FastAPI application for the video encoder web API."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from encoder.db import init_db, recover_stale_jobs, get_settings, put_settings

DB_PATH = os.environ.get("ENCODER_DB", "encoder.db")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(DB_PATH)
    await recover_stale_jobs(DB_PATH)
    yield


app = FastAPI(title="Video Encoder API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def health():
    return {"status": "ok"}


@app.get("/settings")
async def read_settings():
    return await get_settings(DB_PATH)


@app.put("/settings")
async def write_settings(body: dict):
    await put_settings(DB_PATH, body)
    return await get_settings(DB_PATH)
