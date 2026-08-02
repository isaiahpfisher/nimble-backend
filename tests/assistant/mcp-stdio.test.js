// mcp/server.mjs is the one file nothing else imports: an ESM entry point,
// launched by hand, that reaches across the CommonJS boundary into the app. It
// is exactly the kind of file that rots quietly, so it is booted here for real
// — as a child process, over a pipe — rather than trusted to keep working.
//
// No Nimble API is needed: listing tools never calls one.

const path = require("node:path");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const { TOOLS } = require("../../app/assistant/tools");

const SERVER = path.join(__dirname, "..", "..", "mcp", "server.mjs");

/** Boots the adapter the way an outside client does, and always shuts it down. */
async function withServer(env, work) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { PATH: process.env.PATH, ...env },
    stderr: "pipe",
  });

  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);

  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

// spawning a node process is slower than the default 5s allows on a cold cache
jest.setTimeout(30000);

describe("the stdio adapter", () => {
  it("boots and serves the whole registry to an outside client", async () => {
    const { tools } = await withServer({ NIMBLE_TOKEN: "test-token", NIMBLE_USER_ID: "5" }, (client) =>
      client.listTools(),
    );

    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
  });

  // an outside client decides what to allow from this hint, so a write must
  // never arrive looking read-only
  it("marks the writes as writes", async () => {
    const { tools } = await withServer({ NIMBLE_TOKEN: "test-token" }, (client) => client.listTools());

    const readOnly = new Set(
      tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name),
    );

    for (const tool of TOOLS) {
      expect(readOnly.has(tool.name)).toBe(!tool.write);
    }
  });

  // the token is the only thing standing between this server and someone
  // else's data, so starting without one has to be fatal, not silent
  it("refuses to start without a token", async () => {
    await expect(withServer({}, (client) => client.listTools())).rejects.toThrow();
  });
});
