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
  it("sends stories scoped to the project", async () => {
    const stories = [{ id: 1 }];
    Story.findAll.mockResolvedValue(stories);
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    expect(Story.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "1" } }),
    );
    expect(res.send).toHaveBeenCalledWith(stories);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("filters to stories in the Not Started state", async () => {
    Story.findAll.mockResolvedValue([]);
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    const { include } = Story.findAll.mock.calls[0][0];
    const stateInclude = include.find((i) => i.model === db.storyState);

    expect(stateInclude).toEqual({
      model: db.storyState,
      as: "state",
      where: { name: "Not Started" },
    });
  });

  it("eager-loads type, assignee, and sprint", async () => {
    Story.findAll.mockResolvedValue([]);
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    const { include } = Story.findAll.mock.calls[0][0];

    expect(include).toEqual(
      expect.arrayContaining([
        { model: db.storyType, as: "type" },
        { model: db.sprint, as: "sprint" },
      ]),
    );

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

  it("assigns the sprint and sends the updated story", async () => {
    const story = {
      id: 7,
      projectId: "1",
      update: jest.fn().mockResolvedValue(undefined),
    };
    const updated = { id: 7, sprint: { id: 4 } };

    Story.findByPk
      .mockResolvedValueOnce(story)
      .mockResolvedValueOnce(updated);
    Sprint.findByPk.mockResolvedValue({ id: 4, projectId: "1" });

    const res = mockRes();

    await controller.assignSprint(req(), res);

    expect(story.update).toHaveBeenCalledWith({ sprintId: 4 });
    expect(Story.findByPk).toHaveBeenNthCalledWith(1, "7");
    expect(Story.findByPk).toHaveBeenNthCalledWith(
      2,
      "7",
      expect.any(Object),
    );
    expect(res.send).toHaveBeenCalledWith(updated);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("eager-loads state, type, assignee, and sprint on the response", async () => {
    const story = {
      id: 7,
      projectId: "1",
      update: jest.fn().mockResolvedValue(undefined),
    };

    Story.findByPk
      .mockResolvedValueOnce(story)
      .mockResolvedValueOnce({ id: 7 });
    Sprint.findByPk.mockResolvedValue({ id: 4, projectId: "1" });

    const res = mockRes();

    await controller.assignSprint(req(), res);

    const { include } = Story.findByPk.mock.calls[1][1];

    expect(include).toEqual(
      expect.arrayContaining([
        { model: db.storyState, as: "state" },
        { model: db.storyType, as: "type" },
        { model: db.sprint, as: "sprint" },
      ]),
    );
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