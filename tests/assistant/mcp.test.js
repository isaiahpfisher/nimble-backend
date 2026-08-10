// Nimble as an MCP server.
//
// Driven over a real in-memory transport with a real MCP client, so this
// exercises the protocol rather than the function underneath it: what an
// outside client (Claude Desktop, the inspector) is actually offered.

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const { buildMcpServer, openSession } = require("../../app/assistant");
const { TOOLS } = require("../../app/assistant/tools");
const { fakeApi } = require("./fixture");

/** A client and a server linked in memory, both acting as one user. */
async function connect(userId = 1) {
  const { api, db, calls } = fakeApi(userId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = buildMcpServer({ api, userId });
  const client = new Client({ name: "test", version: "1.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    db,
    calls,
    close: () => Promise.all([client.close(), server.close()]),
  };
}

const textOf = (response) =>
  (response.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");

let session;

afterEach(async () => {
  await session?.close();
  session = null;
});

describe("tools/list", () => {
  it("advertises every tool in the registry", async () => {
    session = await connect();
    const { tools } = await session.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
  });

  it("carries each tool's description and input schema", async () => {
    session = await connect();
    const { tools } = await session.client.listTools();
    const sprints = tools.find((tool) => tool.name === "get_sprints");

    expect(sprints.description).toContain("sprint");
    expect(sprints.inputSchema.properties.projectId).toBeDefined();
    expect(sprints.inputSchema.required).toEqual(["projectId"]);
  });

  it("marks the read-only tools read-only, and the writes not", async () => {
    session = await connect();
    const { tools } = await session.client.listTools();

    const readOnly = (name) => tools.find((tool) => tool.name === name).annotations.readOnlyHint;

    expect(readOnly("get_my_work")).toBe(true);
    expect(readOnly("find_stories")).toBe(true);
    expect(readOnly("create_story")).toBe(false);
    expect(readOnly("add_acceptance_criteria")).toBe(false);
  });
});

describe("tools/call", () => {
  it("returns a result the client can parse back", async () => {
    session = await connect();

    const response = await session.client.callTool({
      name: "get_story",
      arguments: { projectId: 1, storyId: 70 },
    });

    expect(response.isError).toBeFalsy();
    expect(JSON.parse(textOf(response))).toMatchObject({
      id: 70,
      title: "There's an issue with the login page",
      state: "In Progress",
    });
  });

  it("runs a write and it actually lands", async () => {
    session = await connect();

    const response = await session.client.callTool({
      name: "create_story",
      arguments: {
        projectId: 1,
        title: "From an MCP client",
        description: "As a user, when I use MCP, I want it to work, so that I can automate.",
      },
    });

    const created = JSON.parse(textOf(response));
    expect(session.db.rawStories.find((story) => story.id === created.id).title).toBe("From an MCP client");
  });

  it("reports a tool's refusal as an error the client can read", async () => {
    session = await connect();

    const response = await session.client.callTool({
      name: "get_story",
      arguments: { projectId: 1, storyId: 999 },
    });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain("No story 999");
  });

  it("acts as the user it was built for, and no further", async () => {
    // Dan is in Beacon only, so Atlas is not his to read
    session = await connect(7);

    const response = await session.client.callTool({
      name: "get_projects",
      arguments: { projectId: 1 },
    });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain("not a member of project 1");
  });

  it("refuses arguments that do not fit the schema", async () => {
    session = await connect();

    const response = await session.client
      .callTool({ name: "get_story", arguments: { projectId: 1 } })
      .catch((err) => ({ isError: true, content: [{ type: "text", text: err.message }] }));

    expect(response.isError).toBe(true);
  });
});

// This is the road the chat panel actually takes. `openSession` builds an MCP
// client, connects it to Nimble's own MCP server, and every tool the assistant
// runs goes over the protocol — so the path a user exercises on every question
// is the same one Claude Desktop gets.
describe("the client the app itself builds", () => {
  let app;

  const open = async (userId = 1) => {
    const { api, db, calls } = fakeApi(userId);
    app = await openSession({ api, userId });
    return { db, calls };
  };

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("reads its tool list from the protocol, not from the registry", async () => {
    await open();
    const specs = await app.listTools();

    expect(specs.map((spec) => spec.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(40);
      expect(spec.parameters.type).toBe("object");
    }
  });

  it("carries the write flag across, from the server's annotations", async () => {
    await open();
    const writes = (await app.listTools()).filter((spec) => spec.write).map((spec) => spec.name);

    expect(writes.sort()).toEqual(["add_acceptance_criteria", "create_story"]);
  });

  it("tidies the schema the model is shown", async () => {
    await open();
    const story = (await app.listTools()).find((spec) => spec.name === "get_story");

    // the SDK builds inputSchema from Zod, which carries the safe-integer range
    expect(story.parameters.properties.storyId.minimum).toBeUndefined();
    expect(story.parameters.properties.storyId.maximum).toBeUndefined();
    expect(story.parameters.$schema).toBeUndefined();
  });

  it("returns a parsed result, ready for the loop", async () => {
    await open();
    const outcome = await app.callTool("get_story", { projectId: 1, storyId: 70 });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ id: 70, state: "In Progress" });
  });

  it("runs a write over the protocol and it lands", async () => {
    const { db } = await open();

    const outcome = await app.callTool("create_story", {
      projectId: 1,
      title: "Straight through MCP",
      description: "As a user, when I ask the panel, I want it to work, so that I get an answer.",
    });

    expect(outcome.ok).toBe(true);
    expect(db.rawStories.find((story) => story.id === outcome.result.id).title).toBe("Straight through MCP");
  });

  // The loop reads a refusal and corrects itself on the next turn, so neither
  // a tool's complaint nor the protocol's may arrive as an exception.
  it("reports a tool's refusal as an outcome rather than throwing", async () => {
    await open();
    const outcome = await app.callTool("get_story", { projectId: 1, storyId: 999 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("No story 999");
  });

  it("reports arguments that do not fit as an outcome too, without the frame number", async () => {
    await open();
    const outcome = await app.callTool("get_story", { projectId: 1 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toMatch(/^MCP error/);
    expect(outcome.error).toMatch(/storyId/i);
  });

  it("reports an unknown tool as an outcome", async () => {
    await open();
    const outcome = await app.callTool("get_vibes", {});

    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toMatch(/^MCP error/);
  });

  it("defaults missing arguments to an empty object", async () => {
    await open();
    const outcome = await app.callTool("get_my_work");

    expect(outcome.ok).toBe(true);
    expect(outcome.result.assigned).toBeDefined();
  });

  it("is bound to its own user, so it sees only what they can", async () => {
    await open(7); // Dan is in Beacon only
    const outcome = await app.callTool("get_projects", { projectId: 1 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("not a member of project 1");
  });

  it("closes cleanly, so a session does not outlive its request", async () => {
    await open();
    await app.close();

    await expect(app.callTool("get_my_work", {})).resolves.toMatchObject({ ok: false });
    app = null;
  });
});
