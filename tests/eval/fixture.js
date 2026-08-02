// A fake Nimble, complete enough to run the real tools against.
//
// Shapes match what the REST controllers actually return, including the
// generous eager-loading (stories carry state, type, assignee, comments and
// acceptance criteria).

const clone = (value) => JSON.parse(JSON.stringify(value));

function build() {
  const users = {
    1: { id: 1, firstName: "Ada", lastName: "Lovelace", email: "ada@nimble.dev" },
    5: { id: 5, firstName: "Erin", lastName: "Engineer", email: "erin@nimble.dev" },
    6: { id: 6, firstName: "Carol", lastName: "Coder", email: "carol@nimble.dev" },
    7: { id: 7, firstName: "Dan", lastName: "Designer", email: "dan@nimble.dev" },
  };

  const atlasStates = [
    { id: 10, name: "Not Started", order: 0 },
    { id: 11, name: "In Progress", order: 1 },
    { id: 12, name: "In Review", order: 2 },
    { id: 13, name: "Done", order: 3 },
  ];
  const beaconStates = [
    { id: 30, name: "Backlog", order: 0 },
    { id: 31, name: "Doing", order: 1 },
    { id: 32, name: "Shipped", order: 2 },
  ];

  const projects = {
    1: {
      id: 1,
      title: "Atlas",
      description: "Customer-facing web app.",
      deadline: "2026-12-31",
      completedStateId: 13,
      branchCreationStateId: 11,
      prReviewStateId: 12,
      storyState: atlasStates,
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
        {
          id: 200, projectId: 1, title: "Sprint 7", goal: "Stabilise login",
          status: "Active", startDate: "2026-07-27", endDate: "2026-08-09", isRecurring: false,
        },
        {
          id: 201, projectId: 1, title: "Sprint 8", goal: null,
          status: "Planned", startDate: "2026-08-10", endDate: "2026-08-23", isRecurring: false,
        },
      ],
    },
    2: {
      id: 2,
      title: "Beacon",
      description: "Internal analytics.",
      deadline: null,
      completedStateId: 32,
      branchCreationStateId: null,
      prReviewStateId: null,
      storyState: beaconStates,
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
      assigneeId: 1, reviewerId: 5, completedAt: null, updatedAt: "2026-08-01T10:00:00Z" },
    { id: 71, projectId: 1, title: "Email notifications sent twice",
      description: "As a subscriber, when an event fires, I want one email, so that my inbox stays clean.",
      stateId: 12, typeId: 20, priority: "Medium", estimate: 3, sprintId: 200,
      assigneeId: 6, reviewerId: 1, completedAt: null, updatedAt: "2026-07-30T09:00:00Z" },
    { id: 72, projectId: 1, title: "Add CSV export to the reports screen",
      description: "As an analyst, when I finish a report, I want to export CSV, so that I can share it.",
      stateId: 10, typeId: 21, priority: "Low", estimate: 8, sprintId: null,
      assigneeId: null, reviewerId: null, completedAt: null, updatedAt: "2026-06-02T09:00:00Z" },
    { id: 73, projectId: 1, title: "Sprint dates off by one day",
      description: "As a manager, when I open a sprint, I want correct dates, so that planning is accurate.",
      stateId: 13, typeId: 20, priority: "High", estimate: 2, sprintId: 200,
      assigneeId: 1, reviewerId: null, completedAt: "2026-07-29T12:00:00Z", updatedAt: "2026-07-29T12:00:00Z" },
    { id: 74, projectId: 1, title: "UTF-8 characters break the search box",
      description: "As a user, when I search accented text, I want results, so that I can find my work.",
      stateId: 11, typeId: 20, priority: "Blocker", estimate: null, sprintId: 200,
      assigneeId: 6, reviewerId: 1, completedAt: null, updatedAt: "2026-07-31T15:00:00Z" },
    { id: 75, projectId: 1, title: "Upgrade the deployment pipeline",
      description: "As a developer, when I merge, I want a fast pipeline, so that I ship sooner.",
      stateId: 10, typeId: 22, priority: null, estimate: null, sprintId: null,
      assigneeId: 5, reviewerId: null, completedAt: null, updatedAt: "2026-05-20T09:00:00Z" },
    { id: 76, projectId: 2, title: "Dashboard loads slowly on Safari",
      description: "As an analyst, when I open the dashboard, I want it fast, so that I am not blocked.",
      stateId: 31, typeId: 50, priority: "High", estimate: 5, sprintId: null,
      assigneeId: 1, reviewerId: null, completedAt: null, updatedAt: "2026-07-28T11:00:00Z" },
    { id: 77, projectId: 2, title: "Add weekly email digest",
      description: "As a manager, when the week ends, I want a digest, so that I stay informed.",
      stateId: 30, typeId: 50, priority: "Medium", estimate: 3, sprintId: null,
      assigneeId: 7, reviewerId: 1, completedAt: null, updatedAt: "2026-07-15T11:00:00Z" },
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

  const relations = [];
  const activity = [
    { id: 500, storyId: 70, action: "UPDATE", subjectType: "STORY", createdAt: "2026-08-01T10:00:00Z",
      user: users[1], metadata: null,
      change: [{ attribute: "stateId", oldValue: "10", newValue: "11" }] },
    { id: 501, storyId: 70, action: "CREATE", subjectType: "STORY", createdAt: "2026-07-20T10:00:00Z",
      user: users[5], metadata: null, change: [] },
  ];

  return { users, projects, rawStories, criteria, comments, relations, activity, nextId: 900 };
}

/** A story as the API returns it: eager-loaded to the point of excess. */
function hydrate(db, story) {
  const project = db.projects[story.projectId];
  const state = (project.storyState ?? []).find((s) => s.id === story.stateId) ?? null;
  const type = (project.storyType ?? []).find((t) => t.id === story.typeId) ?? null;

  return {
    ...story,
    state,
    type,
    assignee: story.assigneeId ? db.users[story.assigneeId] : null,
    reviewer: story.reviewerId ? db.users[story.reviewerId] : null,
    acceptanceCriteria: db.criteria.filter((c) => c.storyId === story.id),
    comment: db.comments
      .filter((c) => c.storyId === story.id)
      .map((c) => ({ ...c, user: db.users[c.userId] })),
    relation: db.relations.filter((r) => r.storyOneId === story.id || r.storyTwoId === story.id),
  };
}

/**
 * An `api` with the same signature as app/assistant/api.js's client, backed by
 * the fixture. Records every call so a scenario can assert on what was reached.
 */
function fakeApi(userId = 1) {
  const db = build();
  const calls = [];

  const api = async (path, { method = "GET", body } = {}) => {
    calls.push({ method, path, body });
    const seg = path.split("?")[0].split("/").filter(Boolean);
    const fail = (msg, code = 404) => {
      throw new Error(`${msg} (HTTP ${code})`);
    };

    // GET /users/me/projects
    if (path === "/users/me/projects") {
      return Object.values(db.projects)
        .filter((p) => p.projectMembers.some((m) => m.userId === userId))
        .map(clone);
    }

    // /sprints...
    if (seg[0] === "sprints") {
      if (method === "POST" && seg.length === 1) {
        const sprint = { id: (db.nextId += 1), isRecurring: false, ...body };
        db.projects[body.projectId].sprint.push(sprint);
        return clone(sprint);
      }
      if (method === "POST" && seg[1] === "recurring") {
        const made = [];
        for (let i = 0; i < body.recurrenceCount; i += 1) {
          const sprint = { id: (db.nextId += 1), projectId: body.projectId,
            title: `${body.title} ${i + 1}`, goal: body.goal ?? null, status: "Planned",
            startDate: body.startDate, endDate: body.endDate, isRecurring: true };
          db.projects[body.projectId].sprint.push(sprint);
          made.push(sprint);
        }
        return clone(made);
      }

      const id = Number(seg[1]);
      const owner = Object.values(db.projects).find((p) => p.sprint.some((s) => s.id === id));
      if (!owner) fail(`No sprint ${id}`);
      const sprint = owner.sprint.find((s) => s.id === id);

      if (method === "PUT") {
        Object.assign(sprint, body);
        return clone(sprint);
      }
      return clone({
        ...sprint,
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

    // GET /projects/:id
    if (seg.length === 2) return clone(project);

    // /projects/:id/backlog
    if (seg[2] === "backlog") {
      return clone(
        db.rawStories.filter((s) => s.projectId === projectId && s.sprintId == null).map((s) => hydrate(db, s)),
      );
    }

    // /projects/:id/sprints
    if (seg[2] === "sprints") return clone(project.sprint);

    if (seg[2] !== "stories") fail(`Nothing at ${path}`);

    // POST /projects/:id/stories
    if (method === "POST" && seg.length === 3) {
      const story = {
        id: (db.nextId += 1), projectId, priority: null, estimate: null, sprintId: null,
        assigneeId: null, reviewerId: null, typeId: null, completedAt: null,
        updatedAt: new Date().toISOString(), ...body,
      };
      db.rawStories.push(story);
      return clone(hydrate(db, story));
    }

    // GET /projects/:id/stories
    if (seg.length === 3) {
      return clone(db.rawStories.filter((s) => s.projectId === projectId).map((s) => hydrate(db, s)));
    }

    const storyId = Number(seg[3]);
    const story = db.rawStories.find((s) => s.id === storyId && s.projectId === projectId);
    if (!story) fail(`No story ${storyId} in project ${projectId}`);

    // /projects/:id/stories/:sid
    if (seg.length === 4) {
      if (method === "PUT") {
        for (const [key, value] of Object.entries(body)) {
          if (key === "stateId" && Number(value) === project.completedStateId) {
            story.completedAt = new Date().toISOString();
          }
          story[key] = value;
        }
        story.updatedAt = new Date().toISOString();
        return clone(hydrate(db, story));
      }
      return clone(hydrate(db, story));
    }

    // /projects/:id/stories/:sid/<sub>
    const sub = seg[4];

    if (sub === "activity") {
      return clone(db.activity.filter((a) => a.storyId === storyId));
    }

    if (sub === "comments" && method === "POST") {
      const comment = { id: (db.nextId += 1), storyId, userId, content: body.content,
        createdAt: new Date().toISOString() };
      db.comments.push(comment);
      return clone(comment);
    }

    if (sub === "acceptanceCriteria") {
      if (method === "POST") {
        const criterion = { id: (db.nextId += 1), storyId, ...body };
        db.criteria.push(criterion);
        return clone(criterion);
      }
      if (method === "PUT") {
        const criterion = db.criteria.find((c) => c.id === Number(seg[5]));
        if (!criterion) fail(`No criterion ${seg[5]}`);
        // matches the real controller: writes all three columns every time
        criterion.title = body.title;
        criterion.description = body.description;
        criterion.status = body.status;
        return clone(criterion);
      }
    }

    if (sub === "relations" && method === "POST") {
      const relation = { id: (db.nextId += 1), ...body };
      db.relations.push(relation);
      return clone(relation);
    }

    fail(`Nothing at ${path}`);
  };

  return { api, calls, db };
}

module.exports = { fakeApi, build, hydrate };
