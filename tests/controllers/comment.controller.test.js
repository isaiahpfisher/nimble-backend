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
  user: {
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

// Notifications go out over Resend; stub the whole email util so requiring the
// controller never constructs a real Resend client and no mail is sent.
jest.mock("../../app/utils/email", () => ({
  notifyMentionedUser: jest.fn().mockResolvedValue(undefined),
  commentToPlainText: jest.fn((s) => s),
  storyUrl: jest.fn(() => "http://example.test/story"),
}));

const db = require("../../app/models");
const Comment = db.comment;
const Story = db.story;
const User = db.user;
const AcceptanceCriteria = db.acceptanceCriteria;
const email = require("../../app/utils/email");
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
  // The authoring user, looked up by createFor* before sending notifications.
  User.findByPk.mockResolvedValue({
    id: 42,
    firstName: "Ada",
    lastName: "Lovelace",
  });
  // No mentions by default; individual tests override for mention coverage.
  User.findAll.mockResolvedValue([]);
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

  it("emails each mentioned user (other than the author) with story context", async () => {
    const created = mockComment({
      content: '<p>Hi <span data-id="7"></span> and <span data-id="8"></span></p>',
    });
    const story = {
      id: 3,
      title: "Login",
      createComment: jest.fn().mockResolvedValue(created),
    };
    Story.findOne.mockResolvedValue(story);
    const mentioned = [
      { id: 7, email: "bob@test.dev" },
      { id: 8, email: "cara@test.dev" },
    ];
    User.findAll.mockResolvedValue(mentioned);
    const req = { params: { storyId: "3" }, body: { content: "x" } };
    const res = mockRes();

    await controller.createForStory(req, res);

    expect(User.findAll).toHaveBeenCalledWith({ where: { id: [7, 8] } });
    expect(email.notifyMentionedUser).toHaveBeenCalledTimes(2);
    const author = { id: 42, firstName: "Ada", lastName: "Lovelace" };
    expect(email.notifyMentionedUser).toHaveBeenCalledWith(
      mentioned[0],
      author,
      created,
      [{ label: "Story", value: "Login", url: "http://example.test/story" }],
    );
    expect(email.notifyMentionedUser).toHaveBeenCalledWith(
      mentioned[1],
      author,
      created,
      expect.any(Array),
    );
    expect(res.send).toHaveBeenCalledWith(created);
  });

  it("does not email the author when they mention themselves", async () => {
    const created = mockComment({
      content: '<span data-id="42"></span><span data-id="7"></span>',
    });
    const story = {
      id: 3,
      title: "Login",
      createComment: jest.fn().mockResolvedValue(created),
    };
    Story.findOne.mockResolvedValue(story);
    // The DB returns both, but the self-mention must be filtered out.
    User.findAll.mockResolvedValue([{ id: 42 }, { id: 7, email: "b@test.dev" }]);
    const res = mockRes();

    await controller.createForStory(
      { params: { storyId: "3" }, body: { content: "x" } },
      res,
    );

    expect(email.notifyMentionedUser).toHaveBeenCalledTimes(1);
    expect(email.notifyMentionedUser).toHaveBeenCalledWith(
      { id: 7, email: "b@test.dev" },
      expect.objectContaining({ id: 42 }),
      created,
      expect.any(Array),
    );
  });

  it("sends no notifications when the comment mentions no one", async () => {
    const created = mockComment({ content: "just plain text" });
    const story = {
      id: 3,
      title: "Login",
      createComment: jest.fn().mockResolvedValue(created),
    };
    Story.findOne.mockResolvedValue(story);
    const res = mockRes();

    await controller.createForStory(
      { params: { storyId: "3" }, body: { content: "x" } },
      res,
    );

    expect(User.findAll).toHaveBeenCalledWith({ where: { id: [] } });
    expect(email.notifyMentionedUser).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(created);
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
      title: "It works",
      createComment: jest.fn().mockResolvedValue(created),
      getStory: jest.fn().mockResolvedValue({ id: 3, title: "Login" }),
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
    const criterion = {
      id: 5,
      createComment: jest.fn(),
      getStory: jest.fn().mockResolvedValue({ id: 3, title: "Login" }),
    };
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

  it("emails mentioned users with both story and criterion context", async () => {
    const created = mockComment({
      content: '<span data-id="7"></span>',
    });
    const parentStory = { id: 3, title: "Login" };
    const criterion = {
      id: 5,
      title: "It works",
      createComment: jest.fn().mockResolvedValue(created),
      getStory: jest.fn().mockResolvedValue(parentStory),
    };
    AcceptanceCriteria.findOne.mockResolvedValue(criterion);
    const mentioned = { id: 7, email: "bob@test.dev" };
    User.findAll.mockResolvedValue([mentioned]);
    const res = mockRes();

    await controller.createForCriterion(
      { params: { criterionId: "5" }, body: { content: "x" } },
      res,
    );

    expect(email.notifyMentionedUser).toHaveBeenCalledTimes(1);
    const context = email.notifyMentionedUser.mock.calls[0][3];
    expect(context).toEqual([
      { label: "Story", value: "Login", url: "http://example.test/story" },
      {
        label: "Acceptance Criteria",
        value: "It works",
        url: "http://example.test/story",
      },
    ]);
    expect(email.storyUrl).toHaveBeenCalledWith(parentStory, { acId: 5 });
    expect(res.send).toHaveBeenCalledWith(created);
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
