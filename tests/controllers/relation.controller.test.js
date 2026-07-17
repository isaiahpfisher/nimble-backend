// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  relation: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  story: {
    findAll: jest.fn(),
  },
  Sequelize: { Op: { in: "in", or: "or" } },
}));

const db = require("../../app/models");
const Relation = db.relation;
const Story = db.story;
const Op = db.Sequelize.Op;
const controller = require("../../app/controllers/relation.controller");

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

// Default create request: story 3 (from the URL) blocks story 4.
function createReq(overrides = {}) {
  return {
    params: { projectId: "1", storyId: "3" },
    body: { type: "BLOCKS", storyOneId: 3, storyTwoId: 4, ...overrides },
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
  it("sends all relations", async () => {
    const relations = [{ id: 1 }, { id: 2 }];
    Relation.findAll.mockResolvedValue(relations);
    const res = mockRes();

    await controller.findAll({}, res);

    expect(Relation.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(relations);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    Relation.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("create", () => {
  it("creates the relation when both stories are in the project", async () => {
    Story.findAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    Relation.findOne.mockResolvedValue(null);
    const created = { id: 11 };
    Relation.create.mockResolvedValue(created);
    const req = createReq();
    const res = mockRes();

    await controller.create(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(Story.findAll).toHaveBeenCalledWith({
      where: { id: { [Op.in]: [3, 4] }, projectId: "1" },
    });
    expect(Relation.create).toHaveBeenCalledWith({
      type: "BLOCKS",
      storyOneId: 3,
      storyTwoId: 4,
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts the URL story on either side of the relation", async () => {
    Story.findAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    Relation.findOne.mockResolvedValue(null);
    Relation.create.mockResolvedValue({ id: 12 });
    const req = createReq({ storyOneId: 4, storyTwoId: 3 });
    const res = mockRes();

    await controller.create(req, res);

    expect(Relation.create).toHaveBeenCalledWith({
      type: "BLOCKS",
      storyOneId: 4,
      storyTwoId: 3,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(["RELATES_TO", "DUPLICATES", "PARENT_OF"])(
    "accepts the %s relation type",
    async (type) => {
      Story.findAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
      Relation.findOne.mockResolvedValue(null);
      Relation.create.mockResolvedValue({ id: 13 });
      const res = mockRes();

      await controller.create(createReq({ type }), res);

      expect(Relation.create).toHaveBeenCalledWith(
        expect.objectContaining({ type }),
      );
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it("responds 400 for an unknown relation type", async () => {
    const res = mockRes();

    await controller.create(createReq({ type: "SUPERSEDES" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: 'Invalid relation type "SUPERSEDES".',
    });
    expect(Story.findAll).not.toHaveBeenCalled();
  });

  it("responds 400 when a story is related to itself", async () => {
    const res = mockRes();

    await controller.create(createReq({ storyOneId: 3, storyTwoId: 3 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "A story cannot be related to itself.",
    });
    expect(Story.findAll).not.toHaveBeenCalled();
  });

  it("responds 400 when the relation does not involve the URL story", async () => {
    const res = mockRes();

    await controller.create(createReq({ storyOneId: 4, storyTwoId: 5 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "The relation must involve this story.",
    });
    expect(Story.findAll).not.toHaveBeenCalled();
  });

  it("responds 400 when a story is outside the project", async () => {
    Story.findAll.mockResolvedValue([{ id: 3 }]);
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Both stories must exist in this project.",
    });
    expect(Relation.create).not.toHaveBeenCalled();
  });

  it("responds 400 when the stories are already related in either direction", async () => {
    Story.findAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    Relation.findOne.mockResolvedValue({ id: 8 });
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(Relation.findOne).toHaveBeenCalledWith({
      where: {
        [Op.or]: [
          { storyOneId: 3, storyTwoId: 4 },
          { storyOneId: 4, storyTwoId: 3 },
        ],
      },
    });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "These stories are already related.",
    });
    expect(Relation.create).not.toHaveBeenCalled();
  });

  it("responds 500 when authentication throws", async () => {
    global.authenticate = jest.fn().mockRejectedValue(new Error("no auth"));
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(Story.findAll).not.toHaveBeenCalled();
  });

  it("responds 500 when the create fails", async () => {
    Story.findAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    Relation.findOne.mockResolvedValue(null);
    Relation.create.mockRejectedValue(new Error("constraint violation"));
    const res = mockRes();

    await controller.create(createReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "constraint violation" });
  });
});

describe("delete", () => {
  it("destroys the relation", async () => {
    const relation = { id: 11, destroy: jest.fn().mockResolvedValue(undefined) };
    Relation.findOne.mockResolvedValue(relation);
    const req = { params: { storyId: "3", relationId: "11" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(Relation.findOne).toHaveBeenCalledWith({
      where: { id: "11", storyOneId: "3" },
    });
    expect(relation.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Relation deleted successfully.",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the relation is missing", async () => {
    Relation.findOne.mockResolvedValue(null);
    const req = { params: { storyId: "3", relationId: "99" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Relation with id = 99.",
    });
  });

  it("responds 500 when the destroy fails", async () => {
    Relation.findOne.mockResolvedValue({
      id: 11,
      destroy: jest.fn().mockRejectedValue(new Error("locked")),
    });
    const req = { params: { storyId: "3", relationId: "11" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "locked" });
  });
});
