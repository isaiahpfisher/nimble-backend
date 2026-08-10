import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import assistant from "../app/assistant/index.js";

const { apiClient, buildMcpServer } = assistant;

const TOKEN = process.env.NIMBLE_TOKEN;
const USER_ID = process.env.NIMBLE_USER_ID ? Number(process.env.NIMBLE_USER_ID) : null;

if (!TOKEN) {
  console.error("NIMBLE_TOKEN is required. Pass the bearer token of the user this server acts as.");
  process.exit(1);
}

const server = buildMcpServer({ api: apiClient(TOKEN), userId: USER_ID });

await server.connect(new StdioServerTransport());
console.error("[nimble-mcp] ready");
