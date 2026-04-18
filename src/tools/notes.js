import { osa, parseRecords, escAS } from '../utils/osascript.js';

export const noteTools = [
  {
    name: 'notes_list',
    description: 'List Apple Notes with title and modification date, optionally filtered by folder',
    inputSchema: {
      type: 'object',
      properties: {
        folder_name: { type: 'string', description: 'Folder name (omit for all)' },
        limit:       { type: 'number', description: 'Max notes to return (default 50)' },
      },
    },
    handler: async ({ folder_name, limit = 50 }) => {
      const folderClause = folder_name
        ? `folders whose name is "${escAS(folder_name)}"`
        : 'folders';
      const raw = osa(`
        tell application "Notes"
          set out to ""
          set cnt to 0
          repeat with f in ${folderClause}
            repeat with n in notes of f
              if cnt >= ${limit} then return out
              set out to out & (id of n) & "|" & (name of n) & "|" & (modification date of n) & "|" & (name of f) & "\n"
              set cnt to cnt + 1
            end repeat
          end repeat
          return out
        end tell
      `);
      return parseRecords(raw, ['id', 'title', 'modified', 'folder']);
    },
  },

  {
    name: 'notes_get',
    description: 'Get the full content of a note by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    },
    handler: async ({ id }) => {
      const raw = osa(`
        tell application "Notes"
          set n to note id "${escAS(id)}"
          return (name of n) & "|||" & (body of n)
        end tell
      `);
      const [title, ...bodyParts] = raw.split('|||');
      // body is HTML; strip tags for plain text
      const body = bodyParts.join('|||').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { id, title: title.trim(), body };
    },
  },

  {
    name: 'notes_create',
    description: 'Create a new Apple Note',
    inputSchema: {
      type: 'object',
      required: ['title', 'body'],
      properties: {
        title:       { type: 'string' },
        body:        { type: 'string', description: 'Plain text or HTML' },
        folder_name: { type: 'string', description: 'Folder to create in (default: Notes)' },
      },
    },
    handler: async ({ title, body, folder_name = 'Notes' }) => {
      const newId = osa(`
        tell application "Notes"
          tell folder "${escAS(folder_name)}"
            set n to make new note with properties {name:"${escAS(title)}", body:"${escAS(body)}"}
            return id of n
          end tell
        end tell
      `);
      return { id: newId, title };
    },
  },

  {
    name: 'notes_delete',
    description: 'Delete an Apple Note by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Note ID (from notes_list / notes_search / notes_create)' },
      },
    },
    handler: async ({ id }) => {
      osa(`
        tell application "Notes"
          delete note id "${escAS(id)}"
        end tell
      `);
      return { ok: true, id };
    },
  },

  {
    name: 'notes_search',
    description: 'Search Apple Notes by keyword in title or body',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler: async ({ query, limit = 20 }) => {
      const raw = osa(`
        tell application "Notes"
          set q to "${escAS(query)}"
          set out to ""
          set cnt to 0
          repeat with f in folders
            repeat with n in notes of f
              if cnt >= ${limit} then return out
              if (name of n) contains q or (body of n) contains q then
                set out to out & (id of n) & "|" & (name of n) & "|" & (name of f) & "\n"
                set cnt to cnt + 1
              end if
            end repeat
          end repeat
          return out
        end tell
      `);
      return parseRecords(raw, ['id', 'title', 'folder']);
    },
  },
];
