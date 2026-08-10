// Every controller action is expected to authorize before it touches data.
// The individual controller suites stub authorization permissively so they can
// focus on behaviour; this file does the opposite — it asserts that each action
// asks the right question, and that a refusal reaches the client as a refusal
// instead of being swallowed into a 200 or a 500.
//
// The guard logic itself is covered in tests/authentication/authorization.test.js.

jest.mock("../../app/models", () => {
  const model = () => ({
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    bulkCreate: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([0]),
    destroy: jest.fn().mockResolvedValue(0),
  });
  return {
    story: model(),
    project: model(),
    projectMember: model(),
    sprint: model(),
    storyState: model(),
    storyType: model(),
    repository: model(),
    acceptanceCriteria: model(),
    comment: model(),
    relation: model(),
    activity: model(),
    activityChange: model(),
    retrospective: model(),
    standup: model(),
    user: model(),
    session: model(),
    Sequelize: { Op: { in: "in", or: "or", ne: "ne", like: "like" } },
  };
});

jest.mock("../../app/authentication/authorization", () => ({
  isAdmin: jest.fn().mockResolvedValue(false),
  requireAdmin: jest.fn().mockResolvedValue(undefined),
  requireSelfOrAdmin: jest.fn().mockResolvedValue(undefined),
  requireProjectMember: jest.fn().mockResolvedValue({ isManager: "1" }),
  requireMemberManagement: jest.fn().mockResolvedValue({ isManager: "1" }),
  assertBelongsToProject: jest.fn((record) => record),
}));

jest.mock("../../app/authentication/authentication", () => ({
  authenticate: jest.fn(),
  authenticateRoute: jest.fn((req, res, next) => next()),
}));

jest.mock("../../app/utils/email", () => ({
  notifyAssignedUser: jest.fn().mockResolvedValue(undefined),
  notifyReviewerUser: jest.fn().mockResolvedValue(undefined),
  notifyMentionedUser: jest.fn().mockResolvedValue(undefined),
  commentToPlainText: jest.fn(() => ""),
  storyUrl: jest.fn(() => "http://example.test/story"),
}));

jest.mock("../../app/utils/activity", () => ({
  ...jest.requireActual("../../app/utils/activity"),
  recordActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("axios", () => ({ get: jest.fn().mockResolvedValue({ data: {} }) }));

// crypto reads SECRET_KEY at load time; none of these tests exercise it
jest.mock("../../app/authentication/crypto", () => ({
  encrypt: jest.fn().mockResolvedValue("token"),
  decrypt: jest.fn().mockResolvedValue(1),
  getSalt: jest.fn().mockResolvedValue(Buffer.from("salt")),
  hashPassword: jest.fn().mockResolvedValue(Buffer.from("hash")),
}));

const db = require("../../app/models");
const {
  requireAdmin,
  requireSelfOrAdmin,
  requireProjectMember,
  requireMemberManagement,
} = require("../../app/authentication/authorization");
const { authenticate } = require("../../app/authentication/authentication");

const controllers = {
  story: require("../../app/controllers/story.controller"),
  project: require("../../app/controllers/project.controller"),
  projectMember: require("../../app/controllers/projectMember.controller"),
  sprint: require("../../app/controllers/sprint.controller"),
  backlog: require("../../app/controllers/backlog.controller"),
  storyState: require("../../app/controllers/storyState.controller"),
  storyType: require("../../app/controllers/storyType.controller"),
  repository: require("../../app/controllers/repository.controller"),
  acceptanceCriteria: require("../../app/controllers/acceptanceCriteria.controller"),
  comment: require("../../app/controllers/comment.controller"),
  relation: require("../../app/controllers/relation.controller"),
  activity: require("../../app/controllers/activity.controller"),
  retrospective: require("../../app/controllers/retrospective.controller"),
  standup: require("../../app/controllers/standup.controller"),
  user: require("../../app/controllers/user.controller"),
};

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

const CALLER = 42;

beforeEach(() => {
  jest.clearAllMocks();

  authenticate.mockResolvedValue({ userId: CALLER });
  // some controllers still reach the leaked global rather than the import
  global.authenticate = authenticate;

  requireAdmin.mockResolvedValue(undefined);
  requireSelfOrAdmin.mockResolvedValue(undefined);
  requireProjectMember.mockResolvedValue({ isManager: "1" });
  requireMemberManagement.mockResolvedValue({ isManager: "1" });

  // a permissive default world: every lookup finds a row in project 1
  for (const key of Object.keys(db)) {
    if (key === "Sequelize") continue;
    db[key].findAll.mockResolvedValue([]);
    db[key].findOne.mockResolvedValue({ id: 1, projectId: "1" });
    db[key].findByPk.mockResolvedValue({
      id: 1,
      projectId: "1",
      update: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    });
  }
});

afterEach(() => {
  delete global.authenticate;
});

// --- the guard matrix -------------------------------------------------------
// [name, action, request, guard, expected guard arguments]

const MEMBER_ACTIONS = [
  ["story.findOne", controllers.story.findOne, { userId: CALLER, params: { projectId: "1", storyId: "7" } }, ["1"]],
  ["story.findAllForProject", controllers.story.findAllForProject, { userId: CALLER, params: { id: "1" } }, ["1"]],
  ["story.create", controllers.story.create, { userId: CALLER, params: { id: "1" }, body: { title: "t", description: "d", stateId: 3 } }, ["1"]],
  ["story.update", controllers.story.update, { userId: CALLER, params: { projectId: "1", storyId: "7" }, body: { title: "t" } }, ["1"]],
  ["story.delete", controllers.story.delete, { userId: CALLER, params: { projectId: "1", storyId: "7" } }, ["1"]],

  ["backlog.findAllForProject", controllers.backlog.findAllForProject, { userId: CALLER, params: { id: "1" } }, ["1"]],
  ["backlog.assignSprint", controllers.backlog.assignSprint, { userId: CALLER, params: { id: "1", storyId: "7" }, body: { sprintId: 4 } }, ["1"]],

  ["project.findOne", controllers.project.findOne, { userId: CALLER, params: { id: "1" } }, ["1"]],
  ["project.update", controllers.project.update, { userId: CALLER, params: { id: "1" }, body: {} }, ["1"]],
  ["project.delete", controllers.project.delete, { userId: CALLER, params: { id: "1" } }, ["1"]],

  ["projectMember.findAllForProject", controllers.projectMember.findAllForProject, { userId: CALLER, params: { projectId: "1" } }, ["1"]],

  ["sprint.create", controllers.sprint.create, { userId: CALLER, body: { title: "s", startDate: "2026-01-01", endDate: "2026-01-14", projectId: "1" } }, ["1"]],
  ["sprint.createRecurring", controllers.sprint.createRecurring, { userId: CALLER, body: { title: "s", startDate: "2026-01-01", endDate: "2026-01-14", projectId: "1", recurrencePattern: "Weekly", recurrenceCount: 2 } }, ["1"]],
  ["sprint.findAllForProject", controllers.sprint.findAllForProject, { userId: CALLER, params: { projectId: "1" } }, ["1"]],
  ["sprint.findOne", controllers.sprint.findOne, { userId: CALLER, params: { id: "4" } }, ["1"]],
  ["sprint.update", controllers.sprint.update, { userId: CALLER, params: { id: "4" }, body: {} }, ["1"]],
  ["sprint.delete", controllers.sprint.delete, { userId: CALLER, params: { id: "4" } }, ["1"]],

  ["storyState.findAllForProject", controllers.storyState.findAllForProject, { userId: CALLER, params: { projectId: "1" } }, ["1"]],
  ["storyState.create", controllers.storyState.create, { userId: CALLER, params: { projectId: "1" }, body: { name: "n", order: 1 } }, ["1"]],
  ["storyState.update", controllers.storyState.update, { userId: CALLER, params: { projectId: "1", stateId: "2" }, body: { name: "n" } }, ["1"]],
  ["storyState.reorder", controllers.storyState.reorder, { userId: CALLER, params: { projectId: "1" }, body: { states: [{ id: 1 }] } }, ["1"]],
  ["storyState.delete", controllers.storyState.delete, { userId: CALLER, params: { projectId: "1", stateId: "2" }, body: { fallbackStateId: 3 } }, ["1"]],

  ["storyType.findAllForProject", controllers.storyType.findAllForProject, { userId: CALLER, params: { projectId: "1" } }, ["1"]],
  ["storyType.create", controllers.storyType.create, { userId: CALLER, params: { projectId: "1" }, body: { name: "n" } }, ["1"]],
  ["storyType.update", controllers.storyType.update, { userId: CALLER, params: { projectId: "1", typeId: "2" }, body: { name: "n" } }, ["1"]],
  ["storyType.delete", controllers.storyType.delete, { userId: CALLER, params: { projectId: "1", typeId: "2" } }, ["1"]],

  ["repository.create", controllers.repository.create, { userId: CALLER, params: { projectId: "1" }, body: { githubId: "9", name: "r" } }, ["1"]],
  ["repository.findAllForProject", controllers.repository.findAllForProject, { userId: CALLER, params: { projectId: "1" } }, ["1"]],
  ["repository.findOne", controllers.repository.findOne, { userId: CALLER, params: { id: "3" } }, ["1"]],
  ["repository.update", controllers.repository.update, { userId: CALLER, params: { id: "3" }, body: {} }, ["1"]],
  ["repository.delete", controllers.repository.delete, { userId: CALLER, params: { id: "3" } }, ["1"]],

  ["acceptanceCriteria.create", controllers.acceptanceCriteria.create, { userId: CALLER, params: { projectId: "1", storyId: "7" }, body: { title: "t", status: "s" } }, ["1"]],
  ["acceptanceCriteria.update", controllers.acceptanceCriteria.update, { userId: CALLER, params: { projectId: "1", storyId: "7", criterionId: "2" }, body: { title: "t", status: "s" } }, ["1"]],
  ["acceptanceCriteria.delete", controllers.acceptanceCriteria.delete, { userId: CALLER, params: { projectId: "1", storyId: "7", criterionId: "2" } }, ["1"]],

  ["comment.findAllForStory", controllers.comment.findAllForStory, { userId: CALLER, params: { projectId: "1", storyId: "7" } }, ["1"]],
  ["comment.createForStory", controllers.comment.createForStory, { userId: CALLER, params: { projectId: "1", storyId: "7" }, body: { content: "c" } }, ["1"]],
  ["comment.findAllForCriterion", controllers.comment.findAllForCriterion, { userId: CALLER, params: { projectId: "1", storyId: "7", criterionId: "2" } }, ["1"]],
  ["comment.createForCriterion", controllers.comment.createForCriterion, { userId: CALLER, params: { projectId: "1", storyId: "7", criterionId: "2" }, body: { content: "c" } }, ["1"]],

  ["relation.create", controllers.relation.create, { userId: CALLER, params: { projectId: "1", storyId: "3" }, body: { type: "BLOCKS", storyOneId: 3, storyTwoId: 4 } }, ["1"]],
  ["relation.delete", controllers.relation.delete, { userId: CALLER, params: { projectId: "1", storyId: "3", relationId: "11" } }, ["1"]],

  ["activity.findAllForStory", controllers.activity.findAllForStory, { userId: CALLER, params: { projectId: "1", storyId: "7" } }, ["1"]],
];

const ADMIN_ACTIONS = [
  ["story.findAll", controllers.story.findAll, { userId: CALLER }],
  ["project.findAll", controllers.project.findAll, { userId: CALLER }],
  ["projectMember.findAll", controllers.projectMember.findAll, { userId: CALLER }],
  ["sprint.findAll", controllers.sprint.findAll, { userId: CALLER }],
  ["storyState.findAll", controllers.storyState.findAll, { userId: CALLER }],
  ["storyType.findAll", controllers.storyType.findAll, { userId: CALLER }],
  ["repository.findAll", controllers.repository.findAll, { userId: CALLER }],
  ["acceptanceCriteria.findAll", controllers.acceptanceCriteria.findAll, { userId: CALLER }],
  ["comment.findAll", controllers.comment.findAll, { userId: CALLER }],
  ["relation.findAll", controllers.relation.findAll, { userId: CALLER }],
  ["activity.findAll", controllers.activity.findAll, { userId: CALLER }],
  ["retrospective.findAll", controllers.retrospective.findAll, { userId: CALLER }],
  ["standup.findAll", controllers.standup.findAll, { userId: CALLER }],
  ["user.deleteAll", controllers.user.deleteAll, { userId: CALLER }],
  ["user.findByEmail", controllers.user.findByEmail, { userId: CALLER, params: { email: "a@b.c" } }],
  ["project.adminCreate", controllers.project.adminCreate, { userId: CALLER, body: { title: "t", description: "d", deadline: "2099-01-01", managerId: 5 } }],
];

const MEMBER_MANAGEMENT_ACTIONS = [
  ["projectMember.create", controllers.projectMember.create, { userId: CALLER, params: {}, body: { userId: 7, projectId: "1", isManager: "0" } }],
  ["projectMember.update", controllers.projectMember.update, { userId: CALLER, params: { id: "5" }, body: { isManager: "1" } }],
  ["projectMember.delete", controllers.projectMember.delete, { userId: CALLER, params: { id: "5" } }],
];

const SELF_OR_ADMIN_ACTIONS = [
  ["projectMember.findAllForUser", controllers.projectMember.findAllForUser, { userId: CALLER, params: { userId: "7" } }, "7"],
  ["user.update", controllers.user.update, { userId: CALLER, params: { id: "7" }, body: { firstName: "A" } }, "7"],
  ["user.delete", controllers.user.delete, { userId: CALLER, params: { id: "7" } }, "7"],
];

// A guard that refuses, shaped the way the real module refuses.
function forbidden() {
  const error = new Error("You do not have access to this project.");
  error.statusCode = 403;
  return Promise.reject(error);
}

describe("project membership is required", () => {
  it.each(MEMBER_ACTIONS)("%s asks about the project in the request", async (_name, action, req, args) => {
    await action(req, mockRes());

    expect(requireProjectMember).toHaveBeenCalledWith(CALLER, ...args);
  });

  // These routes key off a bare resource id rather than a project id, so a
  // refusal is reported as 404 instead: answering 403 would confirm that the
  // id exists in some project the caller cannot see.
  const MASKED = new Set(["repository.findOne", "repository.update", "repository.delete"]);

  it.each(MEMBER_ACTIONS.filter(([name]) => !MASKED.has(name)))(
    "%s answers 403 when membership is refused",
    async (_name, action, req) => {
      requireProjectMember.mockImplementation(forbidden);
      const res = mockRes();

      await action(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        message: "You do not have access to this project.",
      });
    },
  );

  it.each(MEMBER_ACTIONS.filter(([name]) => MASKED.has(name)))(
    "%s answers 404 when membership is refused, so the id cannot be probed",
    async (_name, action, req) => {
      requireProjectMember.mockImplementation(forbidden);
      const res = mockRes();

      await action(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({ message: "Repository not found" });
    },
  );
});

describe("administrator access is required", () => {
  it.each(ADMIN_ACTIONS)("%s asks for administrator rights", async (_name, action, req) => {
    await action(req, mockRes());

    expect(requireAdmin).toHaveBeenCalledWith(CALLER);
  });

  it.each(ADMIN_ACTIONS)("%s answers 403 when refused", async (_name, action, req) => {
    requireAdmin.mockImplementation(() => {
      const error = new Error("Administrator access required.");
      error.statusCode = 403;
      return Promise.reject(error);
    });
    const res = mockRes();

    await action(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({
      message: "Administrator access required.",
    });
  });
});

describe("member management is manager-gated", () => {
  it.each(MEMBER_MANAGEMENT_ACTIONS)("%s asks for member-management rights", async (_name, action, req) => {
    await action(req, mockRes());

    expect(requireMemberManagement).toHaveBeenCalledWith(CALLER, "1");
  });

  it.each(MEMBER_MANAGEMENT_ACTIONS)("%s answers 403 when refused", async (_name, action, req) => {
    requireMemberManagement.mockImplementation(() => {
      const error = new Error("You must be a project manager to manage members.");
      error.statusCode = 403;
      return Promise.reject(error);
    });
    const res = mockRes();

    await action(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({
      message: "You must be a project manager to manage members.",
    });
  });

  it("does not create the membership row when refused", async () => {
    requireMemberManagement.mockImplementation(() => {
      const error = new Error("nope");
      error.statusCode = 403;
      return Promise.reject(error);
    });

    await controllers.projectMember.create(
      { userId: CALLER, params: {}, body: { userId: 7, projectId: "1", isManager: "1" } },
      mockRes(),
    );

    expect(db.projectMember.create).not.toHaveBeenCalled();
  });
});

describe("acting on another user is self-or-admin gated", () => {
  it.each(SELF_OR_ADMIN_ACTIONS)("%s checks the target user", async (_name, action, req, target) => {
    await action(req, mockRes());

    expect(requireSelfOrAdmin).toHaveBeenCalledWith(CALLER, target);
  });

  it.each(SELF_OR_ADMIN_ACTIONS)("%s answers 403 when refused", async (_name, action, req) => {
    requireSelfOrAdmin.mockImplementation(() => {
      const error = new Error("You do not have access to this user.");
      error.statusCode = 403;
      return Promise.reject(error);
    });
    const res = mockRes();

    await action(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("the user directory is signed-in only", () => {
  it.each([
    ["findAll", controllers.user.findAll, { query: {} }],
    ["findOne", controllers.user.findOne, { params: { id: "7" } }],
  ])("user.%s answers 401 without a caller", async (_name, action, req) => {
    const res = mockRes();

    await action(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({
      message: "Authentication required.",
    });
  });

  it.each([
    ["findAll", controllers.user.findAll, { userId: CALLER, query: {} }],
    ["findOne", controllers.user.findOne, { userId: CALLER, params: { id: "7" } }],
  ])("user.%s serves a signed-in caller", async (_name, action, req) => {
    const res = mockRes();

    await action(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
  });
});

describe("privilege escalation through user.update", () => {
  it("refuses to set isAdmin for a non-administrator caller", async () => {
    const { isAdmin } = require("../../app/authentication/authorization");
    isAdmin.mockResolvedValue(false);
    const user = { id: 7, update: jest.fn().mockResolvedValue(undefined) };
    db.user.findByPk.mockResolvedValue(user);
    const res = mockRes();

    await controllers.user.update(
      { userId: CALLER, params: { id: "7" }, body: { firstName: "A", isAdmin: true } },
      res,
    );

    expect(user.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("lets an administrator grant the flag", async () => {
    const { isAdmin } = require("../../app/authentication/authorization");
    isAdmin.mockResolvedValue(true);
    const user = { id: 7, update: jest.fn().mockResolvedValue(undefined) };
    db.user.findByPk.mockResolvedValue(user);

    await controllers.user.update(
      { userId: CALLER, params: { id: "7" }, body: { firstName: "A", isAdmin: true } },
      mockRes(),
    );

    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ isAdmin: true }),
    );
  });

  it("never passes isAdmin through when the body omits it", async () => {
    const user = { id: 7, update: jest.fn().mockResolvedValue(undefined) };
    db.user.findByPk.mockResolvedValue(user);

    await controllers.user.update(
      { userId: CALLER, params: { id: "7" }, body: { firstName: "A" } },
      mockRes(),
    );

    expect(user.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ isAdmin: expect.anything() }),
    );
  });
});
