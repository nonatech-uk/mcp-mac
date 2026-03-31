import { spawnSync } from 'child_process';

/**
 * Run an AppleScript string, return trimmed stdout.
 * Throws with stderr on non-zero exit.
 */
export function osa(script) {
  const result = spawnSync('osascript', ['-'], {
    input: script,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `osascript exited ${result.status}`);
  }
  return result.stdout?.trim() ?? '';
}

/**
 * Parse a pipe-delimited record line into an object with given keys.
 * Skips blank lines.
 */
export function parseRecords(raw, keys) {
  return raw
    .split('\n')
    .filter(l => l.trim())
    .map(line => {
      const parts = line.split('|');
      return Object.fromEntries(keys.map((k, i) => [k, parts[i]?.trim() ?? '']));
    });
}

/**
 * Escape a string for safe insertion into an AppleScript string literal.
 */
export function escAS(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/**
 * Convert a JS Date (or ISO string) to AppleScript date literal.
 * e.g.  "Thursday, 3 April 2025 at 09:00:00"
 */
export function jsDateToAS(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const day = days[dt.getDay()];
  const month = months[dt.getMonth()];
  const pad = n => String(n).padStart(2, '0');
  return `${day}, ${dt.getDate()} ${month} ${dt.getFullYear()} at ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}
