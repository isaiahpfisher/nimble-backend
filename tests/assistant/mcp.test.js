// The assistant reaches its tools over MCP, in memory, rather than calling the
// registry directly. That hop is only worth its keep if it is faithful: the
// same tools, the same schemas, the same results, and refusals the model can
// still read and correct. This pins all four, and pins the assistant's view to
// the one an outside client gets.

const { buildMcpServer, openSession } = require("../../app/assistant/mcp");
const { TOOLS, toolSpecs } = require("../../app/assistant/tools");

const project = {
  id: 1,
  title: "Atlas",
  storyState: [
    { id: 10, name: "Not Started", order: 0 },
    { id: 11, name: "Done", order: 3 },
  ],
  storyType: [{ id: 20, name: "Bug" }],
  projectMembers: [{ userId: 5, user: { firstName: "Erin", lastName: "Engineer", email: "erin@x.com" } }],
  sprint: [],
  repository: [],
  completedStateId: 11,
};

/** A stand-in Nimble API, so a session can be driven without a server. */
function mockApi(routes = {}) {
  return jest.fn(async (path, options = {}) => {
    const key = `${options.method ?? "GET"} ${path}`;
    if (key in routes) {
      const value = routes[key];
      return typeof value === "function" ? value(options.body) : value;
    }
    throw new Error(`Nothing at ${path} (HTTP 404)`);
  });
}

const ctx = (routes) => ({ api: mockApi({ "GET /projects/1": project, ...routes }), userId: 5 });

/** Runs `work` against an open session and always closes it. */
async function withSession(context, work) {
  const session = await openSession(context);
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

describe("what the protocol advertises", () => {
  it("offers every tool the registry has, and nothing else", async () => {
    const specs = await withSession(ctx(), (session) => session.listTools());

    expect(specs.map((spec) => spec.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
  });

  // the panel marks a write differently, and the prompt only offers to change
  // things when it is told it can, so this flag has to survive the crossing
  it("keeps the write flag, carried as readOnlyHint", async () => {
    const specs = await withSession(ctx(), (session) => session.listTools());
    const writes = specs.filter((spec) => spec.write).map((spec) => spec.name).sort();

    expect(writes).toEqual(TOOLS.filter((tool) => tool.write).map((tool) => tool.name).sort());
  });

  // the model is shown what tools/list says, so the noise has to come off there
  // too — not only on the way out of the registry
  it("strips the schema noise before the model sees it", async () => {
    const specs = await withSession(ctx(), (session) => session.listTools());
    const json = JSON.stringify(specs);

    expect(json).not.toContain("9007199254740991");
    expect(json).not.toContain("$schema");
  });

  it("describes each tool well enough to choose it", async () => {
    const specs = await withSession(ctx(), (session) => session.listTools());

    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(40);
      expect(spec.parameters.type).toBe("object");
    }
  });

  // the whole reason the assistant goes through MCP: one advertisement, so
  // Claude Desktop and Cohere cannot be looking at different tools
  it("matches what the registry would have offered directly", async () => {
    const specs = await withSession(ctx(), (session) => session.listTools());
    const byName = new Map(specs.map((spec) => [spec.name, spec]));

    for (const direct of toolSpecs()) {
      expect(byName.get(direct.name).parameters).toEqual(direct.parameters);
    }
  });
});

describe("results coming back", () => {
  it("hands back an object as an object, not as text", async () => {
    const outcome = await withSession(ctx(), (session) =>
      session.callTool("get_project", { projectId: 1 }),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ id: 1, title: "Atlas" });
    expect(outcome.result.states).toEqual([
      { id: 10, name: "Not Started", order: 0 },
      { id: 11, name: "Done", order: 3 },
    ]);
  });

  // structuredContent has to be an object, so a list travels as text and is
  // parsed back — it must still arrive as an array
  it("hands back a list as a list", async () => {
    const outcome = await withSession(
      ctx({ "GET /projects/1/sprints": [{ id: 3, title: "Sprint 3", status: "Active" }] }),
      (session) => session.callTool("list_sprints", { projectId: 1 }),
    );

    expect(outcome.ok).toBe(true);
    expect(Array.isArray(outcome.result)).toBe(true);
    expect(outcome.result[0]).toMatchObject({ id: 3, title: "Sprint 3" });
  });
});

describe("refusals the model has to be able to act on", () => {
  it("reports an API failure as an outcome, carrying its message", async () => {
    const outcome = await withSession(ctx(), (session) =>
      session.callTool("get_project", { projectId: 99 }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Nothing at /projects/99");
    // the protocol's own framing is no use to the model
    expect(outcome.error).not.toContain("MCP error");
  });

  // the protocol answers an unknown name with little more than the name; the
  // way out is the list of names that do exist
  it("answers an unknown tool with the ones that exist", async () => {
    const outcome = await withSession(ctx(), (session) => session.callTool("delete_everything", {}));

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('There is no tool called "delete_everything"');
    expect(outcome.error).toContain("get_project");
  });

  it("turns arguments that do not fit into something readable", async () => {
    const outcome = await withSession(ctx(), (session) =>
      session.callTool("get_project", { projectId: "the first one" }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/projectId/);
    expect(outcome.error).not.toContain("MCP error");
  });

  it("never throws, whatever it is handed", async () => {
    await withSession(ctx(), async (session) => {
      await expect(session.callTool("get_project", undefined)).resolves.toMatchObject({ ok: false });
      await expect(session.callTool("", {})).resolves.toMatchObject({ ok: false });
    });
  });
});

// a session carries one user's token; two callers must not share one
describe("who a session acts as", () => {
  it("binds each session to its own caller", async () => {
    const erin = ctx();
    const other = ctx();

    await withSession(erin, (session) => session.callTool("get_project", { projectId: 1 }));
    await withSession(other, (session) => session.callTool("get_project", { projectId: 1 }));

    expect(erin.api).toHaveBeenCalledTimes(1);
    expect(other.api).toHaveBeenCalledTimes(1);
  });

  it("stops answering once it is closed", async () => {
    const session = await openSession(ctx());
    await session.close();

    await expect(session.callTool("get_project", { projectId: 1 })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("the server the stdio adapter serves", () => {
  it("builds without a transport, so mcp/server.mjs only has to connect one", () => {
    const server = buildMcpServer(ctx());

    expect(typeof server.connect).toBe("function");
  });
});
