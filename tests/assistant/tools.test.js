// The tool registry, run against a fake Nimble.
//
// These are the answers the assistant is actually built to give, so they are
// tested through runTool — the same door the chat loop and MCP both use,
// including its argument validation and its refusal-as-a-value contract.

const {
  runTool,
  toolSpecs,
  TOOLS,
  matchStories,
  resolveByName,
  sprintProgress,
  isManager,
  isDone,
  LIST_CAP,
} = require("../../app/assistant/tools");

const { fakeApi } = require("./fixture");

const ctx = (userId = 1) => {
  const { api, calls, db } = fakeApi(userId);
  return { ctx: { api, userId }, calls, db };
};

const run = (name, args, context) => runTool(name, args, context);

describe("the registry", () => {
  it("advertises every tool with a description and a schema", () => {
    const specs = toolSpecs();

    expect(specs).toHaveLength(TOOLS.length);
    for (const spec of specs) {
      expect(spec.name).toMatch(/^[a-z][a-z_]{2,49}$/);
      expect(spec.description.length).toBeGreaterThan(40);
      expect(spec.parameters.type).toBe("object");
    }
  });

  it("flags exactly the two tools that write", () => {
    const writes = toolSpecs().filter((spec) => spec.write).map((spec) => spec.name);
    expect(writes.sort()).toEqual(["add_acceptance_criteria", "create_story"]);
  });

  it("strips the safe-integer bounds Zod puts on every int", () => {
    const schema = toolSpecs().find((spec) => spec.name === "get_story").parameters;

    expect(schema.properties.storyId.minimum).toBeUndefined();
    expect(schema.properties.storyId.maximum).toBeUndefined();
    expect(schema.required).toEqual(expect.arrayContaining(["projectId", "storyId"]));
  });

  it("reports an unknown tool as a value, listing the ones that exist", async () => {
    const outcome = await run("get_vibes", {}, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('There is no tool called "get_vibes"');
    expect(outcome.error).toContain("get_my_work");
  });

  it("reports bad arguments as a value rather than throwing", async () => {
    const outcome = await run("get_story", { projectId: "one", storyId: 70 }, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Invalid arguments for get_story");
    expect(outcome.error).toContain("projectId");
  });

  it("turns an API refusal into something the model can read", async () => {
    const outcome = await run("get_story", { projectId: 1, storyId: 999 }, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("No story 999");
  });
});

describe("get_projects", () => {
  it("names the manager once, with what they manage", async () => {
    const outcome = await run("get_projects", {}, ctx().ctx);

    expect(outcome.ok).toBe(true);
    expect(outcome.result.managers).toHaveLength(2);

    const erin = outcome.result.managers.find((person) => person.name === "Erin Engineer");
    expect(erin.manages).toEqual(["Atlas"]);
    expect(erin.email).toBe("erin@nimble.dev");
  });

  it("flags the caller so they are never reported as their own manager", async () => {
    const outcome = await run("get_projects", {}, ctx().ctx);
    const atlas = outcome.result.projects.find((project) => project.title === "Atlas");

    expect(atlas.people.find((person) => person.name === "Ada Lovelace").isYou).toBe(true);
    expect(atlas.people.find((person) => person.name === "Erin Engineer").isYou).toBe(false);
  });

  it("returns states, types and sprints only when asked about one project", async () => {
    const all = await run("get_projects", {}, ctx().ctx);
    const one = await run("get_projects", { projectId: 1 }, ctx().ctx);

    expect(all.result.projects[0].states).toBeUndefined();
    expect(one.result.projects[0].states.map((state) => state.name)).toEqual([
      "Not Started",
      "In Progress",
      "In Review",
      "Done",
    ]);
    expect(one.result.projects[0].sprints).toHaveLength(2);
  });

  it("refuses a project the user is not in, listing the ones they are", async () => {
    const outcome = await run("get_projects", { projectId: 99 }, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("not a member of project 99");
    expect(outcome.error).toContain("Atlas");
  });

  it("reads isManager permissively, since it is a string column", () => {
    expect(isManager({ isManager: "1" })).toBe(true);
    expect(isManager({ isManager: true })).toBe(true);
    expect(isManager({ isManager: "true" })).toBe(true);
    expect(isManager({ isManager: "0" })).toBe(false);
    expect(isManager({})).toBe(false);
  });
});

describe("get_sprints", () => {
  it("lists every sprint with its dates, and measures the active one", async () => {
    const outcome = await run("get_sprints", { projectId: 1 }, ctx().ctx);

    expect(outcome.result.sprints.map((sprint) => sprint.title)).toEqual(["Sprint 7", "Sprint 8"]);
    expect(outcome.result.sprints[1]).toMatchObject({
      status: "Planned",
      startDate: "2026-08-10",
      endDate: "2026-08-23",
    });

    // sprint 200 holds stories 70 (5pts), 71 (3), 73 (2, done), 74 (unestimated)
    expect(outcome.result.active).toMatchObject({
      title: "Sprint 7",
      totalPoints: 10,
      completedPoints: 2,
      remainingPoints: 8,
      unestimatedStories: 1,
    });
  });

  it("leaves out finished work from the open list", async () => {
    const outcome = await run("get_sprints", { projectId: 1 }, ctx().ctx);
    const open = outcome.result.active.openStories.stories.map((story) => story.id);

    expect(open).toEqual(expect.arrayContaining([70, 71, 74]));
    expect(open).not.toContain(73);
  });

  it("still answers when there is no active sprint", async () => {
    const outcome = await run("get_sprints", { projectId: 2 }, ctx().ctx);

    expect(outcome.ok).toBe(true);
    expect(outcome.result.active).toBeNull();
    expect(outcome.result.sprints).toEqual([]);
  });

  it("refuses a sprint that is not in the project, listing the ones that are", async () => {
    const outcome = await run("get_sprints", { projectId: 1, sprintId: 999 }, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("no sprint 999");
    expect(outcome.error).toContain("Sprint 7");
  });
});

describe("sprintProgress", () => {
  const sprint = { startDate: "2026-01-01", endDate: "2026-01-11" };

  it("measures in points and compares against the straight line to zero", () => {
    const stories = [
      { estimate: 4, completedAt: "2026-01-03T00:00:00Z", stateId: 1 },
      { estimate: 6, completedAt: null, stateId: 1 },
    ];

    // half way through, 4 of 10 points done, so 6 left against an expected 5
    const progress = sprintProgress(sprint, stories, null, "2026-01-06");

    expect(progress).toMatchObject({
      totalPoints: 10,
      completedPoints: 4,
      remainingPoints: 6,
      percentComplete: 40,
      daysTotal: 10,
      daysElapsed: 5,
      daysRemaining: 5,
      expectedRemaining: 5,
      pointsBehindSchedule: 1,
      onTrack: false,
    });
  });

  it("counts a story in the completed column as done even without a timestamp", () => {
    const stories = [{ estimate: 3, completedAt: null, stateId: 13 }];
    expect(sprintProgress(sprint, stories, 13, "2026-01-06").completedPoints).toBe(3);
    expect(sprintProgress(sprint, stories, 99, "2026-01-06").completedPoints).toBe(0);
  });

  it("reports no percentage rather than dividing by zero", () => {
    expect(sprintProgress(sprint, [], null, "2026-01-06").percentComplete).toBeNull();
  });

  it("does not run past the end of a sprint that is over", () => {
    const progress = sprintProgress(sprint, [{ estimate: 2 }], null, "2026-03-01");
    expect(progress.daysElapsed).toBe(10);
    expect(progress.daysRemaining).toBe(0);
  });

  it("agrees with isDone about what finished means", () => {
    expect(isDone({ completedAt: "2026-01-01", stateId: 1 })).toBe(true);
    expect(isDone({ completedAt: null, stateId: 13 }, 13)).toBe(true);
    expect(isDone({ completedAt: null, stateId: 11 }, 13)).toBe(false);
  });
});

describe("get_my_work", () => {
  it("splits what Ada builds from what she reviews, across every project", async () => {
    const outcome = await run("get_my_work", {}, ctx(1).ctx);

    expect(outcome.result.assigned.stories.map((story) => story.id)).toEqual([70, 76]);
    expect(outcome.result.reviewing.stories.map((story) => story.id).sort()).toEqual([71, 74, 77]);
  });

  it("puts active-sprint work first, then the higher priority", async () => {
    const outcome = await run("get_my_work", {}, ctx(1).ctx);
    const reviewing = outcome.result.reviewing.stories;

    // 74 (Blocker, active sprint) and 71 (Medium, active sprint) before 77 (no sprint)
    expect(reviewing[0].id).toBe(74);
    expect(reviewing[1].id).toBe(71);
    expect(reviewing[2].id).toBe(77);
  });

  it("leaves out finished work", async () => {
    const outcome = await run("get_my_work", {}, ctx(1).ctx);
    // 73 is Ada's but sits in Atlas's completed state
    expect(outcome.result.assigned.stories.map((story) => story.id)).not.toContain(73);
  });

  it("says so plainly when it does not know who is asking", async () => {
    const outcome = await run("get_my_work", {}, ctx(null).ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("do not know which user you are");
  });

  it("names the project each story came from", async () => {
    const outcome = await run("get_my_work", {}, ctx(1).ctx);
    expect(outcome.result.assigned.stories.map((story) => story.project)).toEqual(["Atlas", "Beacon"]);
  });
});

describe("find_stories", () => {
  it("finds a story from how someone would actually refer to it", async () => {
    const outcome = await run("find_stories", { projectId: 1, query: "login" }, ctx().ctx);

    expect(outcome.result.matched).toBe(1);
    expect(outcome.result.stories[0].id).toBe(70);
  });

  it("matches against the description, not just the title", async () => {
    const outcome = await run("find_stories", { projectId: 1, query: "accented" }, ctx().ctx);
    expect(outcome.result.stories[0].id).toBe(74);
  });

  it("narrows by workflow state, by name", async () => {
    const outcome = await run("find_stories", { projectId: 1, state: "In Progress" }, ctx().ctx);

    expect(outcome.result.stories.map((story) => story.id).sort()).toEqual([70, 74]);
  });

  it("treats inSprint false as the backlog", async () => {
    const outcome = await run("find_stories", { projectId: 1, inSprint: false }, ctx().ctx);
    expect(outcome.result.stories.map((story) => story.id).sort()).toEqual([72, 75]);
  });

  it("lists everything when no query is given", async () => {
    const outcome = await run("find_stories", { projectId: 1 }, ctx().ctx);
    expect(outcome.result.matched).toBe(6);
  });

  it("refuses a state the project does not have, listing the ones it does", async () => {
    const outcome = await run("find_stories", { projectId: 1, state: "Shipped" }, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('no state called "Shipped"');
    expect(outcome.error).toContain("In Review");
  });

  it("reports the true total when the list is capped", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: index, title: `Story ${index}` }));
    const { capped } = require("../../app/assistant/tools");

    expect(capped(rows)).toMatchObject({ matched: 25, showing: LIST_CAP, truncated: true });
    expect(capped(rows).stories).toHaveLength(LIST_CAP);
  });
});

describe("matchStories", () => {
  const stories = [
    { title: "Fix the login page", description: "", type: { name: "Bug" } },
    { title: "Add CSV export", description: "<p>For <b>analysts</b></p>", type: { name: "Feature" } },
  ];

  it("requires every word of the query to appear somewhere", () => {
    expect(matchStories(stories, "login page")).toHaveLength(1);
    expect(matchStories(stories, "login export")).toHaveLength(0);
  });

  it("ignores markup in the description", () => {
    expect(matchStories(stories, "analysts")).toHaveLength(1);
  });

  it("matches the story type", () => {
    expect(matchStories(stories, "bug")).toHaveLength(1);
  });

  it("returns everything when there is nothing to match on", () => {
    expect(matchStories(stories, "")).toHaveLength(2);
    expect(matchStories(stories, undefined)).toHaveLength(2);
  });
});

describe("resolveByName", () => {
  const states = [
    { id: 1, name: "To Do" },
    { id: 2, name: "In Progress" },
    { id: 3, name: "Done" },
  ];

  it("takes an exact name first", () => {
    expect(resolveByName("Done", states, "state").id).toBe(3);
    expect(resolveByName("done", states, "state").id).toBe(3);
  });

  it("falls back to a partial match", () => {
    expect(resolveByName("progress", states, "state").id).toBe(2);
  });

  it("throws with the real choices when nothing matches", () => {
    expect(() => resolveByName("Shipped", states, "state")).toThrow(/To Do, In Progress, Done/);
  });
});

describe("get_story", () => {
  it("returns the description, criteria and comments", async () => {
    const outcome = await run("get_story", { projectId: 1, storyId: 70 }, ctx().ctx);

    expect(outcome.result).toMatchObject({
      id: 70,
      state: "In Progress",
      type: "Bug",
      assignee: "Ada Lovelace",
      reviewer: "Erin Engineer",
    });
    expect(outcome.result.acceptanceCriteria.map((c) => c.title)).toEqual([
      "Valid password works",
      "Wrong password shows an error",
    ]);
    expect(outcome.result.comments[0]).toMatchObject({ by: "Erin Engineer", content: "Reproduced on staging." });
  });
});

describe("create_story", () => {
  it("creates one in the first column and says what it defaulted", async () => {
    const { ctx: context, db } = ctx();

    const outcome = await run(
      "create_story",
      {
        projectId: 1,
        title: "Fix the password reset email",
        description: "As a user, when I reset my password, I want the email to arrive, so that I can sign in.",
      },
      context,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.result.created).toBe("story");
    expect(outcome.result.defaulted).toEqual(["state Not Started"]);

    const made = db.rawStories.find((story) => story.id === outcome.result.id);
    expect(made.stateId).toBe(10);
    expect(made.title).toBe("Fix the password reset email");
  });

  it("resolves type and state by name", async () => {
    const { ctx: context, db } = ctx();

    const outcome = await run(
      "create_story",
      {
        projectId: 1,
        title: "Tidy the pipeline",
        description: "As a developer, when I merge, I want a fast build, so that I ship sooner.",
        type: "Chore",
        state: "In Progress",
        priority: "Low",
      },
      context,
    );

    const made = db.rawStories.find((story) => story.id === outcome.result.id);
    expect(made.typeId).toBe(22);
    expect(made.stateId).toBe(11);
    expect(made.priority).toBe("Low");
    expect(outcome.result.defaulted).toEqual([]);
  });

  it("refuses a type the project does not have rather than guessing", async () => {
    const outcome = await run(
      "create_story",
      { projectId: 1, title: "X", description: "As a user...", type: "Epic" },
      ctx().ctx,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('no type called "Epic"');
    expect(outcome.error).toContain("Bug, Feature, Chore");
  });

  it("refuses a sprint from another project", async () => {
    const outcome = await run(
      "create_story",
      { projectId: 1, title: "X", description: "As a user...", sprintId: 999 },
      ctx().ctx,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Sprint 999 does not belong to project 1");
  });

  it("insists on a description, since the model is meant to write one", async () => {
    const outcome = await run("create_story", { projectId: 1, title: "X" }, ctx().ctx);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("description");
  });

  it("writes nothing when a reference is wrong", async () => {
    const { ctx: context, calls } = ctx();
    await run(
      "create_story",
      { projectId: 1, title: "X", description: "As a user...", state: "Nowhere" },
      context,
    );

    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});

describe("add_acceptance_criteria", () => {
  const criteria = [
    { title: "Empty input", description: "Given an empty form, when it is submitted, then an error shows." },
    { title: "Happy path", description: "Given a valid form, when it is submitted, then it saves." },
  ];

  it("adds them all and reports what was created", async () => {
    const { ctx: context, db } = ctx();
    const outcome = await run("add_acceptance_criteria", { projectId: 1, storyId: 70, criteria }, context);

    expect(outcome.ok).toBe(true);
    expect(outcome.result.count).toBe(2);
    expect(outcome.result.failed).toEqual([]);
    expect(db.criteria.filter((c) => c.storyId === 70)).toHaveLength(4);
  });

  it("saves them one at a time, in the order given", async () => {
    const { ctx: context, calls } = ctx();
    await run("add_acceptance_criteria", { projectId: 1, storyId: 70, criteria }, context);

    const posted = calls.filter((call) => call.method === "POST").map((call) => call.body.title);
    expect(posted).toEqual(["Empty input", "Happy path"]);
  });

  it("makes new criteria Pending", async () => {
    const { ctx: context, calls } = ctx();
    await run("add_acceptance_criteria", { projectId: 1, storyId: 70, criteria }, context);

    expect(calls.find((call) => call.method === "POST").body.status).toBe("Pending");
  });

  it("fails outright when nothing could be saved", async () => {
    const outcome = await run(
      "add_acceptance_criteria",
      { projectId: 1, storyId: 999, criteria },
      ctx().ctx,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("No acceptance criteria were added");
  });

  it("refuses an empty list", async () => {
    const outcome = await run(
      "add_acceptance_criteria",
      { projectId: 1, storyId: 70, criteria: [] },
      ctx().ctx,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Invalid arguments");
  });
});
