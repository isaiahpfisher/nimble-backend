// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  project: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
  projectMember: {
    create: jest.fn(),
  },
  // Sentinels for the associations findOne eager-loads; the controller only
  // passes these through to Sequelize, so identity is all the tests need.
  // `user` also needs a real finder for adminCreate's manager lookup.
  user: { name: "user", findByPk: jest.fn() },
  storyType: { name: "storyType", bulkCreate: jest.fn() },
  storyState: { name: "storyState", bulkCreate: jest.fn(), findOne: jest.fn() },
  sprint: { name: "sprint" },
  repository: { name: "repository" },
  Sequelize: { Op: {} },
}));

jest.mock("../../app/authentication/authentication", () => ({
  authenticate: jest.fn(),
}));

const db = require("../../app/models");
const Project = db.project;
const ProjectMember = db.projectMember;
const { authenticate } = require("../../app/authentication/authentication");
const controller = require("../../app/controllers/project.controller");

// Builds a stubbed Express response whose chainable methods we can assert on.
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

// A deadline safely in the future for the "happy path" validation checks.
function futureDeadline() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("findAll", () => {
  it("sends all projects", async () => {
    const projects = [{ id: 1 }, { id: 2 }];
    Project.findAll.mockResolvedValue(projects);
    const req = {};
    const res = mockRes();

    await controller.findAll(req, res);

    expect(Project.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(projects);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    Project.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("findAllForUser", () => {
  it("sends projects scoped to the authenticated user", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const projects = [{ id: 1 }];
    Project.findAll.mockResolvedValue(projects);
    const req = {};
    const res = mockRes();

    await controller.findAllForUser(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(Project.findAll).toHaveBeenCalledWith({
      include: {
        model: db.projectMember,
        as: "projectMembers",
        where: { userId: 42 },
        attributes: [],
      },
    });
    expect(res.send).toHaveBeenCalledWith(projects);
  });

  it("responds 500 when authentication throws", async () => {
    authenticate.mockRejectedValue(new Error("no auth"));
    const res = mockRes();

    await controller.findAllForUser({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(Project.findAll).not.toHaveBeenCalled();
  });
});

describe("findOne", () => {
  it("sends the project when found", async () => {
    const project = { id: 7 };
    Project.findByPk.mockResolvedValue(project);
    const req = { params: { id: "7" } };
    const res = mockRes();

    await controller.findOne(req, res);

    expect(Project.findByPk).toHaveBeenCalledWith("7", {
      include: [
        { model: db.storyType, as: "storyType" },
        { model: db.storyState, as: "storyState" },
        { model: db.sprint, as: "sprint" },
        { model: db.repository, as: "repository" },
        { model: db.storyState, as: "branchCreationState" },
        { model: db.storyState, as: "prReviewState" },
        {
          model: db.projectMember,
          as: "projectMembers",
          include: {
            model: db.user,
            as: "user",
            required: false,
            attributes: ["id", "firstName", "lastName", "email"],
          },
        },
      ],
    });
    expect(res.send).toHaveBeenCalledWith(project);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the project is missing", async () => {
    Project.findByPk.mockResolvedValue(null);
    const req = { params: { id: "99" } };
    const res = mockRes();

    await controller.findOne(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Project with id = 99.",
    });
  });

  it("responds 500 when the query fails", async () => {
    Project.findByPk.mockRejectedValue(new Error("boom"));
    const req = { params: { id: "1" } };
    const res = mockRes();

    await controller.findOne(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("create", () => {
  it("creates a project and a manager membership", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const created = { id: 5, update: jest.fn().mockResolvedValue({}) };
    Project.create.mockResolvedValue(created);
    ProjectMember.create.mockResolvedValue({});
    // Seeded states come back with ids so the controller can point the
    // project's completedStateId at the last one.
    db.storyState.bulkCreate.mockResolvedValue([
      { id: 10 },
      { id: 11 },
      { id: 12 },
    ]);
    const req = {
      body: {
        title: "New Project",
        description: "A description",
        deadline: futureDeadline(),
      },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(Project.create).toHaveBeenCalledWith({
      title: req.body.title,
      description: req.body.description,
      deadline: req.body.deadline,
    });
    expect(ProjectMember.create).toHaveBeenCalledWith({
      userId: 42,
      projectId: 5,
      isManager: true,
    });
    // The new project is seeded with the default story types and states,
    // each scoped to the project that was just created.
    expect(db.storyType.bulkCreate).toHaveBeenCalledTimes(1);
    const seededTypes = db.storyType.bulkCreate.mock.calls[0][0];
    expect(seededTypes.length).toBeGreaterThan(0);
    expect(seededTypes.every((t) => t.projectId === 5)).toBe(true);
    expect(db.storyState.bulkCreate).toHaveBeenCalledTimes(1);
    const seededStates = db.storyState.bulkCreate.mock.calls[0][0];
    expect(seededStates.length).toBeGreaterThan(0);
    expect(seededStates.every((s) => s.projectId === 5)).toBe(true);
    // The project's completed state is pointed at the last seeded state.
    expect(created.update).toHaveBeenCalledWith({ completedStateId: 12 });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when a required field is missing", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const req = { body: { title: "No deadline", description: "x" } };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(Project.create).not.toHaveBeenCalled();
  });

  it("responds 400 for a non-parseable deadline", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const req = {
      body: { title: "t", description: "d", deadline: "not-a-date" },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Invalid deadline." });
    expect(Project.create).not.toHaveBeenCalled();
  });

  it("responds 400 for a deadline in the past", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const req = {
      body: { title: "t", description: "d", deadline: "2000-01-01" },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Invalid deadline." });
    expect(Project.create).not.toHaveBeenCalled();
  });

  it("responds 500 when project creation fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    Project.create.mockRejectedValue(new Error("insert failed"));
    const req = {
      body: { title: "t", description: "d", deadline: futureDeadline() },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "insert failed" });
    expect(ProjectMember.create).not.toHaveBeenCalled();
  });
});

describe("adminCreate", () => {
  it("creates a project owned by the named manager and seeds defaults", async () => {
    db.user.findByPk.mockResolvedValue({ id: 7 });
    const created = { id: 5, update: jest.fn().mockResolvedValue({}) };
    Project.create.mockResolvedValue(created);
    ProjectMember.create.mockResolvedValue({});
    db.storyState.bulkCreate.mockResolvedValue([{ id: 20 }, { id: 21 }]);
    const req = {
      body: {
        title: "New Project",
        description: "A description",
        deadline: futureDeadline(),
        managerId: 7,
      },
    };
    const res = mockRes();

    await controller.adminCreate(req, res);

    expect(db.user.findByPk).toHaveBeenCalledWith(7);
    expect(ProjectMember.create).toHaveBeenCalledWith({
      userId: 7,
      projectId: 5,
      isManager: true,
    });
    const seededTypes = db.storyType.bulkCreate.mock.calls[0][0];
    expect(seededTypes.every((t) => t.projectId === 5)).toBe(true);
    const seededStates = db.storyState.bulkCreate.mock.calls[0][0];
    expect(seededStates.every((s) => s.projectId === 5)).toBe(true);
    expect(created.update).toHaveBeenCalledWith({ completedStateId: 21 });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when a required field is missing", async () => {
    const req = {
      body: { title: "t", description: "d", deadline: futureDeadline() },
    };
    const res = mockRes();

    await controller.adminCreate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(Project.create).not.toHaveBeenCalled();
  });

  it("responds 400 for an invalid deadline", async () => {
    const req = {
      body: { title: "t", description: "d", deadline: "2000-01-01", managerId: 7 },
    };
    const res = mockRes();

    await controller.adminCreate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Invalid deadline." });
    expect(Project.create).not.toHaveBeenCalled();
  });

  it("responds 404 when the manager does not exist", async () => {
    db.user.findByPk.mockResolvedValue(null);
    const req = {
      body: {
        title: "t",
        description: "d",
        deadline: futureDeadline(),
        managerId: 99,
      },
    };
    const res = mockRes();

    await controller.adminCreate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find User with id = 99.",
    });
    expect(Project.create).not.toHaveBeenCalled();
  });

  it("responds 500 when project creation fails", async () => {
    db.user.findByPk.mockResolvedValue({ id: 7 });
    Project.create.mockRejectedValue(new Error("insert failed"));
    const req = {
      body: {
        title: "t",
        description: "d",
        deadline: futureDeadline(),
        managerId: 7,
      },
    };
    const res = mockRes();

    await controller.adminCreate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "insert failed" });
    expect(ProjectMember.create).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("updates the project with the provided fields", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const update = jest.fn().mockResolvedValue({});
    const project = { id: 3, update };
    Project.findByPk.mockResolvedValue(project);
    const req = {
      params: { id: "3" },
      body: { title: "Updated", description: "d", deadline: futureDeadline() },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(update).toHaveBeenCalledWith({
      title: "Updated",
      description: "d",
      deadline: req.body.deadline,
      branchCreationStateId: undefined,
      prReviewStateId: undefined,
    });
    expect(res.send).toHaveBeenCalledWith(project);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("updates the branch-creation and PR-review state ids", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const update = jest.fn().mockResolvedValue({});
    const project = { id: 3, update };
    Project.findByPk.mockResolvedValue(project);
    const req = {
      params: { id: "3" },
      body: { branchCreationStateId: 11, prReviewStateId: 22 },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(update).toHaveBeenCalledWith({
      title: undefined,
      description: undefined,
      deadline: undefined,
      branchCreationStateId: 11,
      prReviewStateId: 22,
    });
    expect(res.send).toHaveBeenCalledWith(project);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("updates without a deadline (skips deadline validation)", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const update = jest.fn().mockResolvedValue({});
    const project = { id: 3, update };
    Project.findByPk.mockResolvedValue(project);
    const req = {
      params: { id: "3" },
      body: { title: "Only title" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(update).toHaveBeenCalledWith({
      title: "Only title",
      description: undefined,
      deadline: undefined,
      branchCreationStateId: undefined,
      prReviewStateId: undefined,
    });
    expect(res.send).toHaveBeenCalledWith(project);
  });

  it("responds 404 when the project does not exist", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    Project.findByPk.mockResolvedValue(null);
    const req = { params: { id: "99" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Project with id = 99.",
    });
  });

  it("updates the completed state id when it references a real state", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const update = jest.fn().mockResolvedValue({});
    const project = { id: 3, update };
    Project.findByPk.mockResolvedValue(project);
    db.storyState.findOne.mockResolvedValue({ id: 12 });
    const req = { params: { id: "3" }, body: { completedStateId: 12 } };
    const res = mockRes();

    await controller.update(req, res);

    expect(db.storyState.findOne).toHaveBeenCalledWith({ where: { id: 12 } });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ completedStateId: 12 }),
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the completed state id is not a real state", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const update = jest.fn();
    Project.findByPk.mockResolvedValue({ id: 3, update });
    db.storyState.findOne.mockResolvedValue(null);
    const req = { params: { id: "3" }, body: { completedStateId: 999 } };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Invalid completed state." });
    expect(update).not.toHaveBeenCalled();
  });

  it("responds 400 for an invalid deadline", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const project = { id: 3, update: jest.fn() };
    Project.findByPk.mockResolvedValue(project);
    const req = {
      params: { id: "3" },
      body: { deadline: "2000-01-01" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Invalid deadline." });
    expect(project.update).not.toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const project = {
      id: 3,
      update: jest.fn().mockRejectedValue(new Error("update failed")),
    };
    Project.findByPk.mockResolvedValue(project);
    const req = { params: { id: "3" }, body: { title: "t" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "update failed" });
  });
});

describe("delete", () => {
  it("destroys the project and confirms", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const destroy = jest.fn().mockResolvedValue({});
    const project = { id: 3, destroy };
    Project.findByPk.mockResolvedValue(project);
    const req = { params: { id: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Project deleted successfully!",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the project does not exist", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    Project.findByPk.mockResolvedValue(null);
    const req = { params: { id: "99" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Project with id = 99.",
    });
  });

  it("responds 500 when the destroy fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const project = {
      id: 3,
      destroy: jest.fn().mockRejectedValue(new Error("delete failed")),
    };
    Project.findByPk.mockResolvedValue(project);
    const req = { params: { id: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "delete failed" });
  });
});
