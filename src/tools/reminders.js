import { osa, parseRecords, escAS, jsDateToAS } from '../utils/osascript.js';

export const reminderTools = [
  {
    name: 'reminders_list_lists',
    description: 'List all Reminders lists (names and IDs)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const raw = osa(`
        tell application "Reminders"
          set out to ""
          repeat with aList in lists
            set out to out & (name of aList) & "|" & (id of aList) & "\n"
          end repeat
          return out
        end tell
      `);
      return parseRecords(raw, ['name', 'id']);
    },
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
      const listFilter = list_name ? `whose name is "${escAS(list_name)}"` : '';
      const raw = osa(`
        tell application "Reminders"
          set out to ""
          repeat with aList in (lists ${listFilter})
            set lName to name of aList
            repeat with r in reminders of aList
              set done to completed of r
              if (${include_completed} or not done) then
                set dueStr to ""
                try
                  set dueStr to (due date of r) as string
                end try
                set out to out & lName & "|" & (name of r) & "|" & (id of r) & "|" & done & "|" & dueStr & "|" & (body of r) & "\n"
              end if
            end repeat
          end repeat
          return out
        end tell
      `);
      return parseRecords(raw, ['list', 'title', 'id', 'completed', 'due_date', 'notes']);
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
        list_name: { type: 'string', description: 'List to add to (default: Reminders)' },
        due_date:  { type: 'string', description: 'ISO 8601 due date/time' },
        notes:     { type: 'string', description: 'Body/notes text' },
        priority:  { type: 'number', description: '0=none, 1=high, 5=medium, 9=low' },
      },
    },
    handler: async ({ title, list_name = 'Reminders', due_date, notes, priority }) => {
      const dueLine = due_date
        ? `set due date of newR to date "${jsDateToAS(due_date)}"`
        : '';
      const noteLine = notes ? `set body of newR to "${escAS(notes)}"` : '';
      const priLine  = priority != null ? `set priority of newR to ${priority}` : '';

      const newId = osa(`
        tell application "Reminders"
          tell list "${escAS(list_name)}"
            set newR to make new reminder with properties {name:"${escAS(title)}"}
            ${dueLine}
            ${noteLine}
            ${priLine}
            return id of newR
          end tell
        end tell
      `);
      return { id: newId, title, list_name };
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
    handler: async ({ id }) => {
      osa(`
        tell application "Reminders"
          set r to reminder id "${escAS(id)}"
          set completed of r to true
        end tell
      `);
      return { ok: true, id };
    },
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
    handler: async ({ id }) => {
      osa(`
        tell application "Reminders"
          delete (reminder id "${escAS(id)}")
        end tell
      `);
      return { ok: true, id };
    },
  },
];
