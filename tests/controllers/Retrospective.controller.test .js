// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  retrospective: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
  sprint: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
  },
  user: {
    findByPk: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const Retrospective = db.retrospective;
const Sprint = db.sprint;
const User = db.user;
const controller = require("../../app/controllers/retrospective.controller");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

async function invoke(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return { status: res.status.mock.calls[0]?.[0], body: res.send.mock.calls[0]?.[0] };
}

const sampleRetro = {
  id: 5,
  title: "Sprint 3 Retro",
  summary: "Went well overall.",
  sprintId: 3,
  createdById: 42,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("findAllForSprint", () => {
  const req = (overrides = {}) => ({
    params: { projectId: "1", sprintId: "3" },
    ...overrides,
  });

  beforeEach(() => {
    Sprint.findOne.mockResolvedValue({ id: 3, projectId: 1 });
    Retrospective.findAll.mockResolvedValue([sampleRetro]);
  });

  it("returns the retrospectives for a sprint that belongs to the project", async () => {
    const { status, body } = await invoke(controller.findAllForSprint, req());

    expect(status).toBeUndefined();
    expect(body).toEqual([sampleRetro]);
    expect(Sprint.findOne).toHaveBeenCalledWith({
      where: { id: 3, projectId: 1 },
    });
    expect(Retrospective.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sprintId: 3 } }),
    );
  });

  it.each([
    ["a string", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
    ["a float", "1.5"],
  ])("rejects a malformed sprintId (%s)", async (_label, sprintId) => {
    const { status, body } = await invoke(controller.findAllForSprint, req({ params: { projectId: "1", sprintId } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/sprint id/i);
    expect(Sprint.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
  ])("rejects a malformed projectId (%s)", async (_label, projectId) => {
    const { status, body } = await invoke(controller.findAllForSprint, req({ params: { projectId, sprintId: "3" } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/project id/i);
    expect(Sprint.findOne).not.toHaveBeenCalled();
  });

  it("answers 404 when the sprint does not belong to the project", async () => {
    Sprint.findOne.mockResolvedValue(null);

    const { status, body } = await invoke(controller.findAllForSprint, req());

    expect(status).toBe(404);
    expect(body.message).toMatch(/sprint not found/i);
    expect(Retrospective.findAll).not.toHaveBeenCalled();
  });

  it("answers 500 without leaking internal detail when the query throws", async () => {
    Retrospective.findAll.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { status, body } = await invoke(controller.findAllForSprint, req());

    expect(status).toBe(500);
    expect(body.message).toBe("connect ECONNREFUSED");
  });
});

describe("findOne", () => {
  const req = (overrides = {}) => ({ params: { id: "5" }, ...overrides });

  it("returns the retrospective", async () => {
    Retrospective.findByPk.mockResolvedValue(sampleRetro);

    const { status, body } = await invoke(controller.findOne, req());

    expect(status).toBeUndefined();
    expect(body).toEqual(sampleRetro);
    expect(Retrospective.findByPk).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ include: expect.any(Array) }),
    );
  });

  it.each([
    ["a string", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
  ])("rejects a malformed id (%s)", async (_label, id) => {
    const { status, body } = await invoke(controller.findOne, req({ params: { id } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/invalid retrospective id/i);
    expect(Retrospective.findByPk).not.toHaveBeenCalled();
  });

  it("answers 404 when it does not exist", async () => {
    Retrospective.findByPk.mockResolvedValue(null);

    const { status, body } = await invoke(controller.findOne, req());

    expect(status).toBe(404);
    expect(body.message).toMatch(/retrospective not found/i);
  });

  it("answers 500 without leaking internal detail when the query throws", async () => {
    Retrospective.findByPk.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { status, body } = await invoke(controller.findOne, req());

    expect(status).toBe(500);
    expect(body.message).toBe("connect ECONNREFUSED");
  });
});

describe("create", () => {
  const req = (overrides = {}) => ({
    userId: 42,
    body: { title: "Sprint 3 Retro", summary: "Went well.", sprintId: 3 },
    ...overrides,
  });

  beforeEach(() => {
    Sprint.findByPk.mockResolvedValue({ id: 3 });
    User.findByPk.mockResolvedValue({ id: 42, firstName: "Ada" });
    Retrospective.create.mockResolvedValue({ id: 5 });
    Retrospective.findByPk.mockResolvedValue(sampleRetro);
  });

  it("creates the retrospective and returns it with its associations", async () => {
    const { status, body } = await invoke(controller.create, req());

    expect(status).toBe(201);
    expect(body).toEqual(sampleRetro);
    expect(Retrospective.create).toHaveBeenCalledWith({
      title: "Sprint 3 Retro",
      summary: "Went well.",
      sprintId: 3,
      createdById: 42,
    });
  });

  it("defaults createdById to the authenticated user when none is supplied", async () => {
    await invoke(controller.create, req({ body: { title: "Retro", sprintId: 3 } }));

    expect(Retrospective.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 42 }),
    );
  });

  it("uses an explicitly supplied createdById", async () => {
    User.findByPk.mockResolvedValue({ id: 99, firstName: "Bob" });

    await invoke(controller.create, req({ body: { title: "Retro", sprintId: 3, createdById: 99 } }));

    expect(User.findByPk).toHaveBeenCalledWith(99);
    expect(Retrospective.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 99 }),
    );
  });

  it("defaults an empty summary to an empty string", async () => {
    await invoke(controller.create, req({ body: { title: "Retro", sprintId: 3 } }));

    expect(Retrospective.create).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "" }),
    );
  });

  it("rejects an unauthenticated request", async () => {
    const { status, body } = await invoke(controller.create, req({ userId: undefined }));

    expect(status).toBe(401);
    expect(body.message).toMatch(/authentication required/i);
    expect(Retrospective.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("rejects a %s title", async (_label, title) => {
    const { status, body } = await invoke(controller.create, req({ body: { title, sprintId: 3 } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/title is required/i);
    expect(Retrospective.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["a string", "abc"],
    ["zero", 0],
    ["negative", -1],
  ])("rejects an invalid sprintId (%s)", async (_label, sprintId) => {
    const { status, body } = await invoke(controller.create, req({ body: { title: "Retro", sprintId } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/valid sprintid is required/i);
    expect(Sprint.findByPk).not.toHaveBeenCalled();
  });

  it("answers 404 when the sprint does not exist", async () => {
    Sprint.findByPk.mockResolvedValue(null);

    const { status, body } = await invoke(controller.create, req());

    expect(status).toBe(404);
    expect(body.message).toMatch(/sprint not found/i);
    expect(Retrospective.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid explicit createdById", async () => {
    const { status, body } = await invoke(
      controller.create,
      req({ body: { title: "Retro", sprintId: 3, createdById: -1 } }),
    );

    expect(status).toBe(400);
    expect(body.message).toMatch(/valid createdid is required/i);
    expect(Retrospective.create).not.toHaveBeenCalled();
  });

  it("answers 404 when the creator does not exist", async () => {
    User.findByPk.mockResolvedValue(null);

    const { status, body } = await invoke(controller.create, req({ body: { title: "Retro", sprintId: 3, createdById: 999 } }));

    expect(status).toBe(404);
    expect(body.message).toMatch(/selected user was not found/i);
    expect(Retrospective.create).not.toHaveBeenCalled();
  });

  it("answers 500 without leaking internal detail when the write throws", async () => {
    Retrospective.create.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { status, body } = await invoke(controller.create, req());

    expect(status).toBe(500);
    expect(body.message).toBe("connect ECONNREFUSED");
  });
});

describe("update", () => {
  let instance;

  const req = (overrides = {}) => ({ params: { id: "5" }, body: {}, ...overrides });

  beforeEach(() => {
    instance = {
      id: 5,
      title: "Old title",
      summary: "Old summary",
      createdById: 42,
      save: jest.fn().mockResolvedValue(true),
    };
    Retrospective.findByPk.mockResolvedValueOnce(instance).mockResolvedValueOnce(sampleRetro);
    User.findByPk.mockResolvedValue({ id: 99, firstName: "Bob" });
  });

  it("updates the title", async () => {
    const { status, body } = await invoke(controller.update, req({ body: { title: "New title" } }));

    expect(status).toBeUndefined();
    expect(instance.title).toBe("New title");
    expect(instance.save).toHaveBeenCalled();
    expect(body).toEqual(sampleRetro);
  });

  it("updates the summary", async () => {
    await invoke(controller.update, req({ body: { summary: "New summary" } }));

    expect(instance.summary).toBe("New summary");
    expect(instance.save).toHaveBeenCalled();
  });

  it("allows clearing the summary to an empty string", async () => {
    await invoke(controller.update, req({ body: { summary: "" } }));

    expect(instance.summary).toBe("");
  });

  it("updates the creator after checking they exist", async () => {
    await invoke(controller.update, req({ body: { createdById: 99 } }));

    expect(User.findByPk).toHaveBeenCalledWith(99);
    expect(instance.createdById).toBe(99);
    expect(instance.save).toHaveBeenCalled();
  });

  it("leaves fields untouched when not supplied", async () => {
    await invoke(controller.update, req({ body: {} }));

    expect(instance.title).toBe("Old title");
    expect(instance.summary).toBe("Old summary");
    expect(instance.createdById).toBe(42);
    expect(instance.save).toHaveBeenCalled();
  });

  it.each([
    ["a string", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
  ])("rejects a malformed id (%s)", async (_label, id) => {
    const { status, body } = await invoke(controller.update, req({ params: { id } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/invalid retrospective id/i);
    expect(Retrospective.findByPk).not.toHaveBeenCalled();
  });

  it("answers 404 when the retrospective does not exist", async () => {
    Retrospective.findByPk.mockReset().mockResolvedValue(null);

    const { status, body } = await invoke(controller.update, req());

    expect(status).toBe(404);
    expect(body.message).toMatch(/retrospective not found/i);
  });

  it("rejects a blank title without saving", async () => {
    const { status, body } = await invoke(controller.update, req({ body: { title: "   " } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/title cannot be empty/i);
    expect(instance.save).not.toHaveBeenCalled();
  });

  it("rejects an invalid createdById without saving", async () => {
    const { status, body } = await invoke(controller.update, req({ body: { createdById: -1 } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/invalid createdid/i);
    expect(instance.save).not.toHaveBeenCalled();
  });

  it("answers 404 when the new creator does not exist", async () => {
    User.findByPk.mockResolvedValue(null);

    const { status, body } = await invoke(controller.update, req({ body: { createdById: 999 } }));

    expect(status).toBe(404);
    expect(body.message).toMatch(/selected user was not found/i);
    expect(instance.save).not.toHaveBeenCalled();
  });

  it("answers 500 without leaking internal detail when saving throws", async () => {
    instance.save.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { status, body } = await invoke(controller.update, req({ body: { title: "New title" } }));

    expect(status).toBe(500);
    expect(body.message).toBe("connect ECONNREFUSED");
  });
});

describe("delete", () => {
  const req = (overrides = {}) => ({ params: { id: "5" }, ...overrides });

  it("deletes the retrospective", async () => {
    const instance = { id: 5, destroy: jest.fn().mockResolvedValue(true) };
    Retrospective.findByPk.mockResolvedValue(instance);

    const { status, body } = await invoke(controller.delete, req());

    expect(status).toBeUndefined();
    expect(instance.destroy).toHaveBeenCalled();
    expect(body.message).toMatch(/deleted successfully/i);
  });

  it.each([
    ["a string", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
  ])("rejects a malformed id (%s)", async (_label, id) => {
    const { status, body } = await invoke(controller.delete, req({ params: { id } }));

    expect(status).toBe(400);
    expect(body.message).toMatch(/invalid retrospective id/i);
    expect(Retrospective.findByPk).not.toHaveBeenCalled();
  });

  it("answers 404 when it does not exist", async () => {
    Retrospective.findByPk.mockResolvedValue(null);

    const { status, body } = await invoke(controller.delete, req());

    expect(status).toBe(404);
    expect(body.message).toMatch(/retrospective not found/i);
  });

  it("answers 500 without leaking internal detail when destroy throws", async () => {
    const instance = { id: 5, destroy: jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) };
    Retrospective.findByPk.mockResolvedValue(instance);

    const { status, body } = await invoke(controller.delete, req());

    expect(status).toBe(500);
    expect(body.message).toBe("connect ECONNREFUSED");
  });
});