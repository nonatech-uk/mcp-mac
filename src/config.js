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

export const config = {
  hostname:     raw.hostname     ?? os.hostname(),
  priority:     raw.priority     ?? 5,
  port:         raw.port         ?? 3456,
  wireguard_ip: raw.wireguard_ip ?? '0.0.0.0',
  api_key:      raw.api_key      ?? process.env.MCP_API_KEY ?? '',
  tls: {
    cert: raw.tls?.cert ?? process.env.SSL_CERTFILE ?? '',
    key:  raw.tls?.key  ?? process.env.SSL_KEYFILE  ?? '',
  },
  shell:       raw.shell      ?? { enabled: false, allowlist: [] },
  messages:    raw.messages   ?? { send_enabled: false },
  spotify:     raw.spotify    ?? { enabled: false },
  plex:        raw.plex       ?? { enabled: false },
};

export default config;
