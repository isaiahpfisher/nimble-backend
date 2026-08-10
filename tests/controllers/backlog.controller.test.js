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

// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  story: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  sprint: {
    findByPk: jest.fn(),
  },
  systemLog: {
    create: jest.fn(),
  },
  // Sentinels for the associations the finders eager-load; the controller only
  // passes these through to Sequelize, so identity is all the tests need.
  storyState: { name: "storyState" },
  storyType: { name: "storyType" },
  user: { name: "user" },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const Story = db.story;
const Sprint = db.sprint;
const controller = require("../../app/controllers/backlog.controller");

// Builds a stubbed Express response whose chainable methods we can assert on.
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("findAllForProject", () => {
  it("sends stories scoped to the project with no sprint assigned", async () => {
    const stories = [{ id: 1 }];
    Story.findAll.mockResolvedValue(stories);
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    expect(Story.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "1", sprintId: null },
      }),
    );
    expect(res.send).toHaveBeenCalledWith(stories);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not filter by state, since states are user-customizable", async () => {
    Story.findAll.mockResolvedValue([]);
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    const { include } = Story.findAll.mock.calls[0][0];
    const stateInclude = include.find((i) => i.model === db.storyState);

    expect(stateInclude).toEqual({ model: db.storyState, as: "state" });
  });

  it("eager-loads type and assignee, and does not load sprint", async () => {
    Story.findAll.mockResolvedValue([]);
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    const { include } = Story.findAll.mock.calls[0][0];

    expect(include).toEqual(
      expect.arrayContaining([{ model: db.storyType, as: "type" }]),
    );

    expect(include.some((i) => i.model === db.sprint)).toBe(false);

    const assigneeInclude = include.find(
      (i) => i.model === db.user && i.as === "assignee",
    );
    expect(assigneeInclude.attributes).toEqual([
      "id",
      "firstName",
      "lastName",
      "email",
    ]);
  });

  it("responds 500 when the query fails", async () => {
    Story.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("assignSprint", () => {
  function req(overrides = {}) {
    return {
      params: { id: "1", storyId: "7" },
      body: { sprintId: 4 },
      ...overrides,
    };
  }

  it("assigns the sprint and sends a success message", async () => {
    const story = {
      id: 7,
      projectId: "1",
      update: jest.fn().mockResolvedValue(undefined),
    };

    Story.findByPk.mockResolvedValue(story);
    Sprint.findByPk.mockResolvedValue({ id: 4, projectId: "1" });

    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(story.update).toHaveBeenCalledWith({ sprintId: 4 });
    expect(Story.findByPk).toHaveBeenCalledTimes(1);
    expect(Story.findByPk).toHaveBeenCalledWith("7");
    expect(res.send).toHaveBeenCalledWith({
      message: "Story assigned to sprint successfully!",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when sprintId is missing", async () => {
    const res = mockRes();

    await controller.assignSprint(req({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Missing required fields.",
    });
    expect(Story.findByPk).not.toHaveBeenCalled();
  });

  it("responds 404 when the story does not exist", async () => {
    Story.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 7.",
    });
    expect(Sprint.findByPk).not.toHaveBeenCalled();
  });

  it("responds 404 when the story belongs to a different project", async () => {
    Story.findByPk.mockResolvedValue({ id: 7, projectId: "2" });
    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 7.",
    });
    expect(Sprint.findByPk).not.toHaveBeenCalled();
  });

  it("responds 404 when the sprint does not exist", async () => {
    Story.findByPk.mockResolvedValue({ id: 7, projectId: "1" });
    Sprint.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Sprint with id = 4.",
    });
  });

  it("responds 404 when the sprint belongs to a different project", async () => {
    Story.findByPk.mockResolvedValue({ id: 7, projectId: "1" });
    Sprint.findByPk.mockResolvedValue({ id: 4, projectId: "2" });
    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Sprint with id = 4.",
    });
  });

  it("responds 500 when the update fails", async () => {
    const story = {
      id: 7,
      projectId: "1",
      update: jest.fn().mockRejectedValue(new Error("write failed")),
    };
    Story.findByPk.mockResolvedValue(story);
    Sprint.findByPk.mockResolvedValue({ id: 4, projectId: "1" });
    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});