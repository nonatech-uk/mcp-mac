import { osa, escAS } from '../utils/osascript.js';

export const browserTools = [
  {
    name: 'browser_get_current_tab',
    description: 'Get the URL, title, and text content of the active Safari tab',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const raw = osa(`
        tell application "Safari"
          set t to current tab of front window
          set u to URL of t
          set n to name of t
          return n & "|||" & u
        end tell
      `);
      const [title, url] = raw.split('|||');
      return { title: title?.trim(), url: url?.trim() };
    },
  },

  {
    name: 'browser_get_tabs',
    description: 'List all open Safari tabs across all windows',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const raw = osa(`
        tell application "Safari"
          set out to ""
          set winIdx to 0
          repeat with w in windows
            set winIdx to winIdx + 1
            set tabIdx to 0
            repeat with t in tabs of w
              set tabIdx to tabIdx + 1
              set out to out & winIdx & "|" & tabIdx & "|" & (name of t) & "|" & (URL of t) & "\n"
            end repeat
          end repeat
          return out
        end tell
      `);
      return raw.split('\n').filter(l => l.trim()).map(line => {
        const [win, tab, title, url] = line.split('|');
        return { window: +win, tab: +tab, title: title?.trim(), url: url?.trim() };
      });
    },
  },

  {
    name: 'browser_open_url',
    description: 'Open a URL in Safari (new tab in front window)',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'URL to open' },
      },
    },
    handler: async ({ url }) => {
      osa(`
        tell application "Safari"
          make new tab at end of tabs of front window with properties {URL:"${escAS(url)}"}
          activate
        end tell
      `);
      return { ok: true, url };
    },
  },

  {
    name: 'browser_get_page_text',
    description: 'Extract visible text from the current Safari tab using JavaScript',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const text = osa(`
        tell application "Safari"
          set result to do JavaScript "document.body.innerText.substring(0, 8000)" in current tab of front window
          return result
        end tell
      `);
      return { text: text?.trim() };
    },
  },
];
