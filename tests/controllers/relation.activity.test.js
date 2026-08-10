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

// Activity-history coverage for the relation controller. A relation touches
// two stories, so each mutation has to land on both stories' feeds with the
// direction flipped.
jest.mock("../../app/models", () => ({
  relation: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  story: { findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn() },
  user: { findByPk: jest.fn() },
  Sequelize: { Op: { in: "in", or: "or" } },
}));

jest.mock("../../app/utils/activity", () => ({
  recordActivity: jest.fn().mockResolvedValue(undefined),
  ACTIVITY_ACTION: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" },
  SUBJECT_TYPE: {
    STORY: "story",
    ACCEPTANCE_CRITERIA: "acceptanceCriteria",
    COMMENT: "comment",
    RELATION: "relation",
  },
  RELATION_DIRECTION: { OUTGOING: "outgoing", INCOMING: "incoming" },
}));

const db = require("../../app/models");
const Relation = db.relation;
const Story = db.story;
const User = db.user;
const { recordActivity } = require("../../app/utils/activity");
const controller = require("../../app/controllers/relation.controller");

let authenticate;

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

const STORY_ONE = { id: 3, title: "Add login page" };
const STORY_TWO = { id: 4, title: "Add logout button" };

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so restore the default resolve.
  recordActivity.mockResolvedValue(undefined);
  authenticate = jest.fn().mockResolvedValue({ userId: 42 });
  global.authenticate = authenticate;
  User.findByPk.mockResolvedValue({ id: 42, firstName: "Ada", lastName: "Lovelace" });
  // delete scopes the anchor story to the project; default to a story that
  // does belong to the project in the URL.
  Story.findOne.mockResolvedValue({ id: 3, projectId: "1" });
  Story.findByPk.mockImplementation((id) =>
    Promise.resolve(Number(id) === 3 ? STORY_ONE : Number(id) === 4 ? STORY_TWO : null),
  );
});

afterEach(() => {
  delete global.authenticate;
});

describe("create", () => {
  // Default happy path: story 3 (from the URL) blocks story 4.
  function createReq(overrides = {}) {
    return {
      params: { projectId: "1", storyId: "3" },
      body: { type: "BLOCKS", storyOneId: 3, storyTwoId: 4, ...overrides },
    };
  }

  function arrangeHappyPath() {
    Story.findAll.mockResolvedValue([STORY_ONE, STORY_TWO]);
    Relation.findOne.mockResolvedValue(null);
    Relation.create.mockResolvedValue({ id: 11, type: "BLOCKS", storyOneId: 3, storyTwoId: 4 });
  }

  it("writes an outgoing entry on the first story's feed", async () => {
    arrangeHappyPath();
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 3,
      subjectType: "relation",
      subjectId: 11,
      userId: 42,
      action: "created",
      metadata: {
        type: "BLOCKS",
        self: { id: 3, title: "Add login page" },
        other: { id: 4, title: "Add logout button" },
        user: "Ada Lovelace",
        direction: "outgoing",
      },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("writes a mirrored incoming entry on the second story's feed", async () => {
    arrangeHappyPath();

    await controller.create(createReq(), mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(2);
    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 4,
      subjectType: "relation",
      subjectId: 11,
      userId: 42,
      action: "created",
      metadata: {
        type: "BLOCKS",
        self: { id: 4, title: "Add logout button" },
        other: { id: 3, title: "Add login page" },
        user: "Ada Lovelace",
        direction: "incoming",
      },
    });
  });

  it("attributes both entries to the authenticated user without needing req.user", async () => {
    arrangeHappyPath();
    authenticate.mockResolvedValue({ userId: 77 });
    User.findByPk.mockResolvedValue({ id: 77, firstName: "Grace", lastName: "Hopper" });
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(recordActivity).toHaveBeenCalledTimes(2);
    for (const [payload] of recordActivity.mock.calls) {
      expect(payload.userId).toBe(77);
      expect(payload.metadata.user).toBe("Grace Hopper");
    }
    expect(res.status).not.toHaveBeenCalled();
  });

  it("records nothing when the relation type is invalid", async () => {
    const res = mockRes();

    await controller.create(createReq({ type: "NONSENSE" }), res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("records nothing when the stories are already related", async () => {
    Story.findAll.mockResolvedValue([STORY_ONE, STORY_TWO]);
    Relation.findOne.mockResolvedValue({ id: 1 });
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(Relation.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("reports a failure to record the history", async () => {
    arrangeHappyPath();
    recordActivity.mockRejectedValue(new Error("history write failed"));
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "history write failed" });
  });
});

describe("delete", () => {
  function arrangeRelation() {
    const relation = {
      id: 11,
      type: "BLOCKS",
      storyOneId: 3,
      storyTwoId: 4,
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    Relation.findOne.mockResolvedValue(relation);
    return relation;
  }

  it("writes an outgoing entry on the first story's feed", async () => {
    arrangeRelation();
    const req = { params: { projectId: "1", storyId: "3", relationId: "11" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 3,
      subjectType: "relation",
      subjectId: 11,
      userId: 42,
      action: "deleted",
      metadata: {
        type: "BLOCKS",
        self: { id: 3, title: "Add login page" },
        other: { id: 4, title: "Add logout button" },
        user: "Ada Lovelace",
        direction: "outgoing",
      },
    });
    expect(res.send).toHaveBeenCalledWith({ message: "Relation deleted successfully." });
  });

  it("writes a mirrored incoming entry on the second story's feed", async () => {
    arrangeRelation();
    const req = { params: { projectId: "1", storyId: "3", relationId: "11" } };

    await controller.delete(req, mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(2);
    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 4,
      subjectType: "relation",
      subjectId: 11,
      userId: 42,
      action: "deleted",
      metadata: {
        type: "BLOCKS",
        self: { id: 4, title: "Add logout button" },
        other: { id: 3, title: "Add login page" },
        user: "Ada Lovelace",
        direction: "incoming",
      },
    });
  });

  it("carries the deleted relation's type into the metadata", async () => {
    arrangeRelation().type = "DUPLICATES";
    const req = { params: { projectId: "1", storyId: "3", relationId: "11" } };

    await controller.delete(req, mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(2);
    for (const [payload] of recordActivity.mock.calls) {
      expect(payload.metadata.type).toBe("DUPLICATES");
    }
  });

  it("records both entries before the relation row is destroyed", async () => {
    const relation = arrangeRelation();
    const req = { params: { projectId: "1", storyId: "3", relationId: "11" } };

    await controller.delete(req, mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(2);
    expect(relation.destroy).toHaveBeenCalledTimes(1);
    const destroyedAt = relation.destroy.mock.invocationCallOrder[0];
    for (const order of recordActivity.mock.invocationCallOrder) {
      expect(order).toBeLessThan(destroyedAt);
    }
  });

  it("records nothing when the relation is missing", async () => {
    Relation.findOne.mockResolvedValue(null);
    const res = mockRes();

    await controller.delete({ params: { projectId: "1", storyId: "3", relationId: "99" } }, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
