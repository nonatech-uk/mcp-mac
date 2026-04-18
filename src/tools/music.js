/**
 * Music tools: Spotify Web API + Plex Media Server API
 *
 * SPOTIFY:
 *   - Uses OAuth2 refresh token flow — run `node scripts/spotify_auth.js` once
 *     to get client_id, client_secret, refresh_token.  Token refresh happens
 *     automatically per call.
 *
 *   PIF INTEGRATION TIP:
 *     spotify_get_recommendations accepts seed_tracks pulled from your scrobble
 *     DB. A PIF query like "my top 5 tracks this month" → URIs → feed here
 *     → instant contextual playlist.
 *
 * PLEX:
 *   - Uses X-Plex-Token for auth (no OAuth needed).
 *   - Read-only: library browsing, search, sessions, clients.
 */

import config from '../config.js';

// ─── Spotify helpers ──────────────────────────────────────────────────────────

let spotifyAccessToken = null;
let spotifyTokenExpiry  = 0;

async function spotifyRefreshToken() {
  const { token_proxy_url, client_id, client_secret, refresh_token } = config.spotify;

  let data;
  if (token_proxy_url) {
    const resp = await fetch(token_proxy_url);
    if (!resp.ok) throw new Error(`Spotify token proxy ${token_proxy_url} → ${resp.status}`);
    data = await resp.json();
  } else {
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }),
    });
    if (!resp.ok) throw new Error(`Spotify token refresh failed: ${resp.status}`);
    data = await resp.json();
  }

  spotifyAccessToken = data.access_token;
  spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
}

async function spotify(path, method = 'GET', body) {
  if (!config.spotify.enabled) throw new Error('Spotify not enabled in config');
  if (Date.now() >= spotifyTokenExpiry) await spotifyRefreshToken();

  const resp = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${spotifyAccessToken}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Spotify API ${method} ${path} → ${resp.status}: ${err}`);
  }
  if (resp.status === 204) return null;
  const ct = resp.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return null;
  return resp.json();
}

async function getDefaultDeviceId() {
  const data = await spotify('/me/player/devices');
  const devs = data?.devices ?? [];
  const named = devs.find(d => d.name === config.spotify.default_device_name);
  return named?.id ?? devs[0]?.id ?? null;
}

// ─── Plex helpers ─────────────────────────────────────────────────────────────

async function plex(path, params = {}) {
  if (!config.plex.enabled) throw new Error('Plex not enabled in config');
  const url = new URL(config.plex.server_url + path);
  url.searchParams.set('X-Plex-Token', config.plex.token);
  url.searchParams.set('X-Plex-Client-Identifier', 'mac-mcp');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`Plex API ${path} → ${resp.status}`);
  return resp.json();
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const musicTools = [

  // ── Spotify ──────────────────────────────────────────────────────────────

  {
    name: 'spotify_status',
    description: 'Get current Spotify playback state (track, artist, device, progress)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await spotify('/me/player');
      if (!data) return { playing: false };
      return {
        playing:    data.is_playing,
        track:      data.item?.name,
        artist:     data.item?.artists?.map(a => a.name).join(', '),
        album:      data.item?.album?.name,
        uri:        data.item?.uri,
        progress_s: Math.floor((data.progress_ms ?? 0) / 1000),
        duration_s: Math.floor((data.item?.duration_ms ?? 0) / 1000),
        device:     data.device?.name,
        volume:     data.device?.volume_percent,
        shuffle:    data.shuffle_state,
        repeat:     data.repeat_state,
      };
    },
  },

  {
    name: 'spotify_search',
    description: 'Search Spotify for tracks, artists, albums, or playlists',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query:  { type: 'string' },
        type:   { type: 'string', enum: ['track','artist','album','playlist'], description: 'Default: track' },
        limit:  { type: 'number', description: 'Results per type (default 10)' },
        market: { type: 'string', description: 'ISO 3166-1 market (default GB)' },
      },
    },
    handler: async ({ query, type = 'track', limit = 10, market = 'GB' }) => {
      const data = await spotify(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&market=${market}`);
      const section = data[`${type}s`]?.items ?? [];
      return section.map(item => {
        if (type === 'track')    return { name: item.name, artist: item.artists?.map(a=>a.name).join(', '), album: item.album?.name, uri: item.uri, duration_s: Math.floor(item.duration_ms/1000) };
        if (type === 'artist')   return { name: item.name, uri: item.uri, genres: item.genres, popularity: item.popularity };
        if (type === 'album')    return { name: item.name, artist: item.artists?.map(a=>a.name).join(', '), uri: item.uri, year: item.release_date?.slice(0,4) };
        if (type === 'playlist') return { name: item.name, owner: item.owner?.display_name, uri: item.uri, tracks: item.tracks?.total };
        return item;
      });
    },
  },

  {
    name: 'spotify_play',
    description: 'Start or resume Spotify playback. Pass a URI to play a specific track, album, or playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        uri:       { type: 'string', description: 'Spotify URI (track, album, playlist, artist)' },
        uris:      { type: 'array', items: { type: 'string' }, description: 'Array of track URIs to play in sequence' },
        device_id: { type: 'string', description: 'Target device ID (default: configured default device)' },
        offset_ms: { type: 'number', description: 'Start position in ms' },
      },
    },
    handler: async ({ uri, uris, device_id, offset_ms }) => {
      const devId = device_id ?? await getDefaultDeviceId();
      const body = {};
      // Spotify: track URIs go in `uris` array, album/playlist/artist URIs go in `context_uri`
      if (uri && uri.startsWith('spotify:track:')) body.uris = [uri];
      else if (uri) body.context_uri = uri;
      if (uris)  body.uris = uris;
      if (offset_ms) body.position_ms = offset_ms;
      await spotify(`/me/player/play${devId ? `?device_id=${devId}` : ''}`, 'PUT', body);
      return { ok: true, device_id: devId };
    },
  },

  {
    name: 'spotify_pause',
    description: 'Pause Spotify playback',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => { await spotify('/me/player/pause', 'PUT'); return { ok: true }; },
  },

  {
    name: 'spotify_skip',
    description: 'Skip to next track on Spotify',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => { await spotify('/me/player/next', 'POST'); return { ok: true }; },
  },

  {
    name: 'spotify_queue',
    description: 'Add a track to the Spotify play queue',
    inputSchema: {
      type: 'object',
      required: ['track_uri'],
      properties: {
        track_uri: { type: 'string', description: 'Spotify track URI' },
      },
    },
    handler: async ({ track_uri }) => {
      await spotify(`/me/player/queue?uri=${encodeURIComponent(track_uri)}`, 'POST');
      return { ok: true };
    },
  },

  {
    name: 'spotify_get_devices',
    description: 'List available Spotify playback devices',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await spotify('/me/player/devices');
      return data?.devices?.map(d => ({
        id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent,
      })) ?? [];
    },
  },

  {
    name: 'spotify_create_playlist',
    description: 'Create a Spotify playlist and optionally populate it with tracks',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name:       { type: 'string' },
        description:{ type: 'string' },
        track_uris: { type: 'array', items: { type: 'string' }, description: 'Track URIs to add immediately' },
        public:     { type: 'boolean', description: 'Public playlist? (default false)' },
      },
    },
    handler: async ({ name, description = '', track_uris = [], public: pub = false }) => {
      const me = await spotify('/me');
      const userId = me.id;

      const playlist = await spotify(`/users/${userId}/playlists`, 'POST', {
        name,
        description,
        public: pub,
      });

      if (track_uris.length > 0) {
        // Add in batches of 100
        for (let i = 0; i < track_uris.length; i += 100) {
          await spotify(`/playlists/${playlist.id}/tracks`, 'POST', {
            uris: track_uris.slice(i, i + 100),
          });
        }
      }

      return {
        id:     playlist.id,
        uri:    playlist.uri,
        url:    playlist.external_urls?.spotify,
        name:   playlist.name,
        tracks: track_uris.length,
      };
    },
  },

  // ── Plex ─────────────────────────────────────────────────────────────────

  {
    name: 'plex_libraries',
    description: 'List Plex Media Server libraries',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await plex('/library/sections');
      return data?.MediaContainer?.Directory?.map(d => ({
        key:   d.key,
        title: d.title,
        type:  d.type,
        agent: d.agent,
        count: d.count,
      })) ?? [];
    },
  },

  {
    name: 'plex_search',
    description: 'Search Plex for movies, shows, music, or episodes',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query:         { type: 'string' },
        library_key:   { type: 'string', description: 'Library section key from plex_libraries (omit to search all)' },
        limit:         { type: 'number', description: 'Max results (default 15)' },
      },
    },
    handler: async ({ query, library_key, limit = 15 }) => {
      const path = library_key
        ? `/library/sections/${library_key}/search`
        : '/search';
      const data = await plex(path, { query, limit });
      const items = data?.MediaContainer?.Metadata ?? [];
      return items.map(m => ({
        key:    m.key,
        title:  m.title,
        type:   m.type,
        year:   m.year,
        rating: m.rating,
        thumb:  m.thumb,
      }));
    },
  },

  {
    name: 'plex_get_sessions',
    description: 'Get active Plex playback sessions (who is watching/listening to what)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await plex('/status/sessions');
      return data?.MediaContainer?.Metadata?.map(s => ({
        user:     s.User?.title,
        title:    s.title,
        type:     s.type,
        player:   s.Player?.title,
        state:    s.Player?.state,
        progress: `${Math.round((s.viewOffset ?? 0) / (s.duration ?? 1) * 100)}%`,
      })) ?? [];
    },
  },

  {
    name: 'plex_get_clients',
    description: 'List available Plex player clients on the local network',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await plex('/clients');
      return data?.MediaContainer?.Server?.map(c => ({
        name:    c.name,
        address: c.address,
        port:    c.port,
        product: c.product,
        version: c.version,
      })) ?? [];
    },
  },
];
