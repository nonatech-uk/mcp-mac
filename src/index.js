/**
 * mac-mcp — NonaTech Mac MCP Server
 *
 * Exposes Apple data and local Mac facilities over SSE/HTTP for the
 * NAS gateway to consume over WireGuard.
 *
 * Endpoints:
 *   GET  /health   → priority beacon for gateway routing
 *   GET  /sse      → MCP SSE transport (gateway connects here)
 *   POST /messages → MCP message posting
 */

import { readFileSync } from 'fs';
import https from 'https';
import express from 'express';
import { Server }           from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
];

const TOOL_MAP = new Map(ALL_TOOLS.map(t => [t.name, t]));

// ─── MCP Server ───────────────────────────────────────────────────────────────

const mcpServer = new Server(
  { name: `mac-mcp-${config.hostname}`, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
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

// ─── Express + SSE transport ──────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Bearer token auth — reject requests without the correct key
if (config.api_key) {
  app.use((req, res, next) => {
    // Health endpoint is unauthenticated (gateway needs it for probing)
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

// Health beacon — gateway polls this to decide routing priority
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

// Direct REST endpoint for gateway tool invocation (no SSE needed)
app.post('/tool', async (req, res) => {
  const { name, arguments: args } = req.body;
  const tool = TOOL_MAP.get(name);

  if (!tool) {
    res.status(404).json({ error: `Unknown tool: ${name}` });
    return;
  }

  try {
    const result = await tool.handler(args ?? {});
    res.json(result);
  } catch (err) {
    console.error(`[${name}] error:`, err);
    res.status(500).json({ error: `${name}: ${err.message}` });
  }
});

// Tool listing for gateway discovery
app.get('/tools', (_req, res) => {
  res.json(ALL_TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })));
});

// Active SSE sessions keyed by sessionId
const transports = {};

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on('close', () => {
    console.log(`[sse] client disconnected: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  console.log(`[sse] client connected: ${transport.sessionId}`);
  await mcpServer.connect(transport);
});

app.post('/messages', async (req, res) => {
  const { sessionId } = req.query;
  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).json({ error: `No session: ${sessionId}` });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ─── Start ────────────────────────────────────────────────────────────────────

const LISTEN_ADDR = config.wireguard_ip || '127.0.0.1';
const useTLS = config.tls.cert && config.tls.key;

const server = useTLS
  ? https.createServer(
      { cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) },
      app,
    )
  : app;

const scheme = useTLS ? 'https' : 'http';

server.listen(config.port, LISTEN_ADDR, () => {
  console.log(`mac-mcp [${config.hostname}] priority=${config.priority}`);
  console.log(`Listening on ${scheme}://${LISTEN_ADDR}:${config.port}`);
  console.log(`Tools registered: ${ALL_TOOLS.length}`);
  if (useTLS) console.log('TLS enabled');
  if (config.api_key) console.log('API key auth enabled');
  console.log('Health: GET /health');
  console.log('SSE:    GET /sse');
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('SIGTERM received, shutting down'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received, shutting down');  process.exit(0); });
