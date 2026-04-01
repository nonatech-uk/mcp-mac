# mcp-mac

Node.js MCP server exposing Apple data and local Mac facilities over WireGuard.
Consumed by the NAS gateway at `query.mees.st`.

## Repo layout

- `src/index.js` — entry point, HTTP server + MCP transport
- `src/tools/` — one file per tool module (reminders, calendar, contacts, etc.)
- `src/utils/` — shared helpers
- `scripts/` — EventKit Swift sources, build script, deploy script, Spotify auth
- `launchd/` — launchd plist template
- `config.json` — runtime config (not in git, see `config.example.json`)

## Development vs production

- **Dev**: `~/Code/mcp-mac` — edit here, use `npm run dev` for auto-reload
- **Production**: `/opt/mcp-mac` — deployed via `scripts/deploy.sh`
- **Service**: launchd agent `com.nonatech.mac-mcp` runs from `/opt/mcp-mac`
- **Logs**: `/opt/mcp-mac/logs/mcp-mac.log` and `mcp-mac-error.log`

## Key conventions

- EventKit binaries (`calendar-ek`, `contacts-ek`, `reminders-ek`) are compiled per-machine — never commit them
- `config.json` contains secrets — never commit it
- The server binds to a WireGuard IP, not localhost
- All tool calls require a Bearer token matching `config.json`'s `api_key`
