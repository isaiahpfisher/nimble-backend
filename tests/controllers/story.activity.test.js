// Authorization is covered on its own in tests/authentication/authorization.test.js.
// Here it is stubbed permissively so each controller test sees only the
// controller's behaviour; the guard calls themselves are asserted per action.
jest.mock("../../app/authentication/authorization", () => ({
  isAdmin: jest.fn().mockResolvedValue(true),
  requireAdmin: jest.fn().mockResolvedValue(undefined),
  requireSelfOrAdmin: jest.fn().mockResolvedValue(undefined),
  requireProjectMember: jest.fn().mockResolvedValue({ isManager: "1" }),
  requireMemberManagement: jest.fn().mockResolvedValue({ isManager: "1" }),
  assertBelongsToProject: jest.fn((record, projectId, label) => {
    const owner = record && record.projectId;
    if (owner == null || projectId == null || String(owner) !== String(projectId)) {
      const error = new Error(`Cannot find ${label}.`);
      error.statusCode = 404;
      throw error;
    }
    return record;
  }),
}));

// Activity-history coverage for the story controller: the created entry and
// the field-level diff written on update.
jest.mock("../../app/models", () => ({
  story: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  project: { findByPk: jest.fn() },
  user: { name: "user", findByPk: jest.fn() },
  storyState: { name: "storyState", findByPk: jest.fn() },
  storyType: { name: "storyType", findByPk: jest.fn() },
  sprint: { name: "sprint", findByPk: jest.fn() },
  repository: { name: "repository" },
  acceptanceCriteria: { name: "acceptanceCriteria" },
  comment: { name: "comment" },
  relation: { name: "relation" },
  Sequelize: { Op: {} },
}));

jest.mock("../../app/utils/email", () => ({
  notifyAssignedUser: jest.fn().mockResolvedValue(undefined),
  notifyReviewerUser: jest.fn().mockResolvedValue(undefined),
  storyUrl: jest.fn(() => "http://example.test/story"),
}));

jest.mock("../../app/utils/activity", () => {
  const db = require("../../app/models");
  return {
    recordActivity: jest.fn().mockResolvedValue(undefined),
    ACTIVITY_ACTION: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" },
    SUBJECT_TYPE: {
      STORY: "story",
      ACCEPTANCE_CRITERIA: "acceptanceCriteria",
      COMMENT: "comment",
      RELATION: "relation",
    },
    STORY_PLAIN_FIELDS: ["title", "description", "priority", "estimate"],
    STORY_ASSOC_FIELDS: {
      stateId: { attribute: "state", model: () => db.storyState, label: (r) => r.name },
      sprintId: { attribute: "sprint", model: () => db.sprint, label: (r) => r.title },
      typeId: { attribute: "type", model: () => db.storyType, label: (r) => r.name },
      assigneeId: { attribute: "assignee", model: () => db.user, label: (r) => `${r.firstName} ${r.lastName}` },
      reporterId: { attribute: "reporter", model: () => db.user, label: (r) => `${r.firstName} ${r.lastName}` },
      reviewerId: { attribute: "reviewer", model: () => db.user, label: (r) => `${r.firstName} ${r.lastName}` },
    },
  };
});

const db = require("../../app/models");
const Story = db.story;
const Project = db.project;
const User = db.user;
const StoryState = db.storyState;
const Sprint = db.sprint;
const { recordActivity } = require("../../app/utils/activity");
const controller = require("../../app/controllers/story.controller");

let authenticate;

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

function storyBody(overrides = {}) {
  return {
    title: "Add login page",
    description: "Users need to sign in",
    typeId: 2,
    stateId: 3,
    priority: "HIGH",
    estimate: 5,
    // Matches mockStory()'s reporter so an update body is a no-op by default;
    // the reporter is asserted on its own below.
    reporterId: 42,
    ...overrides,
  };
}

// A story row whose update() applies the patch, so the controller's
// before/after diff sees what a real Sequelize instance would.
function mockStory(attrs = {}) {
  const story = {
    id: 7,
    projectId: "1",
    title: "Add login page",
    description: "Users need to sign in",
    priority: "HIGH",
    estimate: 5,
    typeId: 2,
    stateId: 3,
    sprintId: null,
    repositoryId: null,
    reporterId: 42,
    assigneeId: null,
    reviewerId: null,
    project: { id: 1, completedState: { id: 9 } },
    ...attrs,
  };
  story.update = jest.fn(async (patch) => Object.assign(story, patch));
  return story;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so restore the default resolve.
  recordActivity.mockResolvedValue(undefined);
  authenticate = jest.fn().mockResolvedValue({ userId: 42 });
  global.authenticate = authenticate;
  User.findByPk.mockImplementation((id) =>
    Promise.resolve({ id, firstName: "User", lastName: String(id), email: `${id}@test.dev` }),
  );
  StoryState.findByPk.mockImplementation((id) => Promise.resolve({ id, name: `State ${id}` }));
  Sprint.findByPk.mockImplementation((id) => Promise.resolve({ id, title: `Sprint ${id}` }));
});

afterEach(() => {
  delete global.authenticate;
});

describe("create", () => {
  it("records a created activity naming the state and assignee", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockResolvedValue({ id: 7, title: "Add login page", assigneeId: 8, reviewerId: null });
    StoryState.findByPk.mockResolvedValue({ id: 3, name: "In Progress" });
    User.findByPk.mockImplementation((id) =>
      Promise.resolve({ id, firstName: id === 8 ? "Grace" : "Ada", lastName: id === 8 ? "Hopper" : "Lovelace" }),
    );
    const req = { params: { id: "1" }, body: storyBody({ assigneeId: 8 }) };

    await controller.create(req, mockRes());

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 7,
      subjectType: "story",
      subjectId: 7,
      userId: 42,
      action: "created",
      metadata: { title: "Add login page", state: "In Progress", assignee: "Grace Hopper" },
    });
  });

  it("leaves the assignee null when the story is unassigned", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockResolvedValue({ id: 7, title: "Add login page" });
    StoryState.findByPk.mockResolvedValue({ id: 3, name: "Backlog" });
    const req = { params: { id: "1" }, body: storyBody() };

    await controller.create(req, mockRes());

    expect(recordActivity.mock.calls[0][0].metadata).toEqual({
      title: "Add login page",
      state: "Backlog",
      assignee: null,
    });
  });

  it("looks the state and assignee up on narrow column sets", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockResolvedValue({ id: 7, title: "Add login page" });
    const req = { params: { id: "1" }, body: storyBody({ assigneeId: 8 }) };

    await controller.create(req, mockRes());

    expect(StoryState.findByPk).toHaveBeenCalledWith(3, { attributes: ["id", "name"] });
    expect(User.findByPk).toHaveBeenCalledWith(8, { attributes: ["id", "firstName", "lastName"] });
  });

  it("records nothing when the project does not exist", async () => {
    Project.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.create({ params: { id: "99" }, body: storyBody() }, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("records nothing when required fields are missing", async () => {
    const res = mockRes();

    await controller.create({ params: { id: "1" }, body: storyBody({ title: "" }) }, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("update", () => {
  it("records each changed scalar field with both sides", async () => {
    const story = mockStory({ title: "Old title", estimate: 3 });
    Story.findByPk.mockResolvedValue(story);
    const req = {
      params: { projectId: "1", storyId: "7" },
      body: storyBody({ title: "New title", estimate: 8, description: story.description }),
    };

    await controller.update(req, mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(1);
    const payload = recordActivity.mock.calls[0][0];
    expect(payload).toMatchObject({
      storyId: 7,
      subjectType: "story",
      subjectId: 7,
      userId: 42,
      action: "updated",
      metadata: { user: "User 42" },
    });
    expect(payload.changes).toEqual(
      expect.arrayContaining([
        { attribute: "title", oldValue: "Old title", newValue: "New title" },
        { attribute: "estimate", oldValue: 3, newValue: 8 },
      ]),
    );
  });

  it("resolves association changes to id/label pairs", async () => {
    const story = mockStory({ stateId: 3 });
    Story.findByPk.mockResolvedValue(story);
    StoryState.findByPk.mockImplementation((id) =>
      Promise.resolve({ id, name: id === 3 ? "In Progress" : "Done" }),
    );
    const req = {
      params: { projectId: "1", storyId: "7" },
      body: storyBody({ title: story.title, description: story.description, stateId: 4 }),
    };

    await controller.update(req, mockRes());

    const payload = recordActivity.mock.calls[0][0];
    expect(payload.changes).toEqual([
      {
        attribute: "state",
        oldValue: { id: 3, label: "In Progress" },
        newValue: { id: 4, label: "Done" },
      },
    ]);
  });

  it("records an assignment as a change from nothing to someone", async () => {
    const story = mockStory({ assigneeId: null });
    Story.findByPk.mockResolvedValue(story);
    User.findByPk.mockImplementation((id) =>
      Promise.resolve({ id, firstName: id === 8 ? "Grace" : "Ada", lastName: id === 8 ? "Hopper" : "Lovelace" }),
    );
    const req = {
      params: { projectId: "1", storyId: "7" },
      body: storyBody({ title: story.title, description: story.description, assigneeId: 8 }),
    };

    await controller.update(req, mockRes());

    const payload = recordActivity.mock.calls[0][0];
    expect(payload.changes).toEqual([
      { attribute: "assignee", oldValue: null, newValue: { id: 8, label: "Grace Hopper" } },
    ]);
  });

  it("records an unassignment as a change to nothing", async () => {
    const story = mockStory({ assigneeId: 8 });
    Story.findByPk.mockResolvedValue(story);
    const req = {
      params: { projectId: "1", storyId: "7" },
      body: storyBody({ title: story.title, description: story.description, assigneeId: null }),
    };

    await controller.update(req, mockRes());

    const payload = recordActivity.mock.calls[0][0];
    expect(payload.changes).toEqual([
      { attribute: "assignee", oldValue: { id: 8, label: "User 8" }, newValue: null },
    ]);
  });

  it("does not invent a reporter change when the body omits the reporter", async () => {
    // The edit form does not send reporterId, so the history must not claim
    // the reporter was cleared.
    const story = mockStory({ reporterId: 42 });
    Story.findByPk.mockResolvedValue(story);
    const body = storyBody({ title: story.title, description: story.description });
    delete body.reporterId;

    await controller.update({ params: { projectId: "1", storyId: "7" }, body }, mockRes());

    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("does not treat a string id from the request body as a change", async () => {
    // Request bodies arrive as JSON, so a numeric column can come back as a
    // string; the diff has to compare by value, not by type.
    const story = mockStory({ stateId: 3 });
    Story.findByPk.mockResolvedValue(story);
    const req = {
      params: { projectId: "1", storyId: "7" },
      body: storyBody({ title: story.title, description: story.description, stateId: "3", typeId: "2" }),
    };

    await controller.update(req, mockRes());

    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("records nothing when nothing changed", async () => {
    const story = mockStory();
    Story.findByPk.mockResolvedValue(story);
    const req = {
      params: { projectId: "1", storyId: "7" },
      body: {
        title: story.title,
        description: story.description,
        priority: story.priority,
        estimate: story.estimate,
        typeId: story.typeId,
        stateId: story.stateId,
        sprintId: story.sprintId,
        repositoryId: story.repositoryId,
        reporterId: story.reporterId,
        assigneeId: story.assigneeId,
        reviewerId: story.reviewerId,
      },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(story);
  });

  it("records the diff after the row is saved", async () => {
    const story = mockStory({ title: "Old title" });
    Story.findByPk.mockResolvedValue(story);
    const req = { params: { projectId: "1", storyId: "7" }, body: storyBody({ title: "New title" }) };

    await controller.update(req, mockRes());

    expect(story.update.mock.invocationCallOrder[0]).toBeLessThan(recordActivity.mock.invocationCallOrder[0]);
  });

  it("records nothing when the story is missing", async () => {
    Story.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.update({ params: { projectId: "1", storyId: "99" }, body: storyBody() }, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("reports a failure to record the history", async () => {
    const story = mockStory({ title: "Old title" });
    Story.findByPk.mockResolvedValue(story);
    recordActivity.mockRejectedValue(new Error("history write failed"));
    const req = { params: { projectId: "1", storyId: "7" }, body: storyBody({ title: "New title" }) };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "history write failed" });
  });
});
