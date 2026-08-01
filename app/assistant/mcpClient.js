const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const SERVER_PATH = path.join(__dirname, "..", "..", "mcp", "server.mjs");

/**
 * Starts an MCP server as a child process acting as one specific user, and
 * returns a small facade over it.
 *
 * The child is given the caller's own bearer token, so every tool it runs is
 * scoped by the same authorization the REST API applies to that user. Nothing
 * here needs to re-check permissions.
 *
 * The caller MUST close() the result on every path, including failures — an
 * unclosed transport leaves an orphaned node process behind, and on a
 * long-lived server those accumulate until it runs out of memory.
 *
 * @param {string} token   bearer token of the user the assistant acts as
 * @param {number} userId  that user's id; the API has no /users/me, so tools
 *                         answering "what is assigned to me" need it passed in
 */
async function connectAsUser(token, userId) {
  const transport = new StdioClientTransport({
    command: process.execPath, // the same node binary running this process
    args: [SERVER_PATH],
    env: {
      // a bare env: the child needs nothing from this process except these
      PATH: process.env.PATH,
      NIMBLE_TOKEN: token,
      NIMBLE_USER_ID: String(userId),
      NIMBLE_API_URL:
        process.env.NIMBLE_API_URL ||
        `http://localhost:${process.env.PORT || 3200}/nimbleapi`,
    },
    stderr: "inherit", // the server logs diagnostics to stderr; let them through
  });

  const client = new Client({ name: "nimble-assistant", version: "0.1.0" });

  try {
    await client.connect(transport);
  } catch (err) {
    // connect() may fail after spawning; don't leak the child
    await transport.close().catch(() => {});
    throw err;
  }

  let closed = false;

  return {
    /**
     * The tools this user's server offers, as MCP advertises them.
     */
    async listTools() {
      const { tools } = await client.listTools();
      return tools;
    },

    /**
     * Runs one tool. A tool that fails returns an MCP result with isError set
     * rather than throwing, so the model can read the failure and recover.
     */
    async callTool(name, args) {
      return client.callTool({ name, arguments: args ?? {} });
    },

    /**
     * Safe to call more than once, which matters because cleanup runs from
     * both the finally block and the request-close handler.
     */
    async close() {
      if (closed) return;
      closed = true;
      await client.close().catch(() => {});
    },
  };
}

module.exports = { connectAsUser, SERVER_PATH };
