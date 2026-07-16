// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  projectMember: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

jest.mock("../../app/authentication/authentication", () => ({
  authenticate: jest.fn(),
}));

const db = require("../../app/models");
const ProjectMember = db.projectMember;
const { authenticate } = require("../../app/authentication/authentication");
const controller = require("../../app/controllers/projectMember.controller");

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

describe("findAll", () => {
  it("sends all projectMembers", async () => {
    const projectMembers = [{ id: 1 }, { id: 2 }];
    ProjectMember.findAll.mockResolvedValue(projectMembers);
    const req = {};
    const res = mockRes();

    await controller.findAll(req, res);

    expect(ProjectMember.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(projectMembers);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    ProjectMember.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("findAllForUser", () => {
  it("sends projectMembers scoped to a specific user", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const projectMembers = [{ id: 1 }];
    ProjectMember.findAll.mockResolvedValue(projectMembers);
    const req = { params: { userId: 42 } };
    const res = mockRes();

    await controller.findAllForUser(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(ProjectMember.findAll).toHaveBeenCalledWith({
            where: { userId: 42 },
        });
    expect(res.send).toHaveBeenCalledWith(projectMembers);
  });

  it("responds 500 when authentication throws", async () => {
    authenticate.mockRejectedValue(new Error("no auth"));
    const res = mockRes();

    await controller.findAllForUser({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(ProjectMember.findAll).not.toHaveBeenCalled();
  });
});

describe("findOne", () => {
  it("sends the projectMember when found", async () => {
    const projectMember = { id: 7 };
    ProjectMember.findByPk.mockResolvedValue(projectMember);
    const req = { params: { id: "7" } };
    const res = mockRes();

    await controller.findOne(req, res);

    expect(ProjectMember.findByPk).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({
      }),
    );
    expect(res.send).toHaveBeenCalledWith(projectMember);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the projectMember is missing", async () => {
    ProjectMember.findByPk.mockResolvedValue(null);
    const req = { params: { id: "99" } };
    const res = mockRes();

    await controller.findOne(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find ProjectMember with id = 99.",
    });
  });

  it("responds 500 when the query fails", async () => {
    ProjectMember.findByPk.mockRejectedValue(new Error("boom"));
    const req = { params: { id: "1" } };
    const res = mockRes();

    await controller.findOne(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("create", () => {
  it("creates a projectMember", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const created = { id: 5 };
    ProjectMember.create.mockResolvedValue(created);
    const req = {
      body: {
        userId: 42,
        projectId: 5,
        isManager: true,
      },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(ProjectMember.create).toHaveBeenCalledWith({
      userId: req.body.userId,
      projectId: req.body.projectId,
      isManager: req.body.isManager,
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when a required field is missing", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const req = { body: {       
      userId: 42,
      isManager: true,} };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(ProjectMember.create).not.toHaveBeenCalled();
  });

  it("responds 500 when projectMember creation fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    ProjectMember.create.mockRejectedValue(new Error("insert failed"));
    const req = {
      body: {       
      userId: 42,
      projectId: 5,
      isManager: true, },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "insert failed" });
  });
});

describe("update", () => {
  it("updates the projectMember with the provided fields", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const update = jest.fn().mockResolvedValue({});
    const projectMember = { id: 3, update };
    ProjectMember.findByPk.mockResolvedValue(projectMember);
    const req = {
      params: { id: "3" },
      body: { 
      isManager: false,},
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(update).toHaveBeenCalledWith({
      isManager: false,
    });
    expect(res.send).toHaveBeenCalledWith(projectMember);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the projectMember does not exist", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    ProjectMember.findByPk.mockResolvedValue(null);
    const req = { params: { id: "99" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find ProjectMember with id = 99.",
    });
  });

  it("responds 500 when the update fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const projectMember = {
      id: 3,
      update: jest.fn().mockRejectedValue(new Error("update failed")),
    };
    ProjectMember.findByPk.mockResolvedValue(projectMember);
    const req = { params: { id: "3" }, body: { title: "t" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "update failed" });
  });
});

describe("delete", () => {
  it("destroys the projectMember and confirms", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const destroy = jest.fn().mockResolvedValue({});
    const projectMember = { id: 3, destroy };
    ProjectMember.findByPk.mockResolvedValue(projectMember);
    const req = { params: { id: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "ProjectMember deleted successfully!",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the projectMember does not exist", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    ProjectMember.findByPk.mockResolvedValue(null);
    const req = { params: { id: "99" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find ProjectMember with id = 99.",
    });
  });

  it("responds 500 when the destroy fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    const projectMember = {
      id: 3,
      destroy: jest.fn().mockRejectedValue(new Error("delete failed")),
    };
    ProjectMember.findByPk.mockResolvedValue(projectMember);
    const req = { params: { id: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "delete failed" });
  });
});
