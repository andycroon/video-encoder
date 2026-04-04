#!/usr/bin/env bash
set -e

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Pull ───────────────────────────────────────────────────────────────────────
echo ">>> Pulling latest changes..."
git -C "$INSTALL_DIR" pull

# ── System dependencies (install any that are missing) ────────────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]] && command -v apt &>/dev/null; then
    MISSING_PKGS=()
    for pkg in python3-full python3-pip tesseract-ocr libgl1 libglib2.0-0; do
        dpkg -s "$pkg" &>/dev/null || MISSING_PKGS+=("$pkg")
    done
    if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
        echo ">>> Installing missing system packages: ${MISSING_PKGS[*]}..."
        sudo apt update -q
        sudo apt install -y "${MISSING_PKGS[@]}"
    fi
fi

# ── Python venv ────────────────────────────────────────────────────────────────
# Recreate venv if Python version changed or venv is broken
VENV="$INSTALL_DIR/venv"
VENV_OK=false
if [ -f "$VENV/bin/python" ]; then
    VENV_PY="$("$VENV/bin/python" --version 2>&1)"
    SYS_PY="$(python3 --version 2>&1)"
    if [ "$VENV_PY" = "$SYS_PY" ] && "$VENV/bin/python" -c "import pip" 2>/dev/null; then
        VENV_OK=true
    fi
fi

if [ "$VENV_OK" = false ]; then
    echo ">>> Recreating Python virtual environment..."
    rm -rf "$VENV"
    python3 -m venv "$VENV"
fi

echo ">>> Installing Python dependencies..."
source "$VENV/bin/activate"
# Install headless OpenCV before other deps so pgsrip/scenedetect don't
# pull in opencv-python (which requires libGL, unavailable on headless servers)
pip install -q opencv-python-headless
pip install -e "$INSTALL_DIR" -q

# ── Frontend ───────────────────────────────────────────────────────────────────
echo ">>> Installing frontend dependencies..."
npm install --prefix "$INSTALL_DIR/frontend" --silent

echo ">>> Building frontend..."
npm run build --prefix "$INSTALL_DIR/frontend"

# ── Service ────────────────────────────────────────────────────────────────────
if command -v systemctl &>/dev/null; then
    if systemctl is-enabled --quiet video-encoder 2>/dev/null; then
        echo ">>> Restarting service..."
        sudo systemctl restart video-encoder

        # Wait up to 10s for it to come up
        for i in $(seq 1 10); do
            sleep 1
            if systemctl is-active --quiet video-encoder; then
                echo ""
                echo "✓ Update complete. Service is running."
                echo "  http://localhost:8765"
                echo "  journalctl -u video-encoder -f   (live logs)"
                exit 0
            fi
        done

        echo ""
        echo "✗ Service failed to start. Check logs:"
        echo "  journalctl -u video-encoder -n 30 --no-pager"
        exit 1
    else
        echo ">>> Service not registered. Re-running install to register it..."
        bash "$INSTALL_DIR/install.sh"
    fi
else
    echo ""
    echo "✓ Update complete. Restart the server: ./start.sh"
fi
