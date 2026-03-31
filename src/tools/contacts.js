import { osa, escAS } from '../utils/osascript.js';

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
    handler: async ({ query, limit = 20 }) => {
      const raw = osa(`
        tell application "Contacts"
          set q to "${escAS(query)}"
          set matches to {}
          set cnt to 0
          repeat with p in people
            if cnt >= ${limit} then exit repeat
            set nm to ""
            try
              set nm to (first name of p) & " " & (last name of p)
            end try
            if nm contains q then
              set emails to ""
              try
                set emailList to email of p
                repeat with em in emailList
                  set emails to emails & (value of em) & ";"
                end repeat
              end try
              set phones to ""
              try
                set phoneList to phone of p
                repeat with ph in phoneList
                  set phones to phones & (value of ph) & ";"
                end repeat
              end try
              set end of matches to (id of p) & "|" & nm & "|" & emails & "|" & phones
              set cnt to cnt + 1
            end if
          end repeat
          set out to ""
          repeat with m in matches
            set out to out & m & "\n"
          end repeat
          return out
        end tell
      `);
      return raw.split('\n').filter(l => l.trim()).map(line => {
        const [id, name, emails, phones] = line.split('|');
        return {
          id: id?.trim(),
          name: name?.trim(),
          emails: emails?.split(';').filter(Boolean) ?? [],
          phones: phones?.split(';').filter(Boolean) ?? [],
        };
      });
    },
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
    handler: async ({ id }) => {
      const raw = osa(`
        tell application "Contacts"
          set p to person id "${escAS(id)}"
          set nm to ""
          try
            set nm to (first name of p) & " " & (last name of p)
          end try
          set org to ""
          try
            set org to organization of p
          end try
          set emails to ""
          try
            repeat with em in (email of p)
              set emails to emails & (label of em) & ":" & (value of em) & ";"
            end repeat
          end try
          set phones to ""
          try
            repeat with ph in (phone of p)
              set phones to phones & (label of ph) & ":" & (value of ph) & ";"
            end repeat
          end try
          set addrs to ""
          try
            repeat with a in (address of p)
              set addrs to addrs & (street of a) & ", " & (city of a) & ", " & (zip of a) & ";"
            end repeat
          end try
          set note to ""
          try
            set note to note of p
          end try
          return nm & "|" & org & "|" & emails & "|" & phones & "|" & addrs & "|" & note
        end tell
      `);
      const [name, org, emails, phones, addresses, notes] = raw.split('|');
      return {
        id,
        name: name?.trim(),
        organisation: org?.trim(),
        emails:    emails?.split(';').filter(Boolean).map(e => { const [l,v] = e.split(':'); return {label:l,value:v}; }),
        phones:    phones?.split(';').filter(Boolean).map(p => { const [l,v] = p.split(':'); return {label:l,value:v}; }),
        addresses: addresses?.split(';').filter(Boolean),
        notes:     notes?.trim(),
      };
    },
  },
];
