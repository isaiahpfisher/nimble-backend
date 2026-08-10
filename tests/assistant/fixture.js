// A fake Nimble, complete enough to run the real tools against.
//
// Shapes match what the REST controllers actually return, including the
// generous eager-loading (stories carry state, type, assignee, comments and
// acceptance criteria). Only the endpoints the tools reach are implemented —
// anything else throws, which is how a tool asking for the wrong thing shows up.

const clone = (value) => JSON.parse(JSON.stringify(value));

function build() {
  const users = {
    1: { id: 1, firstName: "Ada", lastName: "Lovelace", email: "ada@nimble.dev" },
    5: { id: 5, firstName: "Erin", lastName: "Engineer", email: "erin@nimble.dev" },
    6: { id: 6, firstName: "Carol", lastName: "Coder", email: "carol@nimble.dev" },
    7: { id: 7, firstName: "Dan", lastName: "Designer", email: "dan@nimble.dev" },
  };

  const projects = {
    1: {
      id: 1,
      title: "Atlas",
      description: "Customer-facing web app.",
      deadline: "2026-12-31",
      completedStateId: 13,
      storyState: [
        { id: 10, name: "Not Started", order: 0 },
        { id: 11, name: "In Progress", order: 1 },
        { id: 12, name: "In Review", order: 2 },
        { id: 13, name: "Done", order: 3 },
      ],
      storyType: [
        { id: 20, name: "Bug" },
        { id: 21, name: "Feature" },
        { id: 22, name: "Chore" },
      ],
      repository: [{ id: 40, name: "acme/atlas" }],
      projectMembers: [
        { id: 100, userId: 1, isManager: "0", user: users[1] },
        { id: 101, userId: 5, isManager: "1", user: users[5] },
        { id: 102, userId: 6, isManager: "0", user: users[6] },
      ],
      sprint: [
        { id: 200, projectId: 1, title: "Sprint 7", goal: "Stabilise login",
          status: "Active", startDate: "2026-07-27", endDate: "2026-08-09" },
        { id: 201, projectId: 1, title: "Sprint 8", goal: null,
          status: "Planned", startDate: "2026-08-10", endDate: "2026-08-23" },
      ],
    },
    2: {
      id: 2,
      title: "Beacon",
      description: "Internal analytics.",
      deadline: null,
      completedStateId: 32,
      storyState: [
        { id: 30, name: "Backlog", order: 0 },
        { id: 31, name: "Doing", order: 1 },
        { id: 32, name: "Shipped", order: 2 },
      ],
      storyType: [{ id: 50, name: "Task" }],
      repository: [],
      projectMembers: [
        { id: 110, userId: 1, isManager: "0", user: users[1] },
        { id: 111, userId: 7, isManager: "1", user: users[7] },
      ],
      sprint: [],
    },
  };

  const rawStories = [
    { id: 70, projectId: 1, title: "There's an issue with the login page",
      description: "As a user, when I sign in, I want the form to accept my password, so that I can reach my account.",
      stateId: 11, typeId: 20, priority: "High", estimate: 5, sprintId: 200,
      assigneeId: 1, reviewerId: 5, completedAt: null },
    { id: 71, projectId: 1, title: "Email notifications sent twice",
      description: "As a subscriber, when an event fires, I want one email, so that my inbox stays clean.",
      stateId: 12, typeId: 20, priority: "Medium", estimate: 3, sprintId: 200,
      assigneeId: 6, reviewerId: 1, completedAt: null },
    { id: 72, projectId: 1, title: "Add CSV export to the reports screen",
      description: "As an analyst, when I finish a report, I want to export CSV, so that I can share it.",
      stateId: 10, typeId: 21, priority: "Low", estimate: 8, sprintId: null,
      assigneeId: null, reviewerId: null, completedAt: null },
    { id: 73, projectId: 1, title: "Sprint dates off by one day",
      description: "As a manager, when I open a sprint, I want correct dates, so that planning is accurate.",
      stateId: 13, typeId: 20, priority: "High", estimate: 2, sprintId: 200,
      assigneeId: 1, reviewerId: null, completedAt: "2026-07-29T12:00:00Z" },
    { id: 74, projectId: 1, title: "UTF-8 characters break the search box",
      description: "As a user, when I search accented text, I want results, so that I can find my work.",
      stateId: 11, typeId: 20, priority: "Blocker", estimate: null, sprintId: 200,
      assigneeId: 6, reviewerId: 1, completedAt: null },
    { id: 75, projectId: 1, title: "Upgrade the deployment pipeline",
      description: "As a developer, when I merge, I want a fast pipeline, so that I ship sooner.",
      stateId: 10, typeId: 22, priority: null, estimate: null, sprintId: null,
      assigneeId: 5, reviewerId: null, completedAt: null },
    { id: 76, projectId: 2, title: "Dashboard loads slowly on Safari",
      description: "As an analyst, when I open the dashboard, I want it fast, so that I am not blocked.",
      stateId: 31, typeId: 50, priority: "High", estimate: 5, sprintId: null,
      assigneeId: 1, reviewerId: null, completedAt: null },
    { id: 77, projectId: 2, title: "Add weekly email digest",
      description: "As a manager, when the week ends, I want a digest, so that I stay informed.",
      stateId: 30, typeId: 50, priority: "Medium", estimate: 3, sprintId: null,
      assigneeId: 7, reviewerId: 1, completedAt: null },
  ];

  const criteria = [
    { id: 300, storyId: 70, title: "Valid password works", status: "Pending",
      description: "Given a registered user, when they submit a correct password, then they reach the dashboard." },
    { id: 301, storyId: 70, title: "Wrong password shows an error", status: "Passed",
      description: "Given a registered user, when they submit a wrong password, then an error is shown." },
  ];

  const comments = [
    { id: 400, storyId: 70, userId: 5, content: "Reproduced on staging.", createdAt: "2026-07-31T08:00:00Z" },
  ];

  return { users, projects, rawStories, criteria, comments, nextId: 900 };
}

/** A story as the API returns it: eager-loaded to the point of excess. */
function hydrate(db, story) {
  const project = db.projects[story.projectId];

  return {
    ...story,
    state: (project.storyState ?? []).find((s) => s.id === story.stateId) ?? null,
    type: (project.storyType ?? []).find((t) => t.id === story.typeId) ?? null,
    assignee: story.assigneeId ? db.users[story.assigneeId] : null,
    reviewer: story.reviewerId ? db.users[story.reviewerId] : null,
    reporter: db.users[1],
    acceptanceCriteria: db.criteria.filter((c) => c.storyId === story.id),
    comment: db.comments
      .filter((c) => c.storyId === story.id)
      .map((c) => ({ ...c, user: db.users[c.userId] })),
  };
}

/**
 * An `api` with the same signature as the tools' client, backed by the fixture.
 * Records every call so a test can assert on what was reached.
 */
function fakeApi(userId = 1) {
  const db = build();
  const calls = [];

  const api = async (path, { method = "GET", body } = {}) => {
    calls.push({ method, path, body });
    const seg = path.split("?")[0].split("/").filter(Boolean);
    const fail = (message, code = 404) => {
      throw new Error(`${message} (HTTP ${code})`);
    };

    if (path === "/users/me/projects") {
      return Object.values(db.projects)
        .filter((project) => project.projectMembers.some((m) => m.userId === userId))
        .map(clone);
    }

    // GET /sprints/:id — the only sprint endpoint any tool reaches
    if (seg[0] === "sprints") {
      const id = Number(seg[1]);
      const owner = Object.values(db.projects).find((p) => p.sprint.some((s) => s.id === id));
      if (!owner) fail(`No sprint ${id}`);

      return clone({
        ...owner.sprint.find((s) => s.id === id),
        story: db.rawStories.filter((s) => s.sprintId === id).map((s) => hydrate(db, s)),
      });
    }

    if (seg[0] !== "projects") fail(`Nothing at ${path}`);

    const projectId = Number(seg[1]);
    const project = db.projects[projectId];
    if (!project) fail(`No project ${projectId}`);
    if (!project.projectMembers.some((m) => m.userId === userId)) {
      fail(`You are not a member of project ${projectId}`, 403);
    }

    if (seg.length === 2) return clone(project);
    if (seg[2] === "sprints") return clone(project.sprint);
    if (seg[2] !== "stories") fail(`Nothing at ${path}`);

    if (method === "POST" && seg.length === 3) {
      const story = {
        id: (db.nextId += 1), projectId, priority: null, estimate: null, sprintId: null,
        assigneeId: null, reviewerId: null, typeId: null, completedAt: null, ...body,
      };
      db.rawStories.push(story);
      return clone(hydrate(db, story));
    }

    if (seg.length === 3) {
      return clone(db.rawStories.filter((s) => s.projectId === projectId).map((s) => hydrate(db, s)));
    }

    const storyId = Number(seg[3]);
    const story = db.rawStories.find((s) => s.id === storyId && s.projectId === projectId);
    if (!story) fail(`No story ${storyId} in project ${projectId}`);

    if (seg.length === 4) return clone(hydrate(db, story));

    if (seg[4] === "acceptanceCriteria" && method === "POST") {
      const criterion = { id: (db.nextId += 1), storyId, ...body };
      db.criteria.push(criterion);
      return clone(criterion);
    }

    fail(`Nothing at ${path}`);
  };

  return { api, calls, db };
}

module.exports = { fakeApi, build, hydrate };
