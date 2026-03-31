/**
 * iMessage tools.
 *
 * READ:  Direct SQL on ~/Library/Messages/chat.db
 *        Requires Full Disk Access in System Settings → Privacy → Full Disk Access
 *        for the node process / terminal that launches this server.
 *
 * SEND:  AppleScript — requires Automation access for Messages.
 *        Gated by config.messages.send_enabled.
 */

import Database from 'better-sqlite3';
import os from 'os';
import { join } from 'path';
import { osa, escAS } from '../utils/osascript.js';
import config from '../config.js';

const DB_PATH = join(os.homedir(), 'Library', 'Messages', 'chat.db');

function openDB() {
  // Open read-only — we never write to chat.db
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

export const messageTools = [
  {
    name: 'messages_get_conversations',
    description: 'List recent iMessage/SMS conversations with last message preview',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of conversations to return (default 20)' },
      },
    },
    handler: async ({ limit = 20 }) => {
      const db = openDB();
      try {
        const rows = db.prepare(`
          SELECT
            c.chat_identifier,
            c.display_name,
            m.text                       AS last_text,
            datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS last_date,
            m.is_from_me
          FROM chat c
          JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
          JOIN message m             ON m.ROWID = cmj.message_id
          WHERE m.ROWID = (
            SELECT MAX(m2.ROWID)
            FROM message m2
            JOIN chat_message_join cmj2 ON cmj2.message_id = m2.ROWID
            WHERE cmj2.chat_id = c.ROWID
          )
          ORDER BY m.date DESC
          LIMIT ?
        `).all(limit);
        return rows;
      } finally {
        db.close();
      }
    },
  },

  {
    name: 'messages_get_thread',
    description: 'Get messages in a specific conversation by chat_identifier',
    inputSchema: {
      type: 'object',
      required: ['chat_identifier'],
      properties: {
        chat_identifier: { type: 'string', description: 'Phone number, email, or group ID from messages_get_conversations' },
        limit:           { type: 'number', description: 'Number of messages (default 50, newest first)' },
      },
    },
    handler: async ({ chat_identifier, limit = 50 }) => {
      const db = openDB();
      try {
        const rows = db.prepare(`
          SELECT
            m.text,
            m.is_from_me,
            datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS sent_at,
            h.id AS sender
          FROM message m
          JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
          JOIN chat c               ON c.ROWID = cmj.chat_id
          LEFT JOIN handle h        ON h.ROWID = m.handle_id
          WHERE c.chat_identifier = ?
          ORDER BY m.date DESC
          LIMIT ?
        `).all(chat_identifier, limit);
        return rows.reverse(); // chronological
      } finally {
        db.close();
      }
    },
  },

  {
    name: 'messages_search',
    description: 'Full-text search across all iMessage conversations',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Max results (default 30)' },
      },
    },
    handler: async ({ query, limit = 30 }) => {
      const db = openDB();
      try {
        const rows = db.prepare(`
          SELECT
            m.text,
            m.is_from_me,
            datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS sent_at,
            c.chat_identifier,
            c.display_name
          FROM message m
          JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
          JOIN chat c               ON c.ROWID = cmj.chat_id
          WHERE m.text LIKE ?
          ORDER BY m.date DESC
          LIMIT ?
        `).all(`%${query}%`, limit);
        return rows;
      } finally {
        db.close();
      }
    },
  },

  ...(config.messages.send_enabled ? [{
    name: 'messages_send',
    description: 'Send an iMessage or SMS. REQUIRES send_enabled in config.',
    inputSchema: {
      type: 'object',
      required: ['recipient', 'message'],
      properties: {
        recipient: { type: 'string', description: 'Phone number or email address' },
        message:   { type: 'string', description: 'Message body' },
        service:   { type: 'string', enum: ['iMessage', 'SMS'], description: 'Default: iMessage' },
      },
    },
    handler: async ({ recipient, message, service = 'iMessage' }) => {
      osa(`
        tell application "Messages"
          set targetService to 1st account whose service type = ${service}
          set targetBuddy to participant "${escAS(recipient)}" of targetService
          send "${escAS(message)}" to targetBuddy
        end tell
      `);
      return { ok: true, recipient, service };
    },
  }] : []),
];
