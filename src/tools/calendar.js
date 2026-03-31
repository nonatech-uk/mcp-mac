import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../scripts');
const BIN = join(SCRIPTS, 'calendar-ek');
const LAUNCHER = join(SCRIPTS, 'mac-mcp-ek.app/Contents/MacOS/launcher');

function ek(...args) {
  const r = spawnSync(LAUNCHER, ['calendar-ek', ...args], { encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr?.trim() || `calendar-ek exited with code ${r.status}`);
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export const calendarTools = [
  {
    name: 'calendar_list_calendars',
    description: 'List all calendars with name, ID and type',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ek('list-calendars'),
  },

  {
    name: 'calendar_get_events',
    description: 'Get events within a date range, optionally filtered by calendar',
    inputSchema: {
      type: 'object',
      required: ['start_date', 'end_date'],
      properties: {
        start_date:    { type: 'string', description: 'ISO 8601 start datetime' },
        end_date:      { type: 'string', description: 'ISO 8601 end datetime' },
        calendar_name: { type: 'string', description: 'Filter to this calendar (omit for all)' },
      },
    },
    handler: async ({ start_date, end_date, calendar_name }) => {
      const args = ['get-events', '--start', start_date, '--end', end_date];
      if (calendar_name) args.push('--calendar', calendar_name);
      return ek(...args);
    },
  },

  {
    name: 'calendar_create_event',
    description: 'Create a calendar event',
    inputSchema: {
      type: 'object',
      required: ['title', 'start_date', 'end_date'],
      properties: {
        title:         { type: 'string', description: 'Event title / summary' },
        start_date:    { type: 'string', description: 'ISO 8601 start datetime' },
        end_date:      { type: 'string', description: 'ISO 8601 end datetime' },
        calendar_name: { type: 'string', description: 'Calendar to add to (default: first writable calendar)' },
        location:      { type: 'string' },
        notes:         { type: 'string' },
        all_day:       { type: 'boolean', description: 'All-day event?' },
      },
    },
    handler: async ({ title, start_date, end_date, calendar_name, location, notes, all_day }) => {
      const args = ['create-event', '--title', title, '--start', start_date, '--end', end_date];
      if (calendar_name) args.push('--calendar', calendar_name);
      if (location)      args.push('--location', location);
      if (notes)         args.push('--notes', notes);
      if (all_day)       args.push('--all-day');
      return ek(...args)[0];
    },
  },

  {
    name: 'calendar_update_event',
    description: 'Update fields on an existing event by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id:         { type: 'string', description: 'Event ID (from calendar_get_events)' },
        title:      { type: 'string' },
        start_date: { type: 'string' },
        end_date:   { type: 'string' },
        location:   { type: 'string' },
        notes:      { type: 'string' },
      },
    },
    handler: async ({ id, title, start_date, end_date, location, notes }) => {
      const args = ['update-event', '--id', id];
      if (title)      args.push('--title', title);
      if (start_date) args.push('--start', start_date);
      if (end_date)   args.push('--end', end_date);
      if (location)   args.push('--location', location);
      if (notes)      args.push('--notes', notes);
      return ek(...args)[0];
    },
  },

  {
    name: 'calendar_delete_event',
    description: 'Delete an event by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    },
    handler: async ({ id }) => ek('delete-event', '--id', id)[0],
  },

  {
    name: 'calendar_get_availability',
    description: 'Return busy slots within a time range (across all calendars)',
    inputSchema: {
      type: 'object',
      required: ['start_date', 'end_date'],
      properties: {
        start_date: { type: 'string', description: 'ISO 8601 start' },
        end_date:   { type: 'string', description: 'ISO 8601 end' },
      },
    },
    handler: async ({ start_date, end_date }) => {
      const busy = ek('get-events', '--start', start_date, '--end', end_date);
      return {
        query: { start: start_date, end: end_date },
        busy_slots: busy,
        _note: 'Free time = gaps between busy_slots within the queried range',
      };
    },
  },
];
