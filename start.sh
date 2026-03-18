#!/usr/bin/env bash
set -e

if [ ! -f "venv/bin/activate" ]; then
    echo "Virtual environment not found. Run ./install.sh first."
    exit 1
fi

source venv/bin/activate
exec uvicorn encoder.main:app "$@"
