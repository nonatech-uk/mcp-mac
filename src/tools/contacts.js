import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/contacts-ek');

function ek(...args) {
  const r = spawnSync(BIN, args, { encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr?.trim() || `contacts-ek exited with code ${r.status}`);
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export const contactTools = [
  {
    name: 'contacts_search',
    description: 'Search Apple Contacts by name, email, or phone',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search string (name, email, or phone fragment)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler: async ({ query, limit = 20 }) =>
      ek('search', '--query', query, '--limit', String(limit)),
  },

  {
    name: 'contacts_get',
    description: 'Get full details for a contact by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Contact ID from contacts_search' },
      },
    },
    handler: async ({ id }) => ek('get', '--id', id)[0],
  },
];
