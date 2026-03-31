#!/usr/bin/env node
/**
 * One-time Spotify OAuth2 flow to obtain a refresh token.
 *
 * Usage:
 *   1. Create a Spotify app at https://developer.spotify.com/dashboard
 *   2. Add http://localhost:8765/callback as a Redirect URI
 *   3. Copy Client ID and Secret into config.json (spotify section)
 *   4. node scripts/spotify_auth.js
 *   5. Visit the URL printed, authorise, copy the refresh_token into config.json
 */

import http from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dir, '..', 'config.json'), 'utf8'));
const { client_id, client_secret } = cfg.spotify;

const REDIRECT_URI = 'http://localhost:8765/callback';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-top-read',
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

const authUrl = `https://accounts.spotify.com/authorize?` + new URLSearchParams({
  response_type: 'code',
  client_id,
  scope: SCOPES,
  redirect_uri: REDIRECT_URI,
});

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:8765/callback ...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8765');
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code'); return; }

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
  });

  const data = await resp.json();

  res.end('Done! Check your terminal for the refresh_token.');
  server.close();

  console.log('\n✅  Spotify tokens obtained\n');
  console.log('Add to config.json → spotify:');
  console.log(JSON.stringify({ refresh_token: data.refresh_token }, null, 2));
  console.log('\nThe access_token also printed below (expires in 1 hour — not needed in config):');
  console.log(JSON.stringify({ access_token: data.access_token }, null, 2));
});

server.listen(8765);
