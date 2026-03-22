#!/usr/bin/env bash
set -e

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ">>> Pulling latest changes..."
git -C "$INSTALL_DIR" pull

echo ">>> Rebuilding frontend..."
npm run build --prefix "$INSTALL_DIR/frontend"

if command -v systemctl &>/dev/null && systemctl is-active --quiet video-encoder; then
    echo ">>> Restarting service..."
    sudo systemctl restart video-encoder
    echo ""
    echo "✓ Update complete. Service restarted."
    echo "  journalctl -u video-encoder -f   (live logs)"
else
    echo ""
    echo "✓ Update complete. Restart the server manually: ./start.sh"
fi
