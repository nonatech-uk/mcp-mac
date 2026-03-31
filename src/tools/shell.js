import { spawnSync } from 'child_process';
import config from '../config.js';

export const shellTools = config.shell.enabled ? [
  {
    name: 'shell_run',
    description: `Run an allowlisted shell command. Allowed commands: ${config.shell.allowlist.join(', ')}`,
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'Command name (must be on allowlist)' },
        args:    {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments array',
        },
        cwd:     { type: 'string', description: 'Working directory (default: home)' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
      },
    },
    handler: async ({ command, args = [], cwd, timeout = 30_000 }) => {
      const allowed = config.shell.allowlist ?? [];
      if (!allowed.includes(command)) {
        throw new Error(`Command "${command}" is not on the allowlist. Allowed: ${allowed.join(', ')}`);
      }

      const safeCwd = cwd ?? process.env.HOME;
      const safeTimeout = Math.min(timeout, 120_000);

      const result = spawnSync(command, args, {
        encoding: 'utf8',
        cwd: safeCwd,
        timeout: safeTimeout,
        maxBuffer: 5 * 1024 * 1024,
      });

      return {
        command,
        args,
        exit_code: result.status ?? -1,
        stdout: result.stdout?.trim() ?? '',
        stderr: result.stderr?.trim() ?? '',
        timed_out: result.signal === 'SIGTERM',
      };
    },
  },
] : [];
