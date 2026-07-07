/**
 * mac-mcp — NonaTech Mac MCP Server
 *
 * Exposes Apple data and local Mac facilities over StreamableHTTP for the
 * NAS gateway to consume over WireGuard.
 *
 * Endpoints:
 *   GET  /health   → priority beacon for gateway routing
 *   GET/POST /mcp  → MCP StreamableHTTP transport (gateway connects here)
 */

import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import { Server }           from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { config }            from './config.js';
import { reminderTools }     from './tools/reminders.js';
import { calendarTools }     from './tools/calendar.js';
import { contactTools }      from './tools/contacts.js';
import { messageTools }      from './tools/messages.js';
import { noteTools }         from './tools/notes.js';
import { shellTools }        from './tools/shell.js';
import { clipboardTools }    from './tools/clipboard.js';
import { notificationTools, systemTools } from './tools/system.js';
import { musicTools }        from './tools/music.js';
import { browserTools }      from './tools/browser.js';

// ─── Aggregate all tools ─────────────────────────────────────────────────────

// Constant prefix on every host — gateway routes by priority to whichever
// host is reachable, so identical tool names across hosts are required.
const TOOL_PREFIX = 'apple';

const ALL_TOOLS = [
  ...reminderTools,
  ...calendarTools,
  ...contactTools,
  ...messageTools,
  ...noteTools,
  ...shellTools,
  ...clipboardTools,
  ...notificationTools,
  ...systemTools,
  ...musicTools,
  ...browserTools,
].map(t => ({ ...t, name: `${TOOL_PREFIX}_${t.name}` }));

const TOOL_MAP = new Map(ALL_TOOLS.map(t => [t.name, t]));

// ─── MCP Server factory (new instance per request) ───────────────────────────

function createMcpServer() {
  const server = new Server(
    { name: `mac-mcp-${config.hostname}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOL_MAP.get(name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      console.error(`[${name}] error:`, err);
      return {
        content: [{ type: 'text', text: `Error in ${name}: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Express + StreamableHTTP transport ──────────────────────────────────────

const app = express();
app.use(express.json());

// Bearer token auth — reject requests without the correct key
if (config.api_key) {
  app.use((req, res, next) => {
    if (req.path === '/health') return next();

    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${config.api_key}`) {
      console.warn(`[auth] rejected ${req.method} ${req.path} from ${req.ip}`);
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });
  console.log('Bearer token auth enabled');
}

// Health beacon
app.get('/health', (_req, res) => {
  res.json({
    ok:           true,
    hostname:     config.hostname,
    priority:     config.priority,
    capabilities: ALL_TOOLS.map(t => t.name),
    uptime_s:     Math.floor(process.uptime()),
    ts:           new Date().toISOString(),
  });
});

// MCP StreamableHTTP endpoint — new server instance per request (stateless)
app.all('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ─── Start ────────────────────────────────────────────────────────────────────

const LISTEN_ADDR = config.bind || config.wireguard_ip || '127.0.0.1';

// Security: binding to a non-loopback address exposes the MCP endpoint (shell
// exec, messages, clipboard, …) on the network. The api_key Bearer check is the
// only access control, and it is skipped entirely when api_key is empty. Refuse
// to start in that combination rather than come up unauthenticated and reachable.
const isLoopback = LISTEN_ADDR === '127.0.0.1' || LISTEN_ADDR === '::1';
if (!isLoopback && !config.api_key) {
  console.error(
    `Refusing to start: bound to ${LISTEN_ADDR} (non-loopback) with no api_key. ` +
    `Set api_key in config.json (or the MCP_API_KEY env var) to allow network ` +
    `exposure, or set bind to "127.0.0.1" for loopback-only.`,
  );
  process.exit(1);
}

function onListening(protocol) {
  console.log(`mac-mcp [${config.hostname}] priority=${config.priority}`);
  console.log(`Listening on ${protocol}://${LISTEN_ADDR}:${config.port}`);
  console.log(`Tools registered: ${ALL_TOOLS.length}`);
  if (config.api_key) console.log('API key auth enabled');
  console.log('Health: GET /health');
  console.log('MCP:    /mcp');
  startReachabilityMonitor(protocol);
}

// Periodic reachability monitor.
//
// The macOS Application Firewall silently resets inbound connections to a binary
// it can no longer validate — e.g. a `brew upgrade node` deletes the running
// Cellar binary out from under a live process, or lands /opt/homebrew/bin/node on
// a new path that defaults to "block". When that happens the listener still
// reports "Listening …" but is unreachable on the network: a silent outage that
// looks healthy, and launchd's KeepAlive never notices because the process does
// not crash. So we probe our own advertised address on an interval; after
// MAX_CONSECUTIVE_FAILURES sustained failures we exit non-zero and let KeepAlive
// relaunch us, which re-execs the current on-disk node binary and clears the block.
const REACHABILITY_PROBE_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

// Connection-level failures mean the firewall/network dropped us before the
// server could respond. Anything else (e.g. a TLS identity error from the
// internal self-signed CA, or IP-vs-CN mismatch) means we DID reach the
// listener — which is all this check cares about — so it is not an outage.
const UNREACHABLE = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN',
]);

// Probe the advertised address once. Calls back reachable=true if the listener
// answered at all (an HTTP response, or any non-connection error), reachable=false
// only when the connection itself was refused / reset / timed out.
function probeReachable(protocol, target, cb) {
  const client = protocol === 'https' ? https : http;
  const req = client.request(
    { host: target, port: config.port, path: '/health', method: 'GET', timeout: 5000 },
    (res) => { res.resume(); cb(true, `HTTP ${res.statusCode}`); },
  );
  req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
  req.on('error', (err) => {
    const code = err.code || err.message;
    cb(!UNREACHABLE.has(code), code);
  });
  req.end();
}

function startReachabilityMonitor(protocol) {
  const target = config.wireguard_ip;
  // Skip when nothing non-loopback is advertised: loopback isn't firewall-gated,
  // and 0.0.0.0 is a bind wildcard, not a connectable destination.
  if (!target || target === '0.0.0.0' || target === '127.0.0.1' || target === '::1') return;

  const fw = '/usr/libexec/ApplicationFirewall/socketfilterfw';
  let consecutiveFailures = 0;

  const check = (startup) => probeReachable(protocol, target, (reachable, detail) => {
    if (reachable) {
      if (consecutiveFailures > 0) {
        console.log(`Self-check recovered: reachable at ${protocol}://${target}:${config.port} (${detail})`);
      } else if (startup) {
        console.log(`Self-check OK: reachable at ${protocol}://${target}:${config.port} (${detail})`);
      }
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures += 1;
    console.error('!!!!!!!!!!!!!!!!!!!! SELF-CHECK FAILED !!!!!!!!!!!!!!!!!!!!');
    console.error(`!!! ${protocol}://${target}:${config.port} is UNREACHABLE (${detail}) ` +
                  `[${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}]`);
    console.error('!!! The listener is up but inbound connections are being dropped —');
    console.error('!!! most likely the macOS Application Firewall is blocking this node binary,');
    console.error('!!! e.g. after `brew upgrade node` replaced or deleted the running executable.');
    console.error(`!!! Fix: sudo ${fw} --unblockapp ${process.execPath}`);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`Exiting after ${consecutiveFailures} consecutive unreachable probes; ` +
                    'launchd KeepAlive will relaunch on the current on-disk node binary.');
      process.exit(1);
    }
  });

  check(true);
  setInterval(() => check(false), REACHABILITY_PROBE_MS).unref();
}

if (config.tls.cert && config.tls.key) {
  const tlsOpts = {
    cert: readFileSync(config.tls.cert),
    key:  readFileSync(config.tls.key),
  };
  https.createServer(tlsOpts, app).listen(config.port, LISTEN_ADDR, () => onListening('https'));
} else {
  app.listen(config.port, LISTEN_ADDR, () => {
    onListening('http');
    console.warn('WARNING: TLS not configured — running plain HTTP');
  });
}

// Graceful shutdown
process.on('SIGTERM', () => { console.log('SIGTERM received, shutting down'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received, shutting down');  process.exit(0); });
