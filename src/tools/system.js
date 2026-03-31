import { osa, escAS } from '../utils/osascript.js';
import { spawnSync } from 'child_process';
import os from 'os';

export const notificationTools = [
  {
    name: 'notify',
    description: 'Send a macOS desktop notification to this Mac',
    inputSchema: {
      type: 'object',
      required: ['title', 'message'],
      properties: {
        title:    { type: 'string', description: 'Notification title' },
        message:  { type: 'string', description: 'Notification body' },
        subtitle: { type: 'string', description: 'Optional subtitle line' },
        sound:    { type: 'boolean', description: 'Play default sound (default true)' },
      },
    },
    handler: async ({ title, message, subtitle, sound = true }) => {
      const subLine = subtitle ? `subtitle "${escAS(subtitle)}"` : '';
      const sndLine = sound ? 'sound name "default"' : '';
      osa(`
        display notification "${escAS(message)}" with title "${escAS(title)}" ${subLine} ${sndLine}
      `);
      return { ok: true };
    },
  },
];

export const systemTools = [
  {
    name: 'system_status',
    description: 'Get Mac system status: CPU, memory, disk, uptime, hostname',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const run = (cmd, args = []) => {
        const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 });
        return r.stdout?.trim() ?? '';
      };

      const uptime = run('uptime');

      // Memory via vm_stat
      const vmstat = run('vm_stat');
      const pageSize = 16384; // M-series; 4096 on Intel
      const vmParse = (key) => {
        const m = vmstat.match(new RegExp(`${key}[^:]*:\\s+(\\d+)`));
        return m ? parseInt(m[1]) * pageSize : 0;
      };
      const memFree  = vmParse('Pages free');
      const memInact = vmParse('Pages inactive');
      const memWired = vmParse('Pages wired down');
      const memTotal = os.totalmem();

      // Disk
      const df = run('df', ['-H', '/']);
      const dfLine = df.split('\n')[1]?.split(/\s+/) ?? [];

      // CPU load (via sysctl)
      const loadAvg = os.loadavg();

      return {
        hostname: os.hostname(),
        platform: process.platform,
        arch:     process.arch,
        uptime_raw: uptime,
        load_avg:  { '1m': loadAvg[0].toFixed(2), '5m': loadAvg[1].toFixed(2), '15m': loadAvg[2].toFixed(2) },
        memory: {
          total_gb:    (memTotal / 1e9).toFixed(1),
          free_gb:     ((memFree + memInact) / 1e9).toFixed(1),
          wired_gb:    (memWired / 1e9).toFixed(1),
        },
        disk: {
          size:  dfLine[1] ?? '?',
          used:  dfLine[2] ?? '?',
          avail: dfLine[3] ?? '?',
          use_pct: dfLine[4] ?? '?',
        },
        node_version: process.version,
      };
    },
  },

  {
    name: 'system_processes',
    description: 'List running processes, optionally filtered by name',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Name substring filter (case-insensitive)' },
        limit:  { type: 'number', description: 'Max processes (default 30)' },
      },
    },
    handler: async ({ filter, limit = 30 }) => {
      const r = spawnSync('ps', ['-eo', 'pid,pcpu,pmem,comm', '--sort=-pcpu'], {
        encoding: 'utf8', timeout: 10_000,
      });
      const lines = r.stdout?.trim().split('\n').slice(1) ?? [];
      const filtered = filter
        ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
        : lines;
      return filtered.slice(0, limit).map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid:  parts[0],
          cpu:  parts[1],
          mem:  parts[2],
          name: parts.slice(3).join(' '),
        };
      });
    },
  },
];
