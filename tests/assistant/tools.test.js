// The registry is the contract between the model and Nimble's API: it decides
// what the model is offered, refuses arguments that do not fit, and turns every
// failure into something the model can read and correct.

const { TOOLS, toolSpecs, runTool } = require("../../app/assistant/tools");
const { STORY_DESCRIPTION, CRITERION_DESCRIPTION } = require("../../app/assistant/rules");

/** A stand-in Nimble API, so a tool can be run without a server. */
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

describe("the tool list", () => {
  it("gives every tool a name, a description and a schema", () => {
    for (const spec of toolSpecs()) {
      expect(spec.name).toMatch(/^[a-z_]+$/);
      expect(spec.description.length).toBeGreaterThan(40);
      expect(spec.parameters.type).toBe("object");
    }
  });

  it("has no two tools with the same name", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // deleting is off-limits by construction, not by instruction
  it("offers nothing that deletes", () => {
    expect(TOOLS.filter((tool) => /delete|remove|destroy/.test(tool.name))).toEqual([]);
  });

  // the safe-integer bounds Zod emits for every int are true, useless, and
  // repeated in every definition the model has to read
  it("does not ship the schema noise Zod adds to integers", () => {
    const json = JSON.stringify(toolSpecs());

    expect(json).not.toContain("9007199254740991");
    expect(json).not.toContain("$schema");
  });

  // The house style for the two prose fields the assistant ever composes. It
  // has to reach the model on the field itself, not only in the prompt — that
  // is what it is reading while it fills the argument in.
  describe("the description formats", () => {
    const describes = (name, field) => {
      const { properties } = toolSpecs().find((spec) => spec.name === name).parameters;
      // add_acceptance_criteria takes a list, so its prose field hangs off the
      // array's items rather than off the tool itself
      return (properties.criteria?.items?.properties ?? properties)[field].description;
    };

    it.each(["create_story", "update_story"])("puts the user story shape on %s", (name) => {
      expect(describes(name, "description")).toContain(STORY_DESCRIPTION);
    });

    it.each(["add_acceptance_criteria", "update_acceptance_criterion"])(
      "puts Given/When/Then on %s",
      (name) => {
        expect(describes(name, "description")).toContain(CRITERION_DESCRIPTION);
      },
    );

    it("keeps both formats stated in exactly one place", () => {
      expect(STORY_DESCRIPTION).toBe("As a <who>, when I <when>, I want to <what>, so that <why>.");
      expect(CRITERION_DESCRIPTION).toBe("Given <starting state>, when <action>, then <observable result>.");
    });
  });
});

describe("runTool", () => {
  it("names the alternatives when asked for a tool that does not exist", async () => {
    const outcome = await runTool("delete_everything", {}, ctx());

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.error).toMatch(/no tool called "delete_everything"/);
    expect(outcome.error).toMatch(/get_story/);
  });

  it("refuses arguments that do not fit the schema, saying which", async () => {
    const outcome = await runTool("get_story", { projectId: "one" }, ctx());

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/projectId/);
    expect(outcome.error).toMatch(/storyId/);
  });

  it("applies the schema's defaults rather than making the model send them", async () => {
    const api = mockApi({ "GET /projects/1/stories/7/activity": [] });
    await runTool("get_story_activity", { projectId: 1, storyId: 7 }, { api, userId: 5 });

    // limit defaults to 30 and is applied here, not asked for
    expect(api).toHaveBeenCalledWith("/projects/1/stories/7/activity");
  });

  it("reports an API failure as a value, not an exception", async () => {
    const outcome = await runTool("get_story", { projectId: 9, storyId: 1 }, ctx());

    expect(outcome).toEqual({ ok: false, error: "Nothing at /projects/9/stories/1 (HTTP 404)" });
  });

  it("drops fields the model made up rather than forwarding them", async () => {
    const api = mockApi({ "GET /projects/1/backlog": [] });
    await runTool("get_backlog", { projectId: 1, sortBy: "vibes" }, { api, userId: 5 });

    expect(api).toHaveBeenCalledWith("/projects/1/backlog");
  });
});

describe("who is on my projects", () => {
  const member = (userId, name, isManager) => ({
    userId,
    isManager,
    user: { firstName: name, lastName: "X", email: `${name.toLowerCase()}@x.com` },
  });

  const boards = {
    "GET /users/me/projects": [
      { id: 3, title: "Atlas" },
      { id: 4, title: "Nimble" },
    ],
    "GET /projects/3": {
      id: 3,
      title: "Atlas",
      projectMembers: [member(5, "Isaiah", "0"), member(2, "Frank", "1"), member(9, "Dana", "1")],
    },
    "GET /projects/4": {
      id: 4,
      title: "Nimble",
      projectMembers: [member(5, "Isaiah", "1"), member(2, "Frank", "1")],
    },
  };

  const people = (routes = boards) => ({ api: mockApi(routes), userId: 5 });

  // the headline question, answered without being told which project
  it("rolls managers up across every project, each listed once", async () => {
    const { result } = await runTool("get_people", {}, people());

    expect(result.managers.map((m) => [m.name, m.manages])).toEqual([
      ["Frank X", ["Atlas", "Nimble"]],
      ["Dana X", ["Atlas"]],
      ["Isaiah X", ["Nimble"]],
    ]);
  });

  // so the assistant does not report the user as their own manager
  it("flags the user among them rather than hiding them", async () => {
    const { result } = await runTool("get_people", {}, people());

    expect(result.managers.find((m) => m.name === "Isaiah X").isYou).toBe(true);
    expect(result.managers.find((m) => m.name === "Frank X").isYou).toBe(false);
  });

  it("narrows to one project when asked", async () => {
    const { result } = await runTool("get_people", { projectId: 3 }, people());

    expect(result.projects.map((p) => p.title)).toEqual(["Atlas"]);
    expect(result.managers.map((m) => m.name)).toEqual(["Frank X", "Dana X"]);
  });

  it("carries each project's url, so the answer can link it", async () => {
    const { result } = await runTool("get_people", { projectId: 4 }, people());

    expect(result.projects[0]).toMatchObject({ id: 4, title: "Nimble", url: "/projects/4" });
  });

  it("says so plainly when a project has no manager at all", async () => {
    const { result } = await runTool("get_people", { projectId: 3 }, people({
      ...boards,
      "GET /projects/3": { id: 3, title: "Atlas", projectMembers: [member(5, "Isaiah", "0")] },
    }));

    expect(result.managers).toEqual([]);
    expect(result.projects[0].people).toHaveLength(1);
  });

  it("refuses a project they do not belong to, naming the ones they do", async () => {
    const outcome = await runTool("get_people", { projectId: 99 }, people());

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.error).toMatch(/not a member of project 99/);
    expect(outcome.error).toMatch(/3 = Atlas, 4 = Nimble/);
  });

  it("answers on the projects it can read when one of them fails", async () => {
    const { api } = people();
    const flaky = jest.fn(async (path, options) => {
      if (path === "/projects/4") throw new Error("Boom (HTTP 500)");
      return api(path, options);
    });

    const { result } = await runTool("get_people", {}, { api: flaky, userId: 5 });

    expect(result.projects.map((p) => p.title)).toEqual(["Atlas"]);
  });

  // isManager is a STRING column and the update endpoint writes what it is sent
  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["", false],
    [undefined, false],
  ])("reads isManager %s as %s", async (flag, expected) => {
    const { result } = await runTool("get_people", { projectId: 3 }, people({
      ...boards,
      "GET /projects/3": { id: 3, title: "Atlas", projectMembers: [member(2, "Frank", flag)] },
    }));

    expect(result.projects[0].people[0].isManager).toBe(expected);
  });
});

describe("creating a story", () => {
  const created = (body) => ({ id: 7, projectId: 1, ...body });
  const story = (fields) => ({
    projectId: 1,
    title: "Login bug",
    description: "As a user, when I sign in, I want the page to load, so that I can reach my work.",
    ...fields,
  });

  it("fills in the defaults and says which it filled", async () => {
    const outcome = await runTool("create_story", story(), ctx({ "POST /projects/1/stories": created }));

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({
      created: "story",
      defaulted: ["stateId"],
      stateId: 10,
      url: "/projects/1/stories/7",
    });
  });

  // the description is the assistant's to write, so the tool will not accept a
  // story without one rather than quietly filing the title as the description
  it("refuses to create a story with no description", async () => {
    const outcome = await runTool("create_story", { projectId: 1, title: "Login bug" }, ctx());

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.error).toMatch(/description/);
  });

  it("saves the description exactly as given", async () => {
    const dictated = "As a reviewer, when I open a PR, I want the checks listed, so that I can act.";
    const api = mockApi({ "GET /projects/1": project, "POST /projects/1/stories": created });

    await runTool("create_story", story({ description: dictated }), { api, userId: 5 });

    expect(api).toHaveBeenCalledWith(
      "/projects/1/stories",
      expect.objectContaining({ body: expect.objectContaining({ description: dictated }) }),
    );
  });

  it("resolves a person by name, so the model never handles a user id", async () => {
    const outcome = await runTool(
      "create_story",
      story({ assignee: "erin" }),
      ctx({ "POST /projects/1/stories": created }),
    );

    expect(outcome.result.assigneeId).toBe(5);
  });

  it("refuses an id from another project and offers the real choices", async () => {
    const outcome = await runTool("create_story", story({ stateId: 999 }), ctx());

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(
      "stateId 999 does not exist in project 1. Valid states: 10 = Not Started, 11 = Done.",
    );
  });

  // one correction rather than two round trips
  it("reports every bad reference at once", async () => {
    const outcome = await runTool("create_story", story({ stateId: 999, typeId: 998 }), ctx());

    expect(outcome.error).toMatch(/stateId 999/);
    expect(outcome.error).toMatch(/typeId 998/);
  });

  it("names the members when asked for somebody who is not one", async () => {
    const outcome = await runTool("create_story", story({ assignee: "Carol" }), ctx());

    expect(outcome.error).toMatch(/Nobody called "Carol" is on this project. Members are: Erin Engineer/);
  });
});

describe("adding acceptance criteria", () => {
  const criterion = "Given a filtered backlog, when I clear the filter, then every story returns.";
  const second = "Given no filter, when I open the backlog, then every story is listed.";

  const add = (criteria) => ({ projectId: 1, storyId: 7, criteria });

  it("refuses one with no description", async () => {
    const outcome = await runTool("add_acceptance_criteria", add([{ title: "Filter clears" }]), ctx());

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.error).toMatch(/description/);
  });

  it("refuses an empty list, rather than reporting it added nothing", async () => {
    const outcome = await runTool("add_acceptance_criteria", add([]), ctx());

    expect(outcome).toMatchObject({ ok: false });
  });

  it("saves the Given/When/Then as written, and starts it Pending", async () => {
    const api = mockApi({
      "POST /projects/1/stories/7/acceptanceCriteria": (body) => ({ id: 3, ...body }),
    });

    const outcome = await runTool(
      "add_acceptance_criteria",
      add([{ title: "Filter clears", description: criterion }]),
      { api, userId: 5 },
    );

    expect(api).toHaveBeenCalledWith("/projects/1/stories/7/acceptanceCriteria", {
      method: "POST",
      body: { title: "Filter clears", description: criterion, status: "Pending" },
    });
    expect(outcome.result).toMatchObject({
      created: "acceptanceCriteria",
      count: 1,
      url: "/projects/1/stories/7",
    });
  });

  it("saves a whole set in the order it was given", async () => {
    let next = 3;
    const api = mockApi({
      "POST /projects/1/stories/7/acceptanceCriteria": (body) => ({ id: next++, ...body }),
    });

    const outcome = await runTool(
      "add_acceptance_criteria",
      add([
        { title: "Filter clears", description: criterion },
        { title: "Unfiltered list", description: second },
      ]),
      { api, userId: 5 },
    );

    expect(api).toHaveBeenCalledTimes(2);
    expect(outcome.result.count).toBe(2);
    expect(outcome.result.criteria.map((c) => c.title)).toEqual(["Filter clears", "Unfiltered list"]);
    expect(outcome.result.failed).toEqual([]);
  });

  // the failure that matters: some of them saved, and the model is about to
  // tell the user the story is covered
  it("reports what saved when a later one fails", async () => {
    let calls = 0;
    const api = jest.fn(async (path, options) => {
      calls += 1;
      if (calls === 2) throw new Error("Title is required. (HTTP 400)");
      return { id: 3, ...options.body };
    });

    const outcome = await runTool(
      "add_acceptance_criteria",
      add([
        { title: "Filter clears", description: criterion },
        { title: "Unfiltered list", description: second },
      ]),
      { api, userId: 5 },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.result.count).toBe(1);
    expect(outcome.result.failed).toEqual([
      { title: "Unfiltered list", error: "Title is required. (HTTP 400)" },
    ]);
  });

  it("fails outright when nothing saved", async () => {
    const api = jest.fn(async () => {
      throw new Error("Story not found. (HTTP 404)");
    });

    const outcome = await runTool(
      "add_acceptance_criteria",
      add([{ title: "Filter clears", description: criterion }]),
      { api, userId: 5 },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/No acceptance criteria were added\. Story not found/);
  });
});

describe("updating a story", () => {
  it("sends only the fields that change", async () => {
    const api = mockApi({
      "GET /projects/1": project,
      "PUT /projects/1/stories/7": (body) => ({ id: 7, projectId: 1, ...body }),
    });

    const outcome = await runTool("update_story", { projectId: 1, storyId: 7, priority: "High" }, { api, userId: 5 });

    expect(api).toHaveBeenCalledWith("/projects/1/stories/7", { method: "PUT", body: { priority: "High" } });
    expect(outcome.result.changed).toEqual(["priority"]);
  });

  it("passes null through, since that is how a field gets cleared", async () => {
    const api = mockApi({
      "GET /projects/1": project,
      "PUT /projects/1/stories/7": (body) => ({ id: 7, projectId: 1, ...body }),
    });

    await runTool("update_story", { projectId: 1, storyId: 7, assignee: "nobody" }, { api, userId: 5 });

    expect(api).toHaveBeenCalledWith("/projects/1/stories/7", { method: "PUT", body: { assigneeId: null } });
  });

  it("asks what to change rather than writing nothing", async () => {
    const outcome = await runTool("update_story", { projectId: 1, storyId: 7 }, ctx());

    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/No fields to update/) });
  });
});

describe("setting a story's state", () => {
  const atlas = {
    id: 1,
    title: "Atlas",
    storyState: [
      { id: 6, name: "To Do", order: 0 },
      { id: 7, name: "Doing", order: 1 },
      { id: 8, name: "Done", order: 2 },
    ],
    storyType: [],
    projectMembers: [],
    sprint: [],
    repository: [],
  };

  const board = () =>
    mockApi({
      "GET /projects/1": atlas,
      "PUT /projects/1/stories/12": (body) => ({ id: 12, projectId: 1, title: "Document env vars", ...body }),
    });

  // the reported failure: the model sent an id it had never looked up
  it("takes the state by name, so no id is ever guessed", async () => {
    const api = board();
    const outcome = await runTool(
      "set_story_state",
      { projectId: 1, storyId: 12, state: "Doing" },
      { api, userId: 5 },
    );

    expect(api).toHaveBeenCalledWith("/projects/1/stories/12", { method: "PUT", body: { stateId: 7 } });
    expect(outcome.result).toMatchObject({ updated: "story", changed: ["stateId"], state: "Doing" });
  });

  it("reports where it landed, not the words the user used", async () => {
    const outcome = await runTool(
      "set_story_state",
      { projectId: 1, storyId: 12, state: "done!" },
      { api: board(), userId: 5 },
    );

    expect(outcome.result.state).toBe("Done");
  });

  it("refuses an id in the name field rather than moving the wrong story", async () => {
    const outcome = await runTool(
      "set_story_state",
      { projectId: 1, storyId: 12, state: "5" },
      { api: board(), userId: 5 },
    );

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.error).toMatch(/stateId 5 does not exist/);
  });

  it("offers the project's real states when the name matches nothing", async () => {
    const outcome = await runTool(
      "set_story_state",
      { projectId: 1, storyId: 12, state: "Archived" },
      { api: board(), userId: 5 },
    );

    expect(outcome.error).toMatch(/Valid states: 6 = To Do, 7 = Doing, 8 = Done/);
  });

  it("writes nothing when the state cannot be resolved", async () => {
    const api = board();
    await runTool("set_story_state", { projectId: 1, storyId: 12, state: "Archived" }, { api, userId: 5 });

    expect(api).not.toHaveBeenCalledWith("/projects/1/stories/12", expect.objectContaining({ method: "PUT" }));
  });

  // the same trap has to be closed on the general tool, or a combined request
  // walks straight back into it
  it("is also how update_story takes a state", async () => {
    const api = board();
    await runTool(
      "update_story",
      { projectId: 1, storyId: 12, state: "doing", priority: "High" },
      { api, userId: 5 },
    );

    expect(api).toHaveBeenCalledWith("/projects/1/stories/12", {
      method: "PUT",
      body: { priority: "High", stateId: 7 },
    });
  });

  it("is also how create_story takes a starting state", async () => {
    const api = mockApi({
      "GET /projects/1": atlas,
      "POST /projects/1/stories": (body) => ({ id: 20, projectId: 1, ...body }),
    });

    const outcome = await runTool(
      "create_story",
      {
        projectId: 1,
        title: "New work",
        description: "As a user, when I start, I want a first step, so that I can begin.",
        state: "To Do",
      },
      { api, userId: 5 },
    );

    expect(outcome.result.stateId).toBe(6);
    expect(outcome.result.defaulted).not.toContain("stateId");
  });
});

describe("moving several stories", () => {
  it("reports each one, because a batch can partly succeed", async () => {
    const api = mockApi({
      "GET /projects/1": project,
      "PUT /projects/1/stories/7": { id: 7, projectId: 1 },
      "PUT /projects/1/stories/8": { id: 8, projectId: 1 },
    });

    const outcome = await runTool(
      "move_stories_to_sprint",
      { projectId: 1, storyIds: [7, 8, 9, 7], sprintId: null },
      { api, userId: 5 },
    );

    expect(outcome.result).toMatchObject({ requested: 3, moved: 2, failed: 1 });
    expect(outcome.result.stories.at(-1)).toMatchObject({ ok: false, storyId: 9 });
  });
});

describe("how a sprint is going", () => {
  // "how is the sprint going" is about the sprint that is running now. Making
  // the model find that id first cost a turn and, on the smaller model, was
  // where the answer was lost altogether.
  const sprints = [
    { id: 50, projectId: 1, title: "Sprint 6", status: "Completed", startDate: "2026-07-13", endDate: "2026-07-26" },
    { id: 51, projectId: 1, title: "Sprint 7", status: "Active", startDate: "2026-07-27", endDate: "2026-08-09" },
    { id: 52, projectId: 1, title: "Sprint 8", status: "Planned", startDate: "2026-08-10", endDate: "2026-08-23" },
  ];

  const withSprints = (rows = sprints, extra = {}) =>
    mockApi({
      "GET /projects/1": project,
      "GET /projects/1/sprints": rows,
      "GET /sprints/51": { ...sprints[1], story: [] },
      "GET /sprints/52": { ...sprints[2], story: [] },
      ...extra,
    });

  it("reads the active sprint from the project alone", async () => {
    const api = withSprints();
    const outcome = await runTool("get_sprint_progress", { projectId: 1 }, { api, userId: 5 });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ id: 51, title: "Sprint 7" });
    expect(api).toHaveBeenCalledWith("/sprints/51");
  });

  it("uses an explicit sprintId without looking for the active one", async () => {
    const api = withSprints();
    const outcome = await runTool("get_sprint_progress", { projectId: 1, sprintId: 52 }, { api, userId: 5 });

    expect(outcome.result).toMatchObject({ id: 52 });
    expect(api).not.toHaveBeenCalledWith("/projects/1/sprints");
  });

  it("lists the real sprints when none is active, rather than failing blankly", async () => {
    const api = withSprints([sprints[0], sprints[2]]);
    const outcome = await runTool("get_sprint_progress", { projectId: 1 }, { api, userId: 5 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("no active sprint");
    expect(outcome.error).toContain("50 = Sprint 6");
    expect(outcome.error).toContain("52 = Sprint 8");
  });

  it("says so plainly when the project has no sprints at all", async () => {
    const outcome = await runTool("get_sprint_progress", { projectId: 1 }, { api: withSprints([]), userId: 5 });

    expect(outcome.error).toContain("no sprints yet");
  });

  // nothing in the schema enforces one at a time
  it("asks which when more than one sprint is active", async () => {
    const two = [sprints[1], { ...sprints[2], status: "Active" }];
    const outcome = await runTool("get_sprint_progress", { projectId: 1 }, { api: withSprints(two), userId: 5 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("more than one active sprint");
  });
});
