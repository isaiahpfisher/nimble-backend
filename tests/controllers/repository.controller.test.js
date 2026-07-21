jest.mock("../../app/models", () => ({
  repository: {
    create: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const Repository = db.repository;
const controller = require("../../app/controllers/repository.controller");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("create", () => {
  it("creates a repository", async () => {
    const repository = {
      id: 1,
      githubId: "123",
      name: "test-repo",
      projectId: 4,
    };

    Repository.create.mockResolvedValue(repository);

    const req = {
      params: { projectId: "4" },
      body: {
        githubId: "123",
        name: "test-repo",
      },
    };

    const res = mockRes();

    await controller.create(req, res);

    expect(Repository.create).toHaveBeenCalledWith({
      githubId: "123",
      name: "test-repo",
      projectId: "4",
    });

    expect(res.send).toHaveBeenCalledWith(repository);
  });

  it("returns 500 when create fails", async () => {
    Repository.create.mockRejectedValue(new Error("create failed"));

    const req = {
      params: { projectId: "4" },
      body: {},
    };

    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      message: "create failed",
    });
  });
});

describe("findAll", () => {
  it("returns all repositories", async () => {
    const repositories = [{ id: 1 }];

    Repository.findAll.mockResolvedValue(repositories);

    const res = mockRes();

    await controller.findAll({}, res);

    expect(Repository.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(repositories);
  });
});

describe("findAllForProject", () => {
  it("returns repositories for a project", async () => {
    const repositories = [{ id: 1 }];

    Repository.findAll.mockResolvedValue(repositories);

    const req = {
      params: { projectId: "4" },
    };

    const res = mockRes();

    await controller.findAllForProject(req, res);

    expect(Repository.findAll).toHaveBeenCalledWith({
      where: {
        projectId: "4",
      },
    });

    expect(res.send).toHaveBeenCalledWith(repositories);
  });
});

describe("findOne", () => {
  it("returns a repository", async () => {
    const repository = { id: 1 };

    Repository.findByPk.mockResolvedValue(repository);

    const req = {
      params: { id: "1" },
    };

    const res = mockRes();

    await controller.findOne(req, res);

    expect(res.send).toHaveBeenCalledWith(repository);
  });

  it("returns 404 when repository does not exist", async () => {
    Repository.findByPk.mockResolvedValue(null);

    const req = {
      params: { id: "1" },
    };

    const res = mockRes();

    await controller.findOne(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Repository not found",
    });
  });
});

describe("update", () => {
  it("updates a repository", async () => {
    Repository.update.mockResolvedValue([1]);

    const repository = { id: 1 };

    Repository.findByPk.mockResolvedValue(repository);

    const req = {
      params: { id: "1" },
      body: {
        name: "updated-repo",
      },
    };

    const res = mockRes();

    await controller.update(req, res);

    expect(Repository.update).toHaveBeenCalledWith(
      req.body,
      {
        where: { id: "1" },
      }
    );

    expect(res.send).toHaveBeenCalledWith(repository);
  });

  it("returns 404 when update fails", async () => {
    Repository.update.mockResolvedValue([0]);

    const req = {
      params: { id: "1" },
      body: {},
    };

    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("delete", () => {
  it("deletes a repository", async () => {
    Repository.destroy.mockResolvedValue(1);

    const req = {
      params: { id: "1" },
    };

    const res = mockRes();

    await controller.delete(req, res);

    expect(res.send).toHaveBeenCalledWith({
      message: "Repository deleted successfully",
    });
  });

  it("returns 404 when repository does not exist", async () => {
    Repository.destroy.mockResolvedValue(0);

    const req = {
      params: { id: "1" },
    };

    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});