// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  storyType: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  story: {},
  Sequelize: { Op: { ne: Symbol("ne") } },
}));

const db = require("../../app/models");
const StoryType = db.storyType;
const Story = db.story;
const Op = db.Sequelize.Op;
const controller = require("../../app/controllers/storyType.controller");

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
  it("sends all story types", async () => {
    const types = [{ id: 1 }, { id: 2 }];
    StoryType.findAll.mockResolvedValue(types);
    const res = mockRes();

    await controller.findAll({}, res);

    expect(StoryType.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(types);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    StoryType.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });

  it("falls back to a default message when the error has none", async () => {
    StoryType.findAll.mockRejectedValue(new Error());
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "Something went wrong" });
  });
});

describe("findAllForProject", () => {
  it("sends the project's story types with their stories included", async () => {
    const types = [{ id: 1 }];
    StoryType.findAll.mockResolvedValue(types);
    const req = { params: { projectId: "7" } };
    const res = mockRes();

    await controller.findAllForProject(req, res);

    expect(StoryType.findAll).toHaveBeenCalledWith({
      where: { projectId: "7" },
      include: { model: Story, as: "story" },
    });
    expect(res.send).toHaveBeenCalledWith(types);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    StoryType.findAll.mockRejectedValue(new Error("boom"));
    const req = { params: { projectId: "7" } };
    const res = mockRes();

    await controller.findAllForProject(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("create", () => {
  it("creates a story type under the project", async () => {
    StoryType.findOne.mockResolvedValue(null);
    const created = { id: 9 };
    StoryType.create.mockResolvedValue(created);
    const req = { params: { projectId: "1" }, body: { name: "Bug" } };
    const res = mockRes();

    await controller.create(req, res);

    expect(StoryType.findOne).toHaveBeenCalledWith({
      where: { name: "Bug", projectId: "1" },
    });
    expect(StoryType.create).toHaveBeenCalledWith({
      name: "Bug",
      projectId: "1",
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the name is missing", async () => {
    const req = { params: { projectId: "1" }, body: {} };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Missing required fields.",
    });
    expect(StoryType.findOne).not.toHaveBeenCalled();
    expect(StoryType.create).not.toHaveBeenCalled();
  });

  it("responds 400 when a story type with the name already exists", async () => {
    StoryType.findOne.mockResolvedValue({ id: 5 });
    const req = { params: { projectId: "1" }, body: { name: "Bug" } };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "A story type with this name already exists.",
    });
    expect(StoryType.create).not.toHaveBeenCalled();
  });

  it("responds 500 when the create fails", async () => {
    StoryType.findOne.mockResolvedValue(null);
    StoryType.create.mockRejectedValue(new Error("write failed"));
    const req = { params: { projectId: "1" }, body: { name: "Bug" } };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});

describe("update", () => {
  it("updates the story type and sends it back", async () => {
    const type = { id: 9, update: jest.fn().mockResolvedValue(undefined) };
    // First findOne locates the type, second checks for a duplicate name.
    StoryType.findOne
      .mockResolvedValueOnce(type)
      .mockResolvedValueOnce(null);
    const req = {
      params: { projectId: "1", typeId: "9" },
      body: { name: "Chore" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(StoryType.findOne).toHaveBeenNthCalledWith(1, {
      where: { id: "9", projectId: "1" },
    });
    expect(StoryType.findOne).toHaveBeenNthCalledWith(2, {
      where: { name: "Chore", projectId: "1", id: { [Op.ne]: "9" } },
    });
    expect(type.update).toHaveBeenCalledWith({ name: "Chore" });
    expect(res.send).toHaveBeenCalledWith(type);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the name is missing", async () => {
    const req = { params: { projectId: "1", typeId: "9" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Missing required fields.",
    });
    expect(StoryType.findOne).not.toHaveBeenCalled();
  });

  it("responds 404 when the story type is missing", async () => {
    StoryType.findOne.mockResolvedValue(null);
    const req = {
      params: { projectId: "1", typeId: "77" },
      body: { name: "Chore" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find StoryType with id = 77.",
    });
  });

  it("responds 400 when another story type already has the name", async () => {
    const type = { id: 9, update: jest.fn() };
    StoryType.findOne
      .mockResolvedValueOnce(type)
      .mockResolvedValueOnce({ id: 12 });
    const req = {
      params: { projectId: "1", typeId: "9" },
      body: { name: "Chore" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "A story type with this name already exists.",
    });
    expect(type.update).not.toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    const type = {
      id: 9,
      update: jest.fn().mockRejectedValue(new Error("write failed")),
    };
    StoryType.findOne
      .mockResolvedValueOnce(type)
      .mockResolvedValueOnce(null);
    const req = {
      params: { projectId: "1", typeId: "9" },
      body: { name: "Chore" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});

describe("delete", () => {
  it("destroys the story type", async () => {
    const type = { id: 9, destroy: jest.fn().mockResolvedValue(undefined) };
    StoryType.findOne.mockResolvedValue(type);
    const req = { params: { projectId: "1", typeId: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(StoryType.findOne).toHaveBeenCalledWith({
      where: { id: "9", projectId: "1" },
    });
    expect(type.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Story type deleted successfully!",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the story type is missing", async () => {
    StoryType.findOne.mockResolvedValue(null);
    const req = { params: { projectId: "1", typeId: "77" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find StoryType with id = 77.",
    });
  });

  it("responds 500 when the destroy fails", async () => {
    StoryType.findOne.mockResolvedValue({
      id: 9,
      destroy: jest.fn().mockRejectedValue(new Error("locked")),
    });
    const req = { params: { projectId: "1", typeId: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "locked" });
  });
});
