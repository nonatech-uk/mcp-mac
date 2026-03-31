/**
 * Clipboard tools.
 *
 * These are the building blocks for cross-device clipboard sharing via the
 * NAS gateway:
 *
 *   "Move Studio clipboard to Notebook"
 *   → Claude calls clipboard_get on mac-studio MCP
 *   → Claude calls clipboard_set on mac-notebook MCP
 *
 * The gateway sees both Macs as named upstreams so Claude can route
 * explicitly even when both are up.
 */

import { spawnSync } from 'child_process';

function pbpaste() {
  const r = spawnSync('pbpaste', [], { encoding: 'utf8', timeout: 5_000 });
  if (r.error) throw r.error;
  return r.stdout ?? '';
}

function pbcopy(text) {
  const r = spawnSync('pbcopy', [], { input: text, encoding: 'utf8', timeout: 5_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`pbcopy failed: ${r.stderr}`);
}

export const clipboardTools = [
  {
    name: 'clipboard_get',
    description: 'Read the current macOS clipboard contents (text)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const content = pbpaste();
      return {
        content,
        length: content.length,
        _tip: 'Use clipboard_set on another device MCP to push this content there',
      };
    },
  },

  {
    name: 'clipboard_set',
    description: 'Write text to the macOS clipboard',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Text to place on the clipboard' },
      },
    },
    handler: async ({ content }) => {
      pbcopy(content);
      return { ok: true, length: content.length };
    },
  },
];
