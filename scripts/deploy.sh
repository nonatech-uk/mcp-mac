#!/usr/bin/env bash
set -euo pipefail

SRC="$HOME/Code/mcp-mac"
DEST="/opt/mcp-mac"
PLIST_LABEL="com.nonatech.mac-mcp"
PLIST="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
HOST_FILE="${DEST}/.host"

# Resolve this Mac's logical host key (mac-studio / mac-notebook).
# Priority: CLI arg → persisted ${HOST_FILE} → fail with usage.
# Persisting to /opt makes it per-Mac (rsync-excluded below) and survives
# macOS hostname rewrites (DHCP/Bonjour) that would otherwise break startup.
HOST_KEY="${1:-}"
if [ -z "$HOST_KEY" ] && [ -f "$HOST_FILE" ]; then
  HOST_KEY="$(tr -d '[:space:]' < "$HOST_FILE")"
fi
if [ -z "$HOST_KEY" ]; then
  echo "ERROR: host key required on first run."
  echo "Usage: $0 <host-key>     (e.g. mac-studio | mac-notebook)"
  echo "Saved to ${HOST_FILE}; subsequent runs need no argument."
  exit 1
fi
echo "==> Host key: ${HOST_KEY}"

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
  --exclude='.host' \
  "$SRC/" "$DEST/"

# Persist host key for future deploys (after rsync, so it isn't deleted).
echo "$HOST_KEY" > "$HOST_FILE"

echo "==> Installing dependencies..."
cd "$DEST" && npm install --production --silent

echo "==> Installing launchd plist (MCP_HOST=${HOST_KEY})..."
sed "s/__MCP_HOST__/${HOST_KEY}/" "$DEST/launchd/${PLIST_LABEL}.plist" > "$PLIST"

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
