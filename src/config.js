import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const __dir = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dir, '..', 'config.json');

let raw;
try {
  raw = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('Cannot read config.json — copy config.example.json and fill in values');
  process.exit(1);
}

// Two supported shapes:
//   1. Multi-host (preferred):  { common, host_aliases, hosts: { <key>: {...} } }
//   2. Single-host (legacy):    { hostname, priority, wireguard_ip, ... }
const isMultiHost = raw.hosts && typeof raw.hosts === 'object';

function resolveHostKey() {
  const sys = os.hostname();
  const candidates = [
    process.env.MCP_HOST,
    raw.host_aliases?.[sys],
    raw.host_aliases?.[sys.replace(/\.local$/, '')],
    sys,
    sys.replace(/\.local$/, ''),
  ].filter(Boolean);
  for (const c of candidates) {
    if (raw.hosts?.[c]) return c;
  }
  console.error(`No matching host block in config.hosts for ${sys}.`);
  console.error(`Set MCP_HOST or add an entry to config.host_aliases.`);
  process.exit(1);
}

const hostKey   = isMultiHost ? resolveHostKey() : (raw.hostname ?? os.hostname());
const hostBlock = isMultiHost ? raw.hosts[hostKey] : raw;
const common    = isMultiHost ? (raw.common ?? {}) : {};

export const config = {
  hostname:     hostKey,
  priority:     hostBlock.priority     ?? 5,
  port:         hostBlock.port         ?? common.port ?? 3456,
  wireguard_ip: hostBlock.wireguard_ip ?? '0.0.0.0',
  // Address to bind the listener to. Empty by default; index.js then falls back
  // to wireguard_ip (a specific interface) and finally loopback. Set this
  // explicitly to "0.0.0.0" only for a host whose wireguard_ip is a VPN tunnel
  // that may not exist at boot (binding a missing address crashes the listen
  // with EADDRNOTAVAIL) — and only with an api_key set, or startup is refused.
  bind:         hostBlock.bind         ?? common.bind ?? '',
  api_key:      hostBlock.api_key      ?? common.api_key ?? process.env.MCP_API_KEY ?? '',
  tls: {
    cert: hostBlock.tls?.cert ?? common.tls?.cert ?? process.env.SSL_CERTFILE ?? '',
    key:  hostBlock.tls?.key  ?? common.tls?.key  ?? process.env.SSL_KEYFILE  ?? '',
  },
  shell:    hostBlock.shell    ?? common.shell    ?? { enabled: false, allowlist: [] },
  messages: hostBlock.messages ?? common.messages ?? { send_enabled: false },
  spotify:  hostBlock.spotify  ?? common.spotify  ?? { enabled: false },
  plex:     hostBlock.plex     ?? common.plex     ?? { enabled: false },
};

export default config;
