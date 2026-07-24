// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  acceptanceCriteria: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  story: {
    findOne: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const AcceptanceCriteria = db.acceptanceCriteria;
const Story = db.story;
const controller = require("../../app/controllers/acceptanceCriteria.controller");

// The controller calls a bare `authenticate(...)`, which resolves to the global
// that app/authentication/authentication.js assigns at load time rather than to
// an imported binding, so the stub has to be installed on the global too.
let authenticate;

// Builds a stubbed Express response whose chainable methods we can assert on.
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

beforeEach(() => {
  jest.clearAllMocks();
  authenticate = jest.fn().mockResolvedValue({ userId: 42 });
  global.authenticate = authenticate;
});

afterEach(() => {
  delete global.authenticate;
});

describe("findAll", () => {
  it("sends all acceptance criteria", async () => {
    const criteria = [{ id: 1 }, { id: 2 }];
    AcceptanceCriteria.findAll.mockResolvedValue(criteria);
    const res = mockRes();

    await controller.findAll({}, res);

    expect(AcceptanceCriteria.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(criteria);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    AcceptanceCriteria.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("create", () => {
  it("creates a criterion under the story", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    const created = { id: 9 };
    AcceptanceCriteria.create.mockResolvedValue(created);
    const req = { params: { projectId: "1", storyId: "3" }, body: criterionBody() };
    const res = mockRes();

    await controller.create(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(Story.findOne).toHaveBeenCalledWith({
      where: { id: "3", projectId: "1" },
    });
    expect(AcceptanceCriteria.create).toHaveBeenCalledWith({
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      storyId: "3",
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the story is not in the project", async () => {
    Story.findOne.mockResolvedValue(null);
    const req = { params: { projectId: "1", storyId: "99" }, body: criterionBody() };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 99.",
    });
    expect(AcceptanceCriteria.create).not.toHaveBeenCalled();
  });

  it("responds 400 when the title is missing", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    const req = {
      params: { projectId: "1", storyId: "3" },
      body: criterionBody({ title: undefined }),
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Acceptance criteria must have a title.",
    });
    expect(AcceptanceCriteria.create).not.toHaveBeenCalled();
  });

  it("responds 400 when the status is missing", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    const req = {
      params: { projectId: "1", storyId: "3" },
      body: criterionBody({ status: undefined }),
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Acceptance criteria must have a status.",
    });
    expect(AcceptanceCriteria.create).not.toHaveBeenCalled();
  });

  it("responds 500 when authentication throws", async () => {
    global.authenticate = jest.fn().mockRejectedValue(new Error("no auth"));
    const req = { params: { projectId: "1", storyId: "3" }, body: criterionBody() };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(Story.findOne).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("updates the criterion and sends it back", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    const criterion = { id: 9, update: jest.fn().mockResolvedValue(undefined) };
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "9" },
      body: criterionBody({ status: "FAILED" }),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(AcceptanceCriteria.findOne).toHaveBeenCalledWith({
      where: { id: "9", storyId: "3" },
    });
    expect(criterion.update).toHaveBeenCalledWith({
      title: req.body.title,
      description: req.body.description,
      status: "FAILED",
    });
    expect(res.send).toHaveBeenCalledWith(criterion);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the criterion is missing", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "77" },
      body: criterionBody(),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Acceptance Criteria with id = 77.",
    });
  });

  it("responds 400 when the body fails validation", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "9" },
      body: criterionBody({ title: "" }),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(AcceptanceCriteria.findOne).not.toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    AcceptanceCriteria.findOne.mockResolvedValue({
      id: 9,
      update: jest.fn().mockRejectedValue(new Error("write failed")),
    });
    const req = {
      params: { projectId: "1", storyId: "3", criterionId: "9" },
      body: criterionBody(),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});

describe("delete", () => {
  it("destroys the criterion", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    const criterion = { id: 9, destroy: jest.fn().mockResolvedValue(undefined) };
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = { params: { projectId: "1", storyId: "3", criterionId: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(criterion.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Acceptance criteria deleted successfully.",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the story is not in the project", async () => {
    Story.findOne.mockResolvedValue(null);
    const req = { params: { projectId: "1", storyId: "99", criterionId: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(AcceptanceCriteria.findOne).not.toHaveBeenCalled();
  });

  it("responds 404 when the criterion is missing", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = { params: { projectId: "1", storyId: "3", criterionId: "77" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Acceptance Criteria with id = 77.",
    });
  });

  it("responds 500 when the destroy fails", async () => {
    Story.findOne.mockResolvedValue({ id: 3 });
    AcceptanceCriteria.findOne.mockResolvedValue({
      id: 9,
      destroy: jest.fn().mockRejectedValue(new Error("locked")),
    });
    const req = { params: { projectId: "1", storyId: "3", criterionId: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "locked" });
  });
});
