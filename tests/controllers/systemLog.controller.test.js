// Mock the models module so requiring the controller does not open
// a real database connection.
jest.mock("../../app/models", () => ({
  user: {
    findByPk: jest.fn(),
  },
  systemLog: {
    findAll: jest.fn(),
  },
  Sequelize: {
    Op: {},
  },
}));

const db = require("../../app/models");

const User = db.user;
const SystemLog = db.systemLog;

const controller = require("../../app/controllers/systemLog.controller");

function mockRes() {
  const res = {};

  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);

  return res;
}

function mockReq(overrides = {}) {
  return {
    userId: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  User.findByPk.mockResolvedValue({
    id: 1,
    firstName: "Admin",
    lastName: "User",
    email: "admin@example.com",
    isAdmin: true,
  });

  SystemLog.findAll.mockResolvedValue([
    {
      id: 2,
      subjectType: "REPOSITORY",
      subjectId: 5,
      action: "CREATE_REPOSITORY",
      metadata: {
        message: "Repository connected",
        repositoryName: "nimble-backend",
        projectId: 4,
      },
      userId: 1,
      createdAt: "2026-08-10T12:00:00.000Z",
    },
    {
      id: 1,
      subjectType: "SPRINT",
      subjectId: 3,
      action: "CREATE_SPRINT",
      metadata: {
        message: "Sprint created",
        sprintTitle: "Sprint 1",
        projectId: 4,
      },
      userId: 1,
      createdAt: "2026-08-10T11:00:00.000Z",
    },
  ]);
});

describe("findAll", () => {
  it("returns system logs for an admin user", async () => {
    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(User.findByPk).toHaveBeenCalledWith(1);

    expect(SystemLog.findAll).toHaveBeenCalled();

    expect(res.send).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 2,
        subjectType: "REPOSITORY",
        action: "CREATE_REPOSITORY",
      }),
      expect.objectContaining({
        id: 1,
        subjectType: "SPRINT",
        action: "CREATE_SPRINT",
      }),
    ]);

    expect(res.status).not.toHaveBeenCalled();
  });

  it("uses the authenticated user id from req.userId", async () => {
    const req = mockReq({
      userId: 7,
    });

    const res = mockRes();

    await controller.findAll(req, res);

    expect(User.findByPk).toHaveBeenCalledWith(7);
  });

  it("returns the logs ordered by newest first", async () => {
    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(SystemLog.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        order: [["createdAt", "DESC"]],
      })
    );
  });

  it("includes user information with the system logs", async () => {
    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(SystemLog.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        include: [
          {
            model: db.user,
            as: "user",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "email",
            ],
          },
        ],
      })
    );
  });

  it("returns 404 when the user does not exist", async () => {
    User.findByPk.mockResolvedValue(null);

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(404);

    expect(res.send).toHaveBeenCalledWith({
      message: "User not found",
    });

    expect(SystemLog.findAll).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not an admin", async () => {
    User.findByPk.mockResolvedValue({
      id: 1,
      firstName: "Normal",
      lastName: "User",
      email: "user@example.com",
      isAdmin: false,
    });

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(403);

    expect(res.send).toHaveBeenCalledWith({
      message: "Admin access required",
    });

    expect(SystemLog.findAll).not.toHaveBeenCalled();
  });

  it("returns 403 when isAdmin is 0", async () => {
    User.findByPk.mockResolvedValue({
      id: 1,
      firstName: "Normal",
      lastName: "User",
      email: "user@example.com",
      isAdmin: 0,
    });

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(403);

    expect(res.send).toHaveBeenCalledWith({
      message: "Admin access required",
    });

    expect(SystemLog.findAll).not.toHaveBeenCalled();
  });

  it("returns 403 when isAdmin is undefined", async () => {
    User.findByPk.mockResolvedValue({
      id: 1,
      firstName: "Normal",
      lastName: "User",
      email: "user@example.com",
    });

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(403);

    expect(res.send).toHaveBeenCalledWith({
      message: "Admin access required",
    });

    expect(SystemLog.findAll).not.toHaveBeenCalled();
  });

  it("returns 500 when retrieving system logs fails", async () => {
    SystemLog.findAll.mockRejectedValue(
      new Error("database failure")
    );

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(500);

    expect(res.send).toHaveBeenCalledWith({
      message: "database failure",
    });
  });

  it("returns 500 when looking up the user fails", async () => {
    User.findByPk.mockRejectedValue(
      new Error("user lookup failed")
    );

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(500);

    expect(res.send).toHaveBeenCalledWith({
      message: "user lookup failed",
    });

    expect(SystemLog.findAll).not.toHaveBeenCalled();
  });

  it("returns an empty list when there are no system logs", async () => {
    SystemLog.findAll.mockResolvedValue([]);

    const req = mockReq();
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.send).toHaveBeenCalledWith([]);

    expect(res.status).not.toHaveBeenCalled();
  });
});

