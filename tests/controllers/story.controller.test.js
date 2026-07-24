// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  story: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
  project: {
    findByPk: jest.fn(),
  },
  // user needs a real finder now that create/update look up the acting user
  // and the assignee/reviewer to notify them; `name` keeps it usable as an
  // association sentinel in the eager-load assertions.
  user: { name: "user", findByPk: jest.fn() },
  // Sentinels for the associations the finders eager-load; the controller only
  // passes these through to Sequelize, so identity is all the tests need.
  storyState: { name: "storyState" },
  storyType: { name: "storyType" },
  repository: { name: "repository" },
  sprint: { name: "sprint" },
  acceptanceCriteria: { name: "acceptanceCriteria" },
  comment: { name: "comment" },
  relation: { name: "relation" },
  Sequelize: { Op: {} },
}));

// Assignment/review notifications go out over Resend; stub the email util so
// requiring the controller never builds a real client and no mail is sent.
jest.mock("../../app/utils/email", () => ({
  notifyAssignedUser: jest.fn().mockResolvedValue(undefined),
  notifyReviewerUser: jest.fn().mockResolvedValue(undefined),
  storyUrl: jest.fn(() => "http://example.test/story"),
}));

const db = require("../../app/models");
const Story = db.story;
const Project = db.project;
const User = db.user;
const email = require("../../app/utils/email");
const controller = require("../../app/controllers/story.controller");

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

// A body satisfying every required field in create/update.
function storyBody(overrides = {}) {
  return {
    title: "Add login page",
    description: "Users need to sign in",
    typeId: 2,
    stateId: 3,
    priority: "HIGH",
    estimate: 5,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  authenticate = jest.fn().mockResolvedValue({ userId: 42 });
  global.authenticate = authenticate;
  // Default lookup for the acting user and any assignee/reviewer being notified.
  User.findByPk.mockImplementation((id) =>
    Promise.resolve({ id, firstName: "User", lastName: String(id), email: `${id}@test.dev` }),
  );
});

afterEach(() => {
  delete global.authenticate;
});

describe("findAll", () => {
  it("sends all stories", async () => {
    const stories = [{ id: 1 }, { id: 2 }];
    Story.findAll.mockResolvedValue(stories);
    const res = mockRes();

    await controller.findAll({}, res);

    expect(Story.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(stories);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    Story.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("findOne", () => {
  it("sends the story when found", async () => {
    const story = { id: 7 };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.findOne({ params: { storyId: "7" } }, res);

    expect(Story.findByPk).toHaveBeenCalledWith("7", expect.any(Object));
    expect(res.send).toHaveBeenCalledWith(story);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("eager-loads the story's associations", async () => {
    Story.findByPk.mockResolvedValue({ id: 7 });
    const res = mockRes();

    await controller.findOne({ params: { storyId: "7" } }, res);

    const { include } = Story.findByPk.mock.calls[0][1];
    expect(include).toEqual(
      expect.arrayContaining([
        { model: db.storyState, as: "state" },
        { model: db.storyType, as: "type" },
        { model: db.acceptanceCriteria, as: "acceptanceCriteria" },
        { model: db.comment, as: "comment" },
      ]),
    );
    // The three user associations are scoped to non-sensitive columns.
    const userIncludes = include.filter((i) => i.model === db.user);
    expect(userIncludes.map((i) => i.as)).toEqual([
      "reporter",
      "assignee",
      "reviewer",
    ]);
    for (const userInclude of userIncludes) {
      expect(userInclude.attributes).toEqual([
        "id",
        "firstName",
        "lastName",
        "email",
      ]);
    }
  });

  it("responds 404 when the story is missing", async () => {
    Story.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.findOne({ params: { storyId: "99" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 99.",
    });
  });

  it("responds 500 when the query fails", async () => {
    Story.findByPk.mockRejectedValue(new Error("boom"));
    const res = mockRes();

    await controller.findOne({ params: { storyId: "7" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
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

  it("responds 500 when the query fails", async () => {
    Story.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAllForProject({ params: { id: "1" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("create", () => {
  it("creates the story with the authenticated user as reporter", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    const created = { id: 9 };
    Story.create.mockResolvedValue(created);
    const req = {
      params: { id: "1" },
      body: storyBody({
        stateId: 3,
        sprintId: 4,
        repositoryId: 5,
        assigneeId: 6,
        reviewerId: 7,
      }),
    };
    const res = mockRes();

    await controller.create(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(Story.create).toHaveBeenCalledWith({
      title: "Add login page",
      description: "Users need to sign in",
      typeId: 2,
      stateId: 3,
      priority: "HIGH",
      estimate: 5,
      projectId: "1",
      sprintId: 4,
      repositoryId: 5,
      reporterId: 42,
      assigneeId: 6,
      reviewerId: 7,
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts an estimate of zero", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockResolvedValue({ id: 9 });
    const res = mockRes();

    await controller.create(
      { params: { id: "1" }, body: storyBody({ estimate: 0 }) },
      res,
    );

    expect(Story.create).toHaveBeenCalledWith(
      expect.objectContaining({ estimate: 0 }),
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["title", { title: "" }],
    ["description", { description: "" }],
    ["stateId", { stateId: undefined }],
  ])("responds 400 when %s is missing", async (_field, overrides) => {
    const res = mockRes();

    await controller.create(
      { params: { id: "1" }, body: storyBody(overrides) },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(Story.create).not.toHaveBeenCalled();
  });

  it("responds 404 when the project does not exist", async () => {
    Project.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.create({ params: { id: "99" }, body: storyBody() }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Project with id = 99.",
    });
    expect(Story.create).not.toHaveBeenCalled();
  });

  it("responds 500 when authentication throws", async () => {
    global.authenticate = jest.fn().mockRejectedValue(new Error("no auth"));
    const res = mockRes();

    await controller.create({ params: { id: "1" }, body: storyBody() }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(Story.create).not.toHaveBeenCalled();
  });

  it("responds 500 when the create fails", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockRejectedValue(new Error("constraint violation"));
    const res = mockRes();

    await controller.create({ params: { id: "1" }, body: storyBody() }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "constraint violation" });
  });

  it("emails the assignee and reviewer of a newly created story", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    const created = { id: 9, title: "Add login page", assigneeId: 6, reviewerId: 7 };
    Story.create.mockResolvedValue(created);
    const res = mockRes();

    await controller.create(
      { params: { id: "1" }, body: storyBody({ assigneeId: 6, reviewerId: 7 }) },
      res,
    );

    expect(email.notifyAssignedUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 6 }),
      expect.objectContaining({ id: 42 }),
      created,
      [{ label: "Story", value: "Add login page", url: "http://example.test/story" }],
    );
    expect(email.notifyReviewerUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.objectContaining({ id: 42 }),
      created,
      expect.any(Array),
    );
    expect(res.send).toHaveBeenCalledWith(created);
  });

  it("does not notify when the creator assigns/reviews the story themselves", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockResolvedValue({ id: 9, assigneeId: 42, reviewerId: 42 });
    const res = mockRes();

    await controller.create(
      { params: { id: "1" }, body: storyBody({ assigneeId: 42, reviewerId: 42 }) },
      res,
    );

    expect(email.notifyAssignedUser).not.toHaveBeenCalled();
    expect(email.notifyReviewerUser).not.toHaveBeenCalled();
  });

  it("sends no notifications for a story with no assignee or reviewer", async () => {
    Project.findByPk.mockResolvedValue({ id: 1 });
    Story.create.mockResolvedValue({ id: 9 });
    const res = mockRes();

    await controller.create({ params: { id: "1" }, body: storyBody() }, res);

    expect(email.notifyAssignedUser).not.toHaveBeenCalled();
    expect(email.notifyReviewerUser).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("updates the story and sends it back", async () => {
    const story = { id: 7, update: jest.fn().mockResolvedValue(undefined) };
    Story.findByPk.mockResolvedValue(story);
    const req = {
      params: { storyId: "7" },
      body: storyBody({ title: "Renamed", stateId: 3, assigneeId: 6 }),
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(story.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Renamed", stateId: 3, assigneeId: 6 }),
    );
    expect(res.send).toHaveBeenCalledWith(story);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not let update reassign the story to another project", async () => {
    const story = { id: 7, update: jest.fn().mockResolvedValue(undefined) };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.update(
      { params: { storyId: "7" }, body: storyBody({ projectId: 999 }) },
      res,
    );

    expect(story.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
  });

  it("responds 400 when a required field is missing", async () => {
    const res = mockRes();

    await controller.update(
      { params: { storyId: "7" }, body: storyBody({ title: "" }) },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    expect(Story.findByPk).not.toHaveBeenCalled();
  });

  it("allows an omitted acceptanceCriteria list", async () => {
    const story = { id: 7, update: jest.fn().mockResolvedValue(undefined) };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.update({ params: { storyId: "7" }, body: storyBody() }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(story.update).toHaveBeenCalledTimes(1);
  });

  it("responds 404 when the story is missing", async () => {
    Story.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.update(
      { params: { storyId: "99" }, body: storyBody() },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 99.",
    });
  });

  it("responds 500 when authentication throws", async () => {
    global.authenticate = jest.fn().mockRejectedValue(new Error("no auth"));
    const res = mockRes();

    await controller.update({ params: { storyId: "7" }, body: storyBody() }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(Story.findByPk).not.toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    Story.findByPk.mockResolvedValue({
      id: 7,
      update: jest.fn().mockRejectedValue(new Error("write failed")),
    });
    const res = mockRes();

    await controller.update({ params: { storyId: "7" }, body: storyBody() }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });

  it("emails a newly assigned user and reviewer on update", async () => {
    const story = {
      id: 7,
      title: "Login",
      assigneeId: 1,
      reviewerId: 2,
      update: jest.fn().mockResolvedValue(undefined),
    };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.update(
      {
        params: { storyId: "7" },
        body: storyBody({ assigneeId: 6, reviewerId: 8 }),
      },
      res,
    );

    expect(email.notifyAssignedUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 6 }),
      expect.objectContaining({ id: 42 }),
      story,
      expect.any(Array),
    );
    expect(email.notifyReviewerUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8 }),
      expect.objectContaining({ id: 42 }),
      story,
      expect.any(Array),
    );
  });

  it("does not re-notify when the assignee and reviewer are unchanged", async () => {
    const story = {
      id: 7,
      assigneeId: 6,
      reviewerId: 8,
      update: jest.fn().mockResolvedValue(undefined),
    };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.update(
      {
        params: { storyId: "7" },
        body: storyBody({ assigneeId: 6, reviewerId: 8 }),
      },
      res,
    );

    expect(email.notifyAssignedUser).not.toHaveBeenCalled();
    expect(email.notifyReviewerUser).not.toHaveBeenCalled();
  });

  it("does not notify when a user assigns/reviews the story to themselves", async () => {
    const story = {
      id: 7,
      assigneeId: 1,
      reviewerId: 2,
      update: jest.fn().mockResolvedValue(undefined),
    };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.update(
      {
        params: { storyId: "7" },
        body: storyBody({ assigneeId: 42, reviewerId: 42 }),
      },
      res,
    );

    expect(email.notifyAssignedUser).not.toHaveBeenCalled();
    expect(email.notifyReviewerUser).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("destroys the story", async () => {
    const story = { id: 7, destroy: jest.fn().mockResolvedValue(undefined) };
    Story.findByPk.mockResolvedValue(story);
    const res = mockRes();

    await controller.delete({ params: { storyId: "7" } }, res);

    expect(story.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Story deleted successfully!",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the story is missing", async () => {
    Story.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.delete({ params: { storyId: "99" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 99.",
    });
  });

  it("responds 500 when authentication throws", async () => {
    global.authenticate = jest.fn().mockRejectedValue(new Error("no auth"));
    const res = mockRes();

    await controller.delete({ params: { storyId: "7" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "no auth" });
    expect(Story.findByPk).not.toHaveBeenCalled();
  });

  it("responds 500 when the destroy fails", async () => {
    Story.findByPk.mockResolvedValue({
      id: 7,
      destroy: jest.fn().mockRejectedValue(new Error("locked")),
    });
    const res = mockRes();

    await controller.delete({ params: { storyId: "7" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "locked" });
  });
});
