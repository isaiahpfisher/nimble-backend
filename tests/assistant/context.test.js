// Page context is applied as a default, not asked for as an instruction.
//
// The failure this exists to stop: the model calling list_sprints({}) while
// looking straight at a project, getting a validation error, and apologising
// instead of correcting.

const {
  applyContext,
  requiredContextFields,
  withPageContext,
} = require("../../app/assistant/context");

const spec = (name, { required = [], properties = {} } = {}) => ({
  name,
  parameters: { type: "object", properties, required },
});

const LIST_SPRINTS = spec("list_sprints", {
  required: ["projectId"],
  properties: { projectId: { type: "integer" } },
});

// omitting projectId here means "every project I belong to", which is an answer
// in its own right
const FIND_STALE = spec("find_stale_stories", {
  required: [],
  properties: { projectId: { type: "integer" }, days: { type: "integer" } },
});

const GET_MY_WORK = spec("get_my_work");

describe("requiredContextFields", () => {
  it("picks up the page fields a tool cannot work without", () => {
    const map = requiredContextFields([LIST_SPRINTS]);
    expect(map.get("list_sprints")).toEqual(["projectId"]);
  });

  it("ignores a page field the tool merely accepts", () => {
    const map = requiredContextFields([FIND_STALE]);
    expect(map.get("find_stale_stories")).toEqual([]);
  });

  it("ignores fields that are not page context at all", () => {
    const map = requiredContextFields([
      spec("create_story", { required: ["projectId", "title", "description"] }),
    ]);
    expect(map.get("create_story")).toEqual(["projectId"]);
  });

  it("handles a tool that takes no arguments", () => {
    expect(requiredContextFields([GET_MY_WORK]).get("get_my_work")).toEqual([]);
  });
});

describe("applyContext", () => {
  it("fills a required field the model left out", () => {
    expect(applyContext({}, ["projectId"], { projectId: 7 })).toEqual({ projectId: 7 });
  });

  it("leaves the model's own value alone", () => {
    expect(applyContext({ projectId: 2 }, ["projectId"], { projectId: 7 })).toEqual({ projectId: 2 });
  });

  it("treats an explicit null as absent, since it would fail validation anyway", () => {
    expect(applyContext({ projectId: null }, ["projectId"], { projectId: 7 })).toEqual({ projectId: 7 });
  });

  it("fills nothing when the page has no such context", () => {
    expect(applyContext({}, ["projectId"], { projectId: null })).toEqual({});
  });

  it("keeps every other argument untouched", () => {
    const args = { stateId: 3, search: "login" };
    expect(applyContext(args, ["projectId"], { projectId: 7 })).toEqual({
      stateId: 3,
      search: "login",
      projectId: 7,
    });
  });

  it("fills several fields at once", () => {
    const filled = applyContext({}, ["projectId", "storyId"], { projectId: 1, storyId: 9 });
    expect(filled).toEqual({ projectId: 1, storyId: 9 });
  });
});

describe("withPageContext", () => {
  const context = { projectId: 1, storyId: null, sprintId: null };

  it("rescues the call that started all this", async () => {
    const callTool = jest.fn(async () => ({ ok: true, result: [] }));
    const wrapped = withPageContext(callTool, [LIST_SPRINTS], context);

    await wrapped("list_sprints", {});

    expect(callTool).toHaveBeenCalledWith("list_sprints", { projectId: 1 });
  });

  it("does not narrow a tool that deliberately spans every project", async () => {
    const callTool = jest.fn(async () => ({ ok: true, result: {} }));
    const wrapped = withPageContext(callTool, [FIND_STALE], context);

    await wrapped("find_stale_stories", { days: 30 });

    expect(callTool).toHaveBeenCalledWith("find_stale_stories", { days: 30 });
  });

  it("passes an unknown tool through untouched, so the registry still refuses it", async () => {
    const callTool = jest.fn(async () => ({ ok: false, error: "no such tool" }));
    const wrapped = withPageContext(callTool, [LIST_SPRINTS], context);

    await wrapped("nonsense", { a: 1 });

    expect(callTool).toHaveBeenCalledWith("nonsense", { a: 1 });
  });

  it("copes with the model sending no arguments at all", async () => {
    const callTool = jest.fn(async () => ({ ok: true, result: [] }));
    const wrapped = withPageContext(callTool, [LIST_SPRINTS], context);

    await wrapped("list_sprints", undefined);

    expect(callTool).toHaveBeenCalledWith("list_sprints", { projectId: 1 });
  });

  it("fills nothing when the user is not on a project page", async () => {
    const callTool = jest.fn(async () => ({ ok: false, error: "needs projectId" }));
    const wrapped = withPageContext(callTool, [LIST_SPRINTS], { projectId: null });

    await wrapped("list_sprints", {});

    expect(callTool).toHaveBeenCalledWith("list_sprints", {});
  });
});
