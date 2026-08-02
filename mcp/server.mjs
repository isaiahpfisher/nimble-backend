#!/usr/bin/env node
//
// Nimble as an MCP server, over stdio, for external clients — Claude Desktop,
// the MCP inspector, anything that speaks the protocol.
//
// It is the transport and nothing else. The server itself is built by
// app/assistant/mcp.js, which is also what the in-app assistant connects to
// over an in-memory transport, so the two can never drift apart: an outside
// client is offered exactly the tools, schemas and results the assistant gets.
//
// Every tool reaches Nimble through its REST API using the bearer token given
// here, so this server can see exactly what that token's owner can see, and
// nothing else.
//
//   NIMBLE_TOKEN=<token> NIMBLE_USER_ID=<id> npm run mcp
//
// ---------------------------------------------------------------------------
// stdout is the protocol channel. Never console.log() here — a stray write
// corrupts the JSON-RPC stream and the client disconnects. stderr is free.
// ---------------------------------------------------------------------------

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// The app is CommonJS; Node's interop hands the whole module over as default.
import assistantApi from "../app/assistant/api.js";
import assistantMcp from "../app/assistant/mcp.js";

const { apiClient } = assistantApi;
const { buildMcpServer } = assistantMcp;

const TOKEN = process.env.NIMBLE_TOKEN;

// The API has no /users/me, so the token alone cannot say who we are acting as.
// Only get_my_work needs it, and it says so plainly when it is missing.
const USER_ID = process.env.NIMBLE_USER_ID ? Number(process.env.NIMBLE_USER_ID) : null;

if (!TOKEN) {
  console.error("NIMBLE_TOKEN is required. Pass the bearer token of the user this server acts as.");
  process.exit(1);
}

const server = buildMcpServer({ api: apiClient(TOKEN), userId: USER_ID });

await server.connect(new StdioServerTransport());
console.error("[nimble-mcp] ready");
