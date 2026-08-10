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
  storyState: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
  },
  story: { update: jest.fn() },
  Sequelize: { Op: { ne: Symbol("ne") } },
}));

const db = require("../../app/models");
const StoryState = db.storyState;
const Story = db.story;
const Op = db.Sequelize.Op;
const controller = require("../../app/controllers/storyState.controller");

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
  it("sends all states ordered by their position", async () => {
    const states = [{ id: 1 }, { id: 2 }];
    StoryState.findAll.mockResolvedValue(states);
    const res = mockRes();

    await controller.findAll({}, res);

    expect(StoryState.findAll).toHaveBeenCalledWith({ order: [["order", "ASC"]] });
    expect(res.send).toHaveBeenCalledWith(states);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    StoryState.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });

  it("falls back to a default message when the error has none", async () => {
    StoryState.findAll.mockRejectedValue(new Error());
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "Something went wrong" });
  });
});

describe("findAllForProject", () => {
  it("sends the project's states ordered by their position", async () => {
    const states = [{ id: 1 }];
    StoryState.findAll.mockResolvedValue(states);
    const req = { params: { projectId: "7" } };
    const res = mockRes();

    await controller.findAllForProject(req, res);

    expect(StoryState.findAll).toHaveBeenCalledWith({
      where: { projectId: "7" },
      order: [["order", "ASC"]],
    });
    expect(res.send).toHaveBeenCalledWith(states);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    StoryState.findAll.mockRejectedValue(new Error("boom"));
    const req = { params: { projectId: "7" } };
    const res = mockRes();

    await controller.findAllForProject(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("create", () => {
  it("creates a state under the project", async () => {
    StoryState.findOne.mockResolvedValue(null);
    const created = { id: 9 };
    StoryState.create.mockResolvedValue(created);
    const req = {
      params: { projectId: "1" },
      body: { name: "In Review", order: 3 },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(StoryState.findOne).toHaveBeenCalledWith({
      where: { name: "In Review", projectId: "1" },
    });
    expect(StoryState.create).toHaveBeenCalledWith({
      name: "In Review",
      order: 3,
      projectId: "1",
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the name is missing", async () => {
    const req = { params: { projectId: "1" }, body: { order: 3 } };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(StoryState.findOne).not.toHaveBeenCalled();
    expect(StoryState.create).not.toHaveBeenCalled();
  });

  it("responds 400 when the order is missing", async () => {
    const req = { params: { projectId: "1" }, body: { name: "In Review" } };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(StoryState.create).not.toHaveBeenCalled();
  });

  it("responds 400 when a state with the name already exists", async () => {
    StoryState.findOne.mockResolvedValue({ id: 5 });
    const req = {
      params: { projectId: "1" },
      body: { name: "In Review", order: 3 },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "A story state with this name already exists.",
    });
    expect(StoryState.create).not.toHaveBeenCalled();
  });

  it("responds 500 when the create fails", async () => {
    StoryState.findOne.mockResolvedValue(null);
    StoryState.create.mockRejectedValue(new Error("write failed"));
    const req = {
      params: { projectId: "1" },
      body: { name: "In Review", order: 3 },
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});

describe("update", () => {
  it("updates the state and sends it back", async () => {
    const state = { id: 9, update: jest.fn().mockResolvedValue(undefined) };
    // First findOne locates the state, second checks for a duplicate name.
    StoryState.findOne.mockResolvedValueOnce(state).mockResolvedValueOnce(null);
    const req = {
      params: { projectId: "1", stateId: "9" },
      body: { name: "Done" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(StoryState.findOne).toHaveBeenNthCalledWith(1, {
      where: { id: "9", projectId: "1" },
    });
    expect(StoryState.findOne).toHaveBeenNthCalledWith(2, {
      where: { name: "Done", projectId: "1", id: { [Op.ne]: "9" } },
    });
    expect(state.update).toHaveBeenCalledWith({ name: "Done" });
    expect(res.send).toHaveBeenCalledWith(state);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the name is missing", async () => {
    const req = { params: { projectId: "1", stateId: "9" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(StoryState.findOne).not.toHaveBeenCalled();
  });

  it("responds 404 when the state is missing", async () => {
    StoryState.findOne.mockResolvedValue(null);
    const req = {
      params: { projectId: "1", stateId: "77" },
      body: { name: "Done" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find StoryState with id = 77.",
    });
  });

  it("responds 400 when another state already has the name", async () => {
    const state = { id: 9, update: jest.fn() };
    StoryState.findOne.mockResolvedValueOnce(state).mockResolvedValueOnce({ id: 12 });
    const req = {
      params: { projectId: "1", stateId: "9" },
      body: { name: "Done" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "A story state with this name already exists.",
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    const state = {
      id: 9,
      update: jest.fn().mockRejectedValue(new Error("write failed")),
    };
    StoryState.findOne.mockResolvedValueOnce(state).mockResolvedValueOnce(null);
    const req = {
      params: { projectId: "1", stateId: "9" },
      body: { name: "Done" },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});

describe("reorder", () => {
  it("bulk-upserts the states' names and order", async () => {
    const states = [
      { id: 1, name: "To Do", order: 1 },
      { id: 2, name: "Doing", order: 2 },
    ];
    StoryState.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    StoryState.bulkCreate.mockResolvedValue([]);
    const req = { userId: 42, params: { projectId: "1" }, body: { states } };
    const res = mockRes();

    await controller.reorder(req, res);

    // every row is stamped with the project from the URL, so the upsert cannot
    // reach another project's states
    expect(StoryState.bulkCreate).toHaveBeenCalledWith(
      states.map((s) => ({ ...s, projectId: "1" })),
      { updateOnDuplicate: ["name", "order"] },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      message: "Successfully reordered states.",
    });
  });

  it("responds 400 when a state belongs to another project", async () => {
    const states = [
      { id: 1, name: "To Do", order: 1 },
      { id: 2, name: "Doing", order: 2 },
    ];
    // only one of the two ids is owned by this project
    StoryState.findAll.mockResolvedValue([{ id: 1 }]);
    const req = { userId: 42, params: { projectId: "1" }, body: { states } };
    const res = mockRes();

    await controller.reorder(req, res);

    expect(StoryState.bulkCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "At least one state does not belong to this project.",
    });
  });

  it("responds 400 when no states are given", async () => {
    const req = { userId: 42, params: { projectId: "1" }, body: { states: [] } };
    const res = mockRes();

    await controller.reorder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(StoryState.bulkCreate).not.toHaveBeenCalled();
  });

  it("responds 500 when the bulk upsert fails", async () => {
    StoryState.findAll.mockResolvedValue([{ id: 1 }]);
    StoryState.bulkCreate.mockRejectedValue(new Error("bulk failed"));
    const req = {
      userId: 42,
      params: { projectId: "1" },
      body: { states: [{ id: 1, name: "To Do", order: 1 }] },
    };
    const res = mockRes();

    await controller.reorder(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "bulk failed" });
  });
});

describe("delete", () => {
  it("reassigns stories to the fallback state, then destroys the state", async () => {
    const state = { id: 9, destroy: jest.fn().mockResolvedValue(undefined) };
    StoryState.findOne.mockResolvedValue(state);
    Story.update.mockResolvedValue([1]);
    const req = {
      params: { projectId: "1", stateId: "9" },
      body: { fallbackStateId: 4 },
    };
    const res = mockRes();

    await controller.delete(req, res);

    expect(StoryState.findOne).toHaveBeenCalledWith({
      where: { id: "9", projectId: "1" },
    });
    expect(Story.update).toHaveBeenCalledWith({ stateId: 4 }, { where: { stateId: "9" } });
    expect(state.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Story state deleted successfully!",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the fallback state id is missing", async () => {
    const req = { params: { projectId: "1", stateId: "9" }, body: {} };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(StoryState.findOne).not.toHaveBeenCalled();
    expect(Story.update).not.toHaveBeenCalled();
  });

  it("responds 404 when the state is missing", async () => {
    StoryState.findOne.mockResolvedValue(null);
    const req = {
      params: { projectId: "1", stateId: "77" },
      body: { fallbackStateId: 4 },
    };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find StoryState with id = 77.",
    });
    expect(Story.update).not.toHaveBeenCalled();
  });

  it("responds 500 when the destroy fails", async () => {
    StoryState.findOne.mockResolvedValue({
      id: 9,
      destroy: jest.fn().mockRejectedValue(new Error("locked")),
    });
    Story.update.mockResolvedValue([0]);
    const req = {
      params: { projectId: "1", stateId: "9" },
      body: { fallbackStateId: 4 },
    };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "locked" });
  });
});
