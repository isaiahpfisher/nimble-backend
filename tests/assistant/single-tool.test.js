// One tool, run straight from a button, with no model and no conversation.
//
// The whole safety of this path is that it reaches read-only tools only. It has
// no confirmation step — that is the part the chat loop does and this one
// deliberately skips — so a write reachable from here is a write nobody agreed
// to. Everything else it does is plumbing; that one property is the test.

const mockNimbleApi = jest.fn();
jest.mock("../../app/assistant/api", () => ({ apiClient: jest.fn(() => mockNimbleApi) }));

const { apiClient } = require("../../app/assistant/api");
const { runSingleTool } = require("../../app/assistant");
const { TOOLS } = require("../../app/assistant/tools");

const story = {
  id: 7,
  title: "Password reset never arrives",
  description: "",
  projectId: 1,
  stateId: 10,
  estimate: null,
};

beforeEach(() => {
  jest.clearAllMocks();

  mockNimbleApi.mockImplementation(async (path) => {
    if (path === "/projects/1/stories/7") return story;
    throw new Error(`Nothing at ${path} (HTTP 404)`);
  });
});

const run = (name, args = {}, context = {}) =>
  runSingleTool({ token: "session-token", userId: 5, name, args, context });

describe("runSingleTool", () => {
  it("runs a read-only tool and returns its result", async () => {
    const outcome = await run("get_story", { projectId: 1, storyId: 7 });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ id: 7, title: "Password reset never arrives" });
  });

  it("acts as the caller, through their own token", async () => {
    await run("get_story", { projectId: 1, storyId: 7 });

    expect(apiClient).toHaveBeenCalledWith("session-token");
  });

  // the property the whole path rests on
  it("refuses every tool that writes", async () => {
    const writes = TOOLS.filter((tool) => tool.write).map((tool) => tool.name);
    expect(writes.length).toBeGreaterThan(0);

    for (const name of writes) {
      const outcome = await run(name, { projectId: 1, storyId: 1, title: "x" });

      expect(outcome).toMatchObject({ ok: false, reason: "readonly" });
      expect(outcome.error).toMatch(new RegExp(`^${name} changes data`));
    }
  });

  it("makes no API call at all when it refuses a write", async () => {
    await run("create_story", { projectId: 1, title: "Should never be created" });

    expect(mockNimbleApi).not.toHaveBeenCalled();
  });

  it("reports an unknown tool as unknown, not as a failure", async () => {
    expect(await run("summon_the_moon")).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("reports bad arguments as something the caller can correct", async () => {
    const outcome = await run("get_story", { projectId: 1 });

    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(outcome.error).toMatch(/storyId/);
  });

  it("reports an API refusal rather than throwing", async () => {
    const outcome = await run("get_story", { projectId: 9, storyId: 1 });

    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(outcome.error).toMatch(/HTTP 404/);
  });

  // a button on a story page should not have to spell out which story
  it("fills a required id in from the page the caller is on", async () => {
    const outcome = await run("get_story", { storyId: 7 }, { projectId: 1 });

    expect(outcome.ok).toBe(true);
  });

  it("lets an explicit argument win over the page", async () => {
    const outcome = await run("get_story", { projectId: 9, storyId: 7 }, { projectId: 1 });

    expect(outcome.error).toMatch(/projects\/9/);
  });
});
