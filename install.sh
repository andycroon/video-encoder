#!/usr/bin/env bash
set -e

# ── Detect OS and install system dependencies ──────────────────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if ! command -v apt &>/dev/null; then
        echo "Non-Debian Linux detected. Install python3-full, python3-pip, nodejs, npm, and ffmpeg (with libvmaf) manually, then re-run this script."
        exit 1
    fi

    echo ">>> Installing system packages..."
    sudo apt update -q
    sudo apt install -y python3-full python3-pip nodejs npm

    if ! ffmpeg -version 2>/dev/null | grep -q "enable-libvmaf"; then
        echo ">>> Installing ffmpeg with libvmaf support..."
        sudo apt remove --purge -y ffmpeg 2>/dev/null || true
        TMP=$(mktemp -d)
        wget -q -O "$TMP/ffmpeg.tar.xz" \
            "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz"
        tar -xf "$TMP/ffmpeg.tar.xz" -C "$TMP"
        sudo mv "$TMP"/ffmpeg-*/bin/ffmpeg /usr/local/bin/
        sudo mv "$TMP"/ffmpeg-*/bin/ffprobe /usr/local/bin/
        rm -rf "$TMP"
        hash -r
        echo ">>> ffmpeg installed."
    else
        echo ">>> ffmpeg with libvmaf already present, skipping."
    fi

elif [[ "$OSTYPE" == "darwin"* ]]; then
    if ! command -v brew &>/dev/null; then
        echo "Homebrew not found. Install it from https://brew.sh then re-run this script."
        exit 1
    fi
    echo ">>> Installing dependencies via Homebrew..."
    brew install python node ffmpeg
fi

# ── Python virtual environment ─────────────────────────────────────────────
echo ">>> Creating Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo ">>> Installing Python dependencies..."
pip install .

# ── Frontend ───────────────────────────────────────────────────────────────
echo ">>> Building frontend..."
npm run build

chmod +x start.sh

echo ""
echo "✓ Installation complete."
echo ""
echo "Start the server:  ./start.sh"
echo "Remote access:     ./start.sh --host 0.0.0.0"
