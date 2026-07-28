// Activity-history coverage for the acceptance criteria controller. The models
// module is mocked so requiring the controller never opens a real DB
// connection, and the activity util is mocked so the recorded payload can be
// asserted directly.
jest.mock("../../app/models", () => ({
  acceptanceCriteria: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  story: { findOne: jest.fn() },
  user: { findByPk: jest.fn() },
  Sequelize: { Op: {} },
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
}));

const db = require("../../app/models");
const AcceptanceCriteria = db.acceptanceCriteria;
const Story = db.story;
const User = db.user;
const { recordActivity } = require("../../app/utils/activity");
const controller = require("../../app/controllers/acceptanceCriteria.controller");

let authenticate;

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

function criterionBody(overrides = {}) {
  return {
    title: "Login succeeds",
    description: "User can sign in with valid credentials",
    status: "PASSED",
    ...overrides,
  };
}

// A criterion whose update() actually applies the patch, so the controller's
// before/after diff sees the same values a real Sequelize instance would.
function mockCriterion(attrs = {}) {
  const criterion = {
    id: 9,
    title: "Login succeeds",
    description: "User can sign in with valid credentials",
    status: "PENDING",
    ...attrs,
  };
  criterion.update = jest.fn(async (patch) => Object.assign(criterion, patch));
  criterion.destroy = jest.fn().mockResolvedValue(undefined);
  return criterion;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so restore the default resolve.
  recordActivity.mockResolvedValue(undefined);
  authenticate = jest.fn().mockResolvedValue({ userId: 42 });
  global.authenticate = authenticate;
  Story.findOne.mockResolvedValue({ id: 3 });
  User.findByPk.mockResolvedValue({ id: 42, firstName: "Ada", lastName: "Lovelace" });
});

afterEach(() => {
  delete global.authenticate;
});

describe("create", () => {
  it("records a created activity for the new criterion", async () => {
    AcceptanceCriteria.create.mockResolvedValue({ id: 9, title: "Login succeeds" });
    const req = { params: { projectId: "1", storyId: "3" }, body: criterionBody() };

    await controller.create(req, mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith({
      storyId: "3",
      subjectType: "acceptanceCriteria",
      subjectId: 9,
      userId: 42,
      action: "created",
      metadata: { title: "Login succeeds", status: "PASSED", user: "Ada Lovelace" },
    });
  });

  it("attributes the activity to the authenticated user", async () => {
    authenticate.mockResolvedValue({ userId: 77 });
    User.findByPk.mockResolvedValue({ id: 77, firstName: "Grace", lastName: "Hopper" });
    AcceptanceCriteria.create.mockResolvedValue({ id: 9, title: "Login succeeds" });
    const req = { params: { projectId: "1", storyId: "3" }, body: criterionBody() };

    await controller.create(req, mockRes());

    expect(User.findByPk).toHaveBeenCalledWith(77);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 77, metadata: expect.objectContaining({ user: "Grace Hopper" }) }),
    );
  });

  it("does not record anything when validation rejects the body", async () => {
    const req = {
      params: { projectId: "1", storyId: "3" },
      body: criterionBody({ title: undefined }),
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("surfaces a failure to record the activity instead of reporting success", async () => {
    AcceptanceCriteria.create.mockResolvedValue({ id: 9, title: "Login succeeds" });
    recordActivity.mockRejectedValue(new Error("history write failed"));
    const req = { params: { projectId: "1", storyId: "3" }, body: criterionBody() };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "history write failed" });
  });
});

describe("update", () => {
  it("records only the fields that actually changed", async () => {
    const criterion = mockCriterion({ title: "Old title", status: "PENDING" });
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "9" },
      body: criterionBody({ title: "New title", description: criterion.description, status: "PENDING" }),
    };

    await controller.update(req, mockRes());

    expect(recordActivity).toHaveBeenCalledTimes(1);
    const payload = recordActivity.mock.calls[0][0];
    expect(payload.changes).toEqual([{ attribute: "title", oldValue: "Old title", newValue: "New title" }]);
  });

  it("records each changed field with both sides of the change", async () => {
    const criterion = mockCriterion({ title: "Old", description: "Old desc", status: "PENDING" });
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "9" },
      body: criterionBody({ title: "New", description: "New desc", status: "PASSED" }),
    };

    await controller.update(req, mockRes());

    const payload = recordActivity.mock.calls[0][0];
    expect(payload).toMatchObject({
      storyId: "3",
      subjectType: "acceptanceCriteria",
      subjectId: 9,
      userId: 42,
      action: "updated",
      metadata: { user: "Ada Lovelace", title: "New", status: "PASSED" },
    });
    expect(payload.changes).toEqual([
      { attribute: "title", oldValue: "Old", newValue: "New" },
      { attribute: "description", oldValue: "Old desc", newValue: "New desc" },
      { attribute: "status", oldValue: "PENDING", newValue: "PASSED" },
    ]);
  });

  it("records nothing when the update is a no-op", async () => {
    const criterion = mockCriterion({ status: "PASSED" });
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "9" },
      body: criterionBody({
        title: criterion.title,
        description: criterion.description,
        status: "PASSED",
      }),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(criterion);
  });

  it("records nothing when the criterion is missing", async () => {
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "77" },
      body: criterionBody(),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("delete", () => {
  it("records the deletion before the row is destroyed", async () => {
    const criterion = mockCriterion({ title: "Login succeeds", status: "PASSED" });
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = { params: { projectId: "1", storyId: "3", criterionId: "9" } };

    await controller.delete(req, mockRes());

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: "3",
      subjectType: "acceptanceCriteria",
      subjectId: 9,
      userId: 42,
      action: "deleted",
      metadata: { title: "Login succeeds", status: "PASSED", user: "Ada Lovelace" },
    });
    // The metadata is read off the row, so it has to be captured first.
    expect(recordActivity.mock.invocationCallOrder[0]).toBeLessThan(criterion.destroy.mock.invocationCallOrder[0]);
  });

  it("leaves the criterion in place when the history write fails", async () => {
    const criterion = mockCriterion();
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    recordActivity.mockRejectedValue(new Error("history write failed"));
    const req = { params: { projectId: "1", storyId: "3", criterionId: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(criterion.destroy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("records nothing when the criterion is missing", async () => {
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = { params: { projectId: "1", storyId: "3", criterionId: "77" } };

    await controller.delete(req, mockRes());

    expect(recordActivity).not.toHaveBeenCalled();
  });
});
