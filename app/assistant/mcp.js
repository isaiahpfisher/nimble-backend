// Nimble as an MCP server, and the assistant as one of its clients.
//
// The assistant does not reach into the tool registry directly. It speaks the
// same protocol an outside client speaks, to the same server an outside client
// connects to. That is the point: there is one road to the tools, so the path
// the app exercises on every question is the path Claude Desktop gets, and the
// two cannot quietly drift apart.
//
// The transport is in-memory — a linked pair of streams inside this process.
// No subprocess, no socket, no pipe. Standing up a whole client-and-server pair
// costs well under a millisecond, which is what makes it affordable to build
// one per request, and per request is what we need: each session is bound to
// the caller's own token and may see only what they can see.
//
//   runChat -> openSession(ctx) -> MCP -> tool registry -> Nimble's REST API
//   mcp/server.mjs -> buildMcpServer(ctx) -> stdio -> an outside client

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const { TOOLS, runTool, tidySchema } = require("./tools");

const SERVER_INFO = { name: "nimble", version: "1.0.0" };
const CLIENT_INFO = { name: "nimble-assistant", version: "1.0.0" };

const KNOWN = new Set(TOOLS.map((tool) => tool.name));

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A tool's outcome in the shape the protocol carries it. */
function respond(outcome) {
  if (!outcome.ok) return { content: [{ type: "text", text: outcome.error }], isError: true };

  return {
    content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }],
    // structuredContent has to be an object, so a tool that answers with a
    // list travels as text alone and is parsed back on arrival. Either way the
    // payload is plain JSON, so nothing is lost in the crossing.
    ...(isPlainObject(outcome.result) && { structuredContent: outcome.result }),
  };
}

/**
 * An McpServer offering every tool in the registry, acting as one user.
 *
 * @param {object} ctx  { api, userId } — see app/assistant/api.js
 */
function buildMcpServer(ctx) {
  const server = new McpServer(SERVER_INFO);

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: { readOnlyHint: !tool.write },
      },
      async (args) => respond(await runTool(tool.name, args, ctx)),
    );
  }

  return server;
}

const textOf = (response) =>
  (response.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

// "MCP error -32602: ..." is true and unhelpful; the model needs the complaint,
// not the frame number it arrived in.
const PROTOCOL_PREFIX = /^MCP error -?\d+:\s*/;

/**
 * A refusal, rewritten as something the model can act on.
 *
 * The protocol answers an unknown tool with little more than the name it did
 * not recognise. The model's way out of that is the list of names that do
 * exist, so it is put back.
 */
function readError(response, name) {
  if (!KNOWN.has(name)) {
    return `There is no tool called "${name}". Available: ${[...KNOWN].join(", ")}.`;
  }

  return textOf(response).replace(PROTOCOL_PREFIX, "").trim() || `${name} failed.`;
}

/** The result, preferring the structured copy and falling back to the text. */
function readResult(response) {
  if (response.structuredContent !== undefined) return response.structuredContent;

  const text = textOf(response);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The advertised tools cannot change while the process runs, so the first
// answer is kept rather than re-asked on every request.
let cachedSpecs = null;

/**
 * What the model is shown, read from tools/list rather than from the registry.
 *
 * Taking it from the protocol is what keeps the assistant honest: it is looking
 * at the same advertisement an outside client is, down to the schema.
 */
async function readSpecs(client) {
  if (!cachedSpecs) {
    const { tools } = await client.listTools();

    cachedSpecs = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tidySchema(tool.inputSchema),
      write: !tool.annotations?.readOnlyHint,
    }));
  }

  return cachedSpecs;
}

/**
 * A client and a server, linked in memory, both acting as one user.
 *
 * `callTool` reports an outcome rather than throwing, matching what the loop
 * expects from any tool source: a refusal is something the model reads and
 * corrects on its next turn, not an exception that ends the answer.
 *
 * The caller owns the session and must `close()` it.
 *
 * @param {object} ctx  { api, userId } — see app/assistant/api.js
 */
async function openSession(ctx) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(ctx);
  const client = new Client(CLIENT_INFO);

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    listTools: () => readSpecs(client),

    callTool: async (name, args) => {
      let response;
      try {
        response = await client.callTool({ name, arguments: args ?? {} });
      } catch (err) {
        // the transport itself failed, which is ours to report, not the
        // model's to correct
        return { ok: false, error: err.message };
      }

      return response.isError
        ? { ok: false, error: readError(response, name) }
        : { ok: true, result: readResult(response) };
    },

    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  };
}

module.exports = { buildMcpServer, openSession, SERVER_INFO };
