const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const { runConversation, cohereClient, DEFAULT_MODEL, DEFAULT_MAX_TURNS } = require("./chat");
const { KINDS, runGeneration } = require("./generate");
const { TOOLS, apiClient, runTool, tidySchema } = require("./tools");

// ctx = { api, userId }
function buildMcpServer(ctx) {
  const server = new McpServer({ name: "nimble", version: "1.0.0" });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: { readOnlyHint: !tool.write },
      },
      async (args) => {
        const outcome = await runTool(tool.name, args, ctx);

        return outcome.ok
          ? { content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }] }
          : { content: [{ type: "text", text: outcome.error }], isError: true };
      },
    );
  }

  return server;
}

// convert array of MCP blocks to a single string
const textOf = (response) =>
  (response.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

// strip unhelpful "MCP error -32602: ..." from the model's error message
const PROTOCOL_PREFIX = /^MCP error -?\d+:\s*/;
const plainify = (message) =>
  String(message ?? "")
    .replace(PROTOCOL_PREFIX, "")
    .trim();

// cache tool list/specs
// no need to ask for them every time
let cachedSpecs = null;

async function readSpecs(client) {
  if (!cachedSpecs) {
    const { tools } = await client.listTools();

    // format tool specs for the Cohere
    cachedSpecs = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tidySchema(tool.inputSchema),
      write: !tool.annotations?.readOnlyHint,
    }));
  }

  return cachedSpecs;
}

// ctx = { api, userId }
async function openSession(ctx) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(ctx);
  const client = new Client({ name: "nimble-assistant", version: "1.0.0" });

  // open both connections in parallel
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    listTools: () => readSpecs(client),

    callTool: async (name, args) => {
      let response;
      try {
        response = await client.callTool({ name, arguments: args ?? {} });
      } catch (err) {
        return { ok: false, error: plainify(err.message) };
      }

      if (response.isError) return { ok: false, error: plainify(textOf(response)) || `${name} failed.` };

      const text = textOf(response);
      try {
        return { ok: true, result: JSON.parse(text) };
      } catch {
        return { ok: true, result: text };
      }
    },

    close: () => Promise.all([client.close(), server.close()]),
  };
}

// token = bearer token of caller
// user = { id, firstName, lastName }
// messages = history of back-and-forth messages
// context = what's on the user's screen (projectId, storyId, sprintId)
async function runChat({ token, user, messages, context }) {
  const ctx = { api: apiClient(token), userId: user?.id ?? null };

  // open session to connect to MCP Server
  const session = await openSession(ctx);

  try {
    return await runConversation({
      cohere: cohereClient(),
      tools: await session.listTools(),
      callTool: session.callTool,
      user,
      messages,
      context,
      model: process.env.COHERE_MODEL || DEFAULT_MODEL,
      maxTurns: Number(process.env.ASSISTANT_MAX_TURNS) || DEFAULT_MAX_TURNS,
    });
  } finally {
    await session.close();
  }
}

module.exports = {
  runChat,
  runGeneration,
  buildMcpServer,
  openSession,
  apiClient,
  GENERATION_KINDS: KINDS,
};
