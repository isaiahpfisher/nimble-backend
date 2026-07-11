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

    expect(Project.findByPk).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({
        include: expect.objectContaining({
          model: db.projectMember,
          as: "projectMembers",
        }),
      }),
    );
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
    const created = { id: 5 };
    Project.create.mockResolvedValue(created);
    ProjectMember.create.mockResolvedValue({});
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
