# mac-mcp — NonaTech Mac MCP Server

Apple data and local Mac facilities exposed as an MCP server over WireGuard,
consumed by the NAS gateway at `query.mees.st`.

## Installed tools (common to both Macs)

| Module       | Tools |
|---|---|
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

## Prerequisites

```bash
brew install node          # Node ≥ 20
cd ~/Code/mac-mcp
npm install
```

## Setup

```bash
cp config.example.json config.json
# Edit config.json — hostname, priority, WG IP, Spotify/Plex credentials
```

### Spotify OAuth (one-time)

1. Create app at https://developer.spotify.com/dashboard
2. Add Redirect URI: `http://localhost:8765/callback`
3. Paste Client ID + Secret into config.json
4. `node scripts/spotify_auth.js`
5. Paste refresh_token into config.json

### Plex token

Sign in at plex.tv, open DevTools → Network, filter for requests to your server,
look for `X-Plex-Token` in any request's query string.

## Privacy permissions required (System Settings → Privacy & Security)

| Permission          | Required for |
|---|---|
| Reminders           | Reminders tools |
| Calendars           | Calendar tools |
| Contacts            | Contacts tools |
| Full Disk Access    | Messages (reads chat.db) |
| Automation → Messages | messages_send (if enabled) |
| Automation → Safari | browser_* tools |

Grant these to **Terminal** (or whichever terminal you use to launch the server)
and they'll be inherited by the node process. After installing the launchd agent
you may need to grant them to the node binary itself.

## Install as launchd service

```bash
# Studio
cp launchd/com.nonatech.mac-mcp.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nonatech.mac-mcp.plist

# Logs
tail -f /tmp/mac-mcp.log
tail -f /tmp/mac-mcp-error.log
```

For the Notebook: copy the project, set `"hostname": "mac-notebook"` and
`"priority": 5` in config.json (Studio is 10).

## WireGuard addressing

Assign static WG IPs, e.g.:
```
mac-studio.wg   = 10.10.0.3
mac-notebook.wg = 10.10.0.4
```

Update the `wireguard_ip` in each config.json accordingly.
The server binds to that address so only WireGuard-connected peers can reach it.

## Gateway integration

Add both Macs as upstream MCP endpoints in the NAS gateway config:

```yaml
upstreams:
  - name: mac-studio
    url:  http://10.10.0.3:3456/sse
    health_url: http://10.10.0.3:3456/health
    priority_field: priority       # parsed from health response
    poll_interval_s: 30

  - name: mac-notebook
    url:  http://10.10.0.4:3456/sse
    health_url: http://10.10.0.4:3456/health
    priority_field: priority
    poll_interval_s: 30
```

The gateway should route all Apple/mac tool calls to the highest-priority
reachable host. Both expose identical tool names; the gateway's routing layer
picks the winner. When only one is up it falls through automatically.

## Cross-device clipboard sharing

Since both Macs expose `clipboard_get` and `clipboard_set`, Claude can broker
clipboard content across any gateway-connected device:

```
"Push Studio clipboard to my notebook"
→ clipboard_get (mac-studio) → clipboard_set (mac-notebook)

"Share this to all Macs"
→ clipboard_set (mac-studio) + clipboard_set (mac-notebook)
```

## PIF / Spotify integration idea

Your scrobble DB has 48k+ plays. A PIF query for top tracks this month returns
Spotify URIs → feed them as `seed_track_uris` to `spotify_get_recommendations`
→ pipe the result into `spotify_create_playlist` → `spotify_play` with the
playlist URI. Full end-to-end contextual playlist generation from listening
history without touching the Spotify UI.
