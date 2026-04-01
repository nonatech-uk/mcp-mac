#!/usr/bin/env bash
set -euo pipefail

SRC="$HOME/Code/mcp-mac"
DEST="/opt/mcp-mac"
PLIST_LABEL="com.nonatech.mac-mcp"
PLIST="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "==> Stopping service..."
launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

echo "==> Syncing files to ${DEST}..."
rsync -a --delete \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='plan' \
  --exclude='node_modules' \
  --exclude='tls' \
  --exclude='config.json' \
  "$SRC/" "$DEST/"

echo "==> Installing dependencies..."
cd "$DEST" && npm install --production --silent

echo "==> Copying launchd plist..."
cp "$DEST/launchd/${PLIST_LABEL}.plist" "$PLIST"

echo "==> Starting service..."
launchctl bootstrap "gui/$(id -u)" "$PLIST"

sleep 2
PID=$(launchctl print "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null | grep -o 'pid = [0-9]*' | grep -o '[0-9]*') || true
if [ -n "$PID" ]; then
  echo "==> Service running (PID ${PID})"
else
  echo "==> WARNING: Service may not have started. Check logs:"
  echo "    tail -f ${DEST}/logs/mcp-mac-error.log"
fi
