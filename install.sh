#!/usr/bin/env bash
set -e

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

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
python3 -m venv "$INSTALL_DIR/venv"
source "$INSTALL_DIR/venv/bin/activate"

echo ">>> Installing Python dependencies..."
pip install -e .

# ── Frontend ───────────────────────────────────────────────────────────────
echo ">>> Building frontend..."
npm run build

chmod +x "$INSTALL_DIR/start.sh"

# ── Systemd service (Linux only) ───────────────────────────────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]] && command -v systemctl &>/dev/null; then
    echo ">>> Installing systemd service..."

    sudo tee /etc/systemd/system/video-encoder.service > /dev/null <<EOF
[Unit]
Description=VibeCoder Video Encoder
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/uvicorn encoder.main:app --host 0.0.0.0 --port 8765
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable video-encoder
    sudo systemctl restart video-encoder

    echo ""
    echo "✓ Installation complete. Service is running."
    echo ""
    echo "Manage the service:"
    echo "  sudo systemctl status video-encoder"
    echo "  sudo systemctl restart video-encoder"
    echo "  sudo systemctl stop video-encoder"
    echo "  journalctl -u video-encoder -f   (live logs)"
else
    echo ""
    echo "✓ Installation complete."
    echo ""
    echo "Start the server:  ./start.sh"
fi
