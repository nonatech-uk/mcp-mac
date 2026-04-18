import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/reminders-ek');

function ek(...args) {
  const r = spawnSync(BIN, args, { encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr?.trim() || `reminders-ek exited with code ${r.status}`);
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export const reminderTools = [
  {
    name: 'reminders_list_lists',
    description: 'List all Reminders lists (including those inside folders)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ek('list-lists'),
  },

  {
    name: 'reminders_get',
    description: 'Get reminders, optionally filtered by list name and/or include completed',
    inputSchema: {
      type: 'object',
      properties: {
        list_name:         { type: 'string',  description: 'Limit to this list name (omit for all)' },
        include_completed: { type: 'boolean', description: 'Include completed reminders (default false)' },
      },
    },
    handler: async ({ list_name, include_completed = false }) => {
      const args = ['get'];
      if (list_name) args.push('--list', list_name);
      if (include_completed) args.push('--include-completed');
      return ek(...args);
    },
  },

  {
    name: 'reminders_create',
    description: 'Create a new reminder',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:     { type: 'string', description: 'Reminder title' },
        list_name: { type: 'string', description: 'List to add to (default: Inbox)' },
        due_date:  { type: 'string', description: 'ISO 8601 due date/time' },
        notes:     { type: 'string', description: 'Body/notes text' },
        priority:  { type: 'number', description: '0=none, 1=high, 5=medium, 9=low' },
      },
    },
    handler: async ({ title, list_name, due_date, notes, priority }) => {
      const args = ['create', '--title', title];
      if (list_name) args.push('--list', list_name);
      if (due_date)  args.push('--due', due_date);
      if (notes)     args.push('--notes', notes);
      if (priority != null) args.push('--priority', String(priority));
      return ek(...args)[0];
    },
  },

  {
    name: 'reminders_complete',
    description: 'Mark a reminder as completed by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Reminder ID (from reminders_get)' },
      },
    },
    handler: async ({ id }) => ek('complete', '--id', id)[0],
  },

  {
    name: 'reminders_delete',
    description: 'Delete a reminder by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Reminder ID (from reminders_get)' },
      },
    },
    handler: async ({ id }) => ek('delete', '--id', id)[0],
  },
];
