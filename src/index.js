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

const LISTEN_ADDR = config.wireguard_ip || '127.0.0.1';

app.listen(config.port, LISTEN_ADDR, () => {
  console.log(`mac-mcp [${config.hostname}] priority=${config.priority}`);
  console.log(`Listening on http://${LISTEN_ADDR}:${config.port}`);
  console.log(`Tools registered: ${ALL_TOOLS.length}`);
  if (config.api_key) console.log('API key auth enabled');
  console.log('Health: GET /health');
  console.log('MCP:    /mcp');
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('SIGTERM received, shutting down'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received, shutting down');  process.exit(0); });
