#!/usr/bin/env bash
set -e

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
# Capture the real user even when the script is invoked via sudo
REAL_USER="${SUDO_USER:-$(whoami)}"

cd "$INSTALL_DIR"

# ── Stop running service if present ────────────────────────────────────────
if command -v systemctl &>/dev/null && systemctl is-active --quiet video-encoder 2>/dev/null; then
    echo ">>> Stopping running service..."
    sudo systemctl stop video-encoder
fi

# ── Detect OS and install system dependencies ──────────────────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if ! command -v apt &>/dev/null; then
        echo "Non-Debian Linux detected. Install python3-full, python3-pip, nodejs, npm, and ffmpeg (with libvmaf) manually, then re-run this script."
        exit 1
    fi

    # Python, Tesseract, and OpenCV runtime deps — install only what's missing
    MISSING_PKGS=()
    for pkg in python3-full python3-pip tesseract-ocr libgl1 libglib2.0-0; do
        dpkg -s "$pkg" &>/dev/null || MISSING_PKGS+=("$pkg")
    done
    if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
        echo ">>> Installing missing system packages: ${MISSING_PKGS[*]}..."
        sudo apt update -q
        sudo apt install -y "${MISSING_PKGS[@]}"
    else
        echo ">>> Python/Tesseract packages already installed, skipping."
    fi

    # Node.js — apt ships old versions; require v20+ (Vite 6 constraint)
    NODE_UPGRADED=false
    NODE_COMPAT=false
    if command -v node &>/dev/null; then
        NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
        [ "$NODE_MAJOR" -ge 20 ] && NODE_COMPAT=true
    fi
    if [ "$NODE_COMPAT" = false ]; then
        echo ">>> Installing Node.js 22 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt install -y nodejs
        NODE_UPGRADED=true
        echo ">>> Node.js $(node --version) installed."
    else
        echo ">>> Node.js $(node --version) already compatible, skipping."
    fi
    # Wipe frontend node_modules if Node was just installed/upgraded to avoid
    # stale native bindings (e.g. @tailwindcss/oxide compiled for wrong version)
    if [ "$NODE_UPGRADED" = true ]; then
        rm -rf "$INSTALL_DIR/frontend/node_modules"
    fi

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
    MISSING_PKGS=()
    for pkg in python ffmpeg tesseract; do
        brew list "$pkg" &>/dev/null || MISSING_PKGS+=("$pkg")
    done
    # Node.js — check version, not just presence (need v20+ for Vite 6)
    NODE_UPGRADED=false
    NODE_COMPAT=false
    if command -v node &>/dev/null; then
        NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
        [ "$NODE_MAJOR" -ge 20 ] && NODE_COMPAT=true
    fi
    [ "$NODE_COMPAT" = false ] && MISSING_PKGS+=("node")
    if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
        echo ">>> Installing missing packages via Homebrew: ${MISSING_PKGS[*]}..."
        brew install "${MISSING_PKGS[@]}"
        # If node was in the list, wipe stale node_modules
        [[ " ${MISSING_PKGS[*]} " == *" node "* ]] && { rm -rf "$INSTALL_DIR/frontend/node_modules"; NODE_UPGRADED=true; }
    else
        echo ">>> Homebrew packages already installed, skipping."
    fi
fi

# ── Python virtual environment ─────────────────────────────────────────────
echo ">>> Creating Python virtual environment..."
python3 -m venv --clear "$INSTALL_DIR/venv"
source "$INSTALL_DIR/venv/bin/activate"

echo ">>> Installing Python dependencies..."
# Use headless OpenCV — the full build requires libGL which isn't present on servers
pip uninstall -y opencv-python 2>/dev/null || true
pip install -q opencv-python-headless
pip install -e .

# ── Data directories ────────────────────────────────────────────────────────
echo ">>> Creating data directories..."
mkdir -p "$INSTALL_DIR/output" "$INSTALL_DIR/temp"

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
User=$REAL_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/uvicorn encoder.main:app --host 0.0.0.0 --port 8765
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    # Ensure the install dir and data dirs are owned by the service user
    # (matters when install was run with sudo)
    sudo chown -R "$REAL_USER:$REAL_USER" "$INSTALL_DIR"

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
