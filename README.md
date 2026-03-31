# mac-mcp — NonaTech Mac MCP Server

Apple data and local Mac facilities exposed as an MCP server over WireGuard,
consumed by the NAS gateway at `query.mees.st`.

## Quick start (new Mac)

```bash
# 1. Clone and install
cd ~/Code
git clone <repo-url> mac-mcp
cd mac-mcp
brew install node          # Node >= 20
npm install

# 2. Build the EventKit binaries
scripts/build-ek.sh

# 3. Grant macOS privacy permissions (see section below)

# 4. Configure
cp config.example.json config.json
# Edit config.json — hostname, priority, WG IP, api_key, Spotify/Plex creds

# 5. Run
npm start                  # foreground
npm run dev                # foreground with auto-reload
```

## Building the EventKit binaries

Calendar, Contacts, and Reminders use native Swift binaries that talk to
EventKit directly (replacing the old AppleScript approach). These must be
compiled on the target Mac:

```bash
scripts/build-ek.sh
```

This compiles three binaries into `scripts/`:

| Binary          | Swift source             | Used by         |
|-----------------|--------------------------|-----------------|
| `calendar-ek`   | `scripts/calendar-ek.swift`  | Calendar tools  |
| `contacts-ek`   | `scripts/contacts-ek.swift`  | Contacts tools  |
| `reminders-ek`  | `scripts/reminders-ek.swift` | Reminders tools |

The binaries are not checked into git — they must be built per-machine since
macOS TCC (privacy) permissions are tied to code signatures.

## Privacy permissions (System Settings > Privacy & Security)

The EventKit binaries need macOS permission grants. The easiest way is to
**run each binary once from your terminal** — macOS will show a permission
dialog for each:

```bash
scripts/calendar-ek  list-calendars      # triggers Calendars permission
scripts/reminders-ek list-lists           # triggers Reminders permission
scripts/contacts-ek  search --query test  # triggers Contacts permission
```

Approve each dialog. The permission is then inherited when the node server
spawns these binaries, **provided the server runs under the same user**.

If running via launchd, you may need to grant permissions to the **node
binary** itself. Check System Settings > Privacy & Security > Calendars /
Reminders / Contacts and add `/opt/homebrew/bin/node` (or wherever node is).

### Full permission list

| Permission          | Required for |
|---------------------|--------------|
| Calendars           | Calendar tools |
| Reminders           | Reminders tools |
| Contacts            | Contacts tools |
| Full Disk Access    | Messages (reads ~/Library/Messages/chat.db) |
| Automation > Messages | messages_send (if enabled) |
| Automation > Safari | browser_* tools |

## Installed tools

| Module       | Tools |
|--------------|-------|
| Reminders    | list_lists, get, create, complete, delete |
| Calendar     | list_calendars, get_events, create_event, update_event, delete_event, get_availability |
| Contacts     | search, get |
| Messages     | get_conversations, get_thread, search, [send — disabled by default] |
| Notes        | list, get, create, search |
| Shell        | run (allowlist-gated, see config.json) |
| Clipboard    | get, set |
| Notifications| notify |
| System       | status, processes |
| Spotify      | status, search, play, pause, skip, queue, get_devices, get_recommendations, create_playlist |
| Plex         | libraries, search, get_sessions, get_clients |
| Browser      | get_current_tab, get_tabs, open_url, get_page_text |

## Config

```bash
cp config.example.json config.json
```

Key fields:

| Field | Purpose |
|-------|---------|
| `hostname` | Identifies this Mac to the gateway (e.g. `mac-studio`, `mac-notebook`) |
| `priority` | Gateway routes to the highest-priority reachable host (Studio=10, Notebook=5) |
| `port` | HTTP listen port (default 3456) |
| `wireguard_ip` | Bind address — only WG peers can reach the server |
| `api_key` | Bearer token the gateway must present |

### Spotify OAuth (one-time)

1. Create app at https://developer.spotify.com/dashboard
2. Add Redirect URI: `http://localhost:8765/callback`
3. Paste Client ID + Secret into config.json
4. `node scripts/spotify_auth.js`
5. Paste refresh_token into config.json

### Plex token

Sign in at plex.tv, open DevTools > Network, filter for requests to your
server, look for `X-Plex-Token` in any request's query string.

## Install as launchd service

```bash
# Copy and edit the plist — update paths for your username and node location
cp launchd/com.nonatech.mac-mcp.plist ~/Library/LaunchAgents/

# Edit ~/Library/LaunchAgents/com.nonatech.mac-mcp.plist:
#   - ProgramArguments: path to node and src/index.js
#   - WorkingDirectory: path to mac-mcp
#   - HOME env var: your home directory

launchctl load ~/Library/LaunchAgents/com.nonatech.mac-mcp.plist

# Logs
tail -f /tmp/mac-mcp.log
tail -f /tmp/mac-mcp-error.log

# Reload after changes
launchctl unload ~/Library/LaunchAgents/com.nonatech.mac-mcp.plist
launchctl load   ~/Library/LaunchAgents/com.nonatech.mac-mcp.plist
```

## WireGuard addressing

Assign static WG IPs, e.g.:
```
mac-studio.wg   = 10.10.0.3
mac-notebook.wg = 10.10.0.4
```

Update the `wireguard_ip` in each config.json accordingly.

## Gateway integration

Add each Mac as an upstream MCP endpoint in the NAS gateway config:

```yaml
upstreams:
  - name: mac-studio
    url:  http://10.10.0.3:3456/mcp
    health_url: http://10.10.0.3:3456/health
    priority_field: priority
    poll_interval_s: 30

  - name: mac-notebook
    url:  http://10.10.0.4:3456/mcp
    health_url: http://10.10.0.4:3456/health
    priority_field: priority
    poll_interval_s: 30
```

The gateway routes all Apple/Mac tool calls to the highest-priority reachable
host. Both expose identical tool names; when only one is up it falls through
automatically.

## Troubleshooting

### EventKit binaries return "Calendar access denied"

TCC permissions are tied to code signatures. After recompiling, the old
permission grant is invalidated. Fix:

1. Delete the stale TCC entry:
   ```bash
   tccutil reset Calendar   # or Reminders, or Contacts
   ```
2. Re-run the binary from Terminal to trigger a fresh permission dialog:
   ```bash
   scripts/calendar-ek list-calendars
   ```
3. Approve the dialog.

### launchd service can't access Calendar/Reminders/Contacts

The launchd agent runs under your user but may not inherit Terminal's TCC
grants. Go to System Settings > Privacy & Security and add the **node
binary** (e.g. `/opt/homebrew/bin/node`) to Calendars, Reminders, and
Contacts.
