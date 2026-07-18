// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  comment: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  story: {
    findOne: jest.fn(),
  },
  acceptanceCriteria: {
    findOne: jest.fn(),
  },
  user: {},
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const Comment = db.comment;
const Story = db.story;
const AcceptanceCriteria = db.acceptanceCriteria;
const controller = require("../../app/controllers/comment.controller");

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

// A comment instance as returned by story.createComment/criterion.createComment,
// with a chainable reload() that resolves to itself.
function mockComment(overrides = {}) {
  const comment = {
    id: 9,
    content: "A comment",
    userId: 42,
    reload: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  comment.reload.mockResolvedValue(comment);
  return comment;
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
  it("sends all comments", async () => {
    const comments = [{ id: 1 }, { id: 2 }];
    Comment.findAll.mockResolvedValue(comments);
    const res = mockRes();

    await controller.findAll({}, res);

    expect(Comment.findAll).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(comments);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 500 when the query fails", async () => {
    Comment.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("findAllForStory", () => {
  it("sends the story's comments with their authors", async () => {
    const comments = [{ id: 1 }, { id: 2 }];
    const story = { id: 3, getComment: jest.fn().mockResolvedValue(comments) };
    Story.findOne.mockResolvedValue(story);
    const req = { params: { storyId: "3" } };
    const res = mockRes();

    await controller.findAllForStory(req, res);

    expect(Story.findOne).toHaveBeenCalledWith({ where: { id: "3" } });
    expect(story.getComment).toHaveBeenCalledWith({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });
    expect(res.send).toHaveBeenCalledWith(comments);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the story is missing", async () => {
    Story.findOne.mockResolvedValue(null);
    const req = { params: { storyId: "99" } };
    const res = mockRes();

    await controller.findAllForStory(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 99.",
    });
  });

  it("responds 500 when the query fails", async () => {
    const story = {
      id: 3,
      getComment: jest.fn().mockRejectedValue(new Error("boom")),
    };
    Story.findOne.mockResolvedValue(story);
    const req = { params: { storyId: "3" } };
    const res = mockRes();

    await controller.findAllForStory(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("createForStory", () => {
  it("creates a comment on the story and reloads it with its author", async () => {
    const created = mockComment();
    const story = { id: 3, createComment: jest.fn().mockResolvedValue(created) };
    Story.findOne.mockResolvedValue(story);
    const req = { params: { storyId: "3" }, body: { content: "Hello" } };
    const res = mockRes();

    await controller.createForStory(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(Story.findOne).toHaveBeenCalledWith({ where: { id: "3" } });
    expect(story.createComment).toHaveBeenCalledWith({
      content: "Hello",
      userId: 42,
    });
    expect(created.reload).toHaveBeenCalledWith({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the story is missing", async () => {
    Story.findOne.mockResolvedValue(null);
    const req = { params: { storyId: "99" }, body: { content: "Hello" } };
    const res = mockRes();

    await controller.createForStory(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Story with id = 99.",
    });
  });

  it("responds 400 when the content is missing", async () => {
    const story = { id: 3, createComment: jest.fn() };
    Story.findOne.mockResolvedValue(story);
    const req = { params: { storyId: "3" }, body: {} };
    const res = mockRes();

    await controller.createForStory(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Comment must have content.",
    });
    expect(story.createComment).not.toHaveBeenCalled();
  });
});

describe("findAllForCriterion", () => {
  it("sends the criterion's comments with their authors", async () => {
    const comments = [{ id: 1 }];
    const criterion = {
      id: 5,
      getComment: jest.fn().mockResolvedValue(comments),
    };
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = { params: { criterionId: "5" } };
    const res = mockRes();

    await controller.findAllForCriterion(req, res);

    expect(AcceptanceCriteria.findOne).toHaveBeenCalledWith({
      where: { id: "5" },
    });
    expect(criterion.getComment).toHaveBeenCalledWith({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });
    expect(res.send).toHaveBeenCalledWith(comments);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the criterion is missing", async () => {
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = { params: { criterionId: "99" } };
    const res = mockRes();

    await controller.findAllForCriterion(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Acceptance Criteria with id = 99.",
    });
  });
});

describe("createForCriterion", () => {
  it("creates a comment on the criterion and reloads it with its author", async () => {
    const created = mockComment();
    const criterion = {
      id: 5,
      createComment: jest.fn().mockResolvedValue(created),
    };
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = { params: { criterionId: "5" }, body: { content: "Nice" } };
    const res = mockRes();

    await controller.createForCriterion(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res);
    expect(AcceptanceCriteria.findOne).toHaveBeenCalledWith({
      where: { id: "5" },
    });
    expect(criterion.createComment).toHaveBeenCalledWith({
      content: "Nice",
      userId: 42,
    });
    expect(created.reload).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(created);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the criterion is missing", async () => {
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = { params: { criterionId: "99" }, body: { content: "Nice" } };
    const res = mockRes();

    await controller.createForCriterion(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Acceptance Criteria with id = 99.",
    });
  });

  it("responds 400 when the content is missing", async () => {
    const criterion = { id: 5, createComment: jest.fn() };
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const req = { params: { criterionId: "5" }, body: {} };
    const res = mockRes();

    await controller.createForCriterion(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Comment must have content.",
    });
    expect(criterion.createComment).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("updates the comment when the author matches", async () => {
    const comment = mockComment({ userId: 42 });
    Comment.findByPk.mockResolvedValue(comment);
    const req = { params: { id: "9" }, body: { content: "Edited" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(Comment.findByPk).toHaveBeenCalledWith("9");
    expect(comment.update).toHaveBeenCalledWith({ content: "Edited" });
    expect(res.send).toHaveBeenCalledWith(comment);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the comment is missing", async () => {
    Comment.findByPk.mockResolvedValue(null);
    const req = { params: { id: "77" }, body: { content: "Edited" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Comment with id = 77.",
    });
  });

  it("responds 400 when a different user tries to update", async () => {
    const comment = mockComment({ userId: 7 });
    Comment.findByPk.mockResolvedValue(comment);
    const req = { params: { id: "9" }, body: { content: "Edited" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "You do not have permission to update this comment.",
    });
    expect(comment.update).not.toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    const comment = mockComment({
      userId: 42,
      update: jest.fn().mockRejectedValue(new Error("write failed")),
    });
    Comment.findByPk.mockResolvedValue(comment);
    const req = { params: { id: "9" }, body: { content: "Edited" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "write failed" });
  });
});

describe("delete", () => {
  it("destroys the comment when the author matches", async () => {
    const comment = mockComment({ userId: 42 });
    Comment.findByPk.mockResolvedValue(comment);
    const req = { params: { id: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(comment.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Comment deleted successfully.",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 when the comment is missing", async () => {
    Comment.findByPk.mockResolvedValue(null);
    const req = { params: { id: "77" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find Comment with id = 77.",
    });
  });

  it("responds 400 when a different user tries to delete", async () => {
    const comment = mockComment({ userId: 7 });
    Comment.findByPk.mockResolvedValue(comment);
    const req = { params: { id: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      message: "You do not have permission to delete this comment.",
    });
    expect(comment.destroy).not.toHaveBeenCalled();
  });

  it("responds 500 when the destroy fails", async () => {
    const comment = mockComment({
      userId: 42,
      destroy: jest.fn().mockRejectedValue(new Error("locked")),
    });
    Comment.findByPk.mockResolvedValue(comment);
    const req = { params: { id: "9" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "locked" });
  });
});
