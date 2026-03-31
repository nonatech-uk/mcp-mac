import { osa, parseRecords, escAS, jsDateToAS } from '../utils/osascript.js';

export const calendarTools = [
  {
    name: 'calendar_list_calendars',
    description: 'List all calendars with name, ID and type',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const raw = osa(`
        tell application "Calendar"
          set out to ""
          repeat with c in calendars
            set out to out & (name of c) & "|" & (id of c) & "\n"
          end repeat
          return out
        end tell
      `);
      return parseRecords(raw, ['name', 'id']);
    },
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
      const calFilter = calendar_name ? `whose name is "${escAS(calendar_name)}"` : '';
      const raw = osa(`
        tell application "Calendar"
          set startD to date "${jsDateToAS(start_date)}"
          set endD to date "${jsDateToAS(end_date)}"
          set out to ""
          repeat with c in (calendars ${calFilter})
            set cName to name of c
            set evts to (every event of c whose start date >= startD and start date <= endD)
            repeat with e in evts
              set locStr to ""
              try
                set locStr to location of e
              end try
              set out to out & (summary of e) & "|" & (start date of e) & "|" & (end date of e) & "|" & (id of e) & "|" & cName & "|" & locStr & "\n"
            end repeat
          end repeat
          return out
        end tell
      `);
      return parseRecords(raw, ['title', 'start', 'end', 'id', 'calendar', 'location']);
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
        calendar_name: { type: 'string', description: 'Calendar to add to (default: first calendar)' },
        location:      { type: 'string' },
        notes:         { type: 'string' },
        all_day:       { type: 'boolean', description: 'All-day event?' },
      },
    },
    handler: async ({ title, start_date, end_date, calendar_name, location, notes, all_day }) => {
      const calClause = calendar_name
        ? `tell calendar "${escAS(calendar_name)}"`
        : 'tell calendar 1';
      const locLine  = location ? `set location of newE to "${escAS(location)}"` : '';
      const noteLine = notes    ? `set description of newE to "${escAS(notes)}"` : '';
      const allDay   = all_day  ? 'set allday event of newE to true' : '';

      const newId = osa(`
        tell application "Calendar"
          ${calClause}
            set newE to make new event with properties {summary:"${escAS(title)}", start date:date "${jsDateToAS(start_date)}", end date:date "${jsDateToAS(end_date)}"}
            ${locLine}
            ${noteLine}
            ${allDay}
            return id of newE
          end tell
        end tell
      `);
      return { id: newId, title };
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
      const lines = [
        title      && `set summary of e to "${escAS(title)}"`,
        start_date && `set start date of e to date "${jsDateToAS(start_date)}"`,
        end_date   && `set end date of e to date "${jsDateToAS(end_date)}"`,
        location   && `set location of e to "${escAS(location)}"`,
        notes      && `set description of e to "${escAS(notes)}"`,
      ].filter(Boolean).join('\n            ');

      osa(`
        tell application "Calendar"
          set e to event id "${escAS(id)}"
          ${lines}
        end tell
      `);
      return { ok: true, id };
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
    handler: async ({ id }) => {
      osa(`
        tell application "Calendar"
          delete (event id "${escAS(id)}")
        end tell
      `);
      return { ok: true, id };
    },
  },

  {
    name: 'calendar_get_availability',
    description: 'Return free/busy slots within a time range (across all calendars)',
    inputSchema: {
      type: 'object',
      required: ['start_date', 'end_date'],
      properties: {
        start_date: { type: 'string', description: 'ISO 8601 start' },
        end_date:   { type: 'string', description: 'ISO 8601 end' },
      },
    },
    handler: async ({ start_date, end_date }) => {
      // Reuse get_events across all calendars, then let the caller reason about gaps
      const raw = osa(`
        tell application "Calendar"
          set startD to date "${jsDateToAS(start_date)}"
          set endD to date "${jsDateToAS(end_date)}"
          set out to ""
          repeat with c in calendars
            set evts to (every event of c whose start date >= startD and start date <= endD)
            repeat with e in evts
              set out to out & (summary of e) & "|" & (start date of e) & "|" & (end date of e) & "\n"
            end repeat
          end repeat
          return out
        end tell
      `);
      const busy = parseRecords(raw, ['title', 'start', 'end']);
      return {
        query: { start: start_date, end: end_date },
        busy_slots: busy,
        _note: 'Free time = gaps between busy_slots within the queried range',
      };
    },
  },
];
