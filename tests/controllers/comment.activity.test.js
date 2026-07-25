// Activity-history coverage for the comment controller. The models module is
// mocked so requiring the controller never opens a real DB connection, email
// is stubbed so no mail goes out, and the activity util is mocked so the
// recorded payload can be asserted directly.
jest.mock("../../app/models", () => ({
  comment: { findAll: jest.fn(), findByPk: jest.fn() },
  // delete() re-reads the comment's parent by primary key to label the history
  story: { findOne: jest.fn(), findByPk: jest.fn() },
  acceptanceCriteria: { findOne: jest.fn(), findByPk: jest.fn() },
  user: { findByPk: jest.fn(), findAll: jest.fn() },
  Sequelize: { Op: {} },
}));

jest.mock("../../app/utils/email", () => ({
  notifyMentionedUser: jest.fn().mockResolvedValue(undefined),
  commentToPlainText: jest.fn((s) => s),
  storyUrl: jest.fn(() => "http://example.test/story"),
}));

jest.mock("../../app/utils/activity", () => ({
  recordActivity: jest.fn().mockResolvedValue(undefined),
  ACTIVITY_ACTION: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" },
  SUBJECT_TYPE: {
    STORY: "story",
    ACCEPTANCE_CRITERIA: "acceptanceCriteria",
    COMMENT: "comment",
    RELATION: "relation",
  },
}));

const db = require("../../app/models");
const Comment = db.comment;
const Story = db.story;
const User = db.user;
const AcceptanceCriteria = db.acceptanceCriteria;
const { recordActivity } = require("../../app/utils/activity");
const controller = require("../../app/controllers/comment.controller");

let authenticate;

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

function mockComment(overrides = {}) {
  const comment = {
    id: 9,
    content: "A comment",
    userId: 42,
    acceptanceCriteriaId: null,
    storyId: 3,
    ...overrides,
  };
  comment.reload = jest.fn().mockResolvedValue(comment);
  comment.destroy = jest.fn().mockResolvedValue(undefined);
  return comment;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so restore the default resolve.
  recordActivity.mockResolvedValue(undefined);
  authenticate = jest.fn().mockResolvedValue({ userId: 42 });
  global.authenticate = authenticate;
  User.findByPk.mockResolvedValue({ id: 42, firstName: "Ada", lastName: "Lovelace" });
  User.findAll.mockResolvedValue([]);
});

afterEach(() => {
  delete global.authenticate;
});

describe("createForStory", () => {
  function storyWithComment(comment) {
    return {
      id: 3,
      title: "Add login page",
      createComment: jest.fn().mockResolvedValue(comment),
    };
  }

  it("records the comment against the story it was left on", async () => {
    const comment = mockComment({ content: "Looks good" });
    Story.findOne.mockResolvedValue(storyWithComment(comment));
    const req = { params: { storyId: "3" }, body: { content: "Looks good" } };
    const res = mockRes();

    await controller.createForStory(req, res);

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 3,
      subjectType: "comment",
      subjectId: 9,
      userId: 42,
      action: "created",
      metadata: {
        content: "Looks good",
        subjectType: "story",
        subjectLabel: "Add login page",
        user: "Ada Lovelace",
      },
    });
    expect(res.send).toHaveBeenCalledWith(comment);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("records nothing when the comment body is empty", async () => {
    Story.findOne.mockResolvedValue(storyWithComment(mockComment()));
    const req = { params: { storyId: "3" }, body: { content: "" } };
    const res = mockRes();

    await controller.createForStory(req, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("createForCriterion", () => {
  function criterionWithComment(comment) {
    return {
      id: 5,
      title: "Login succeeds",
      getStory: jest.fn().mockResolvedValue({ id: 3, title: "Add login page" }),
      createComment: jest.fn().mockResolvedValue(comment),
    };
  }

  it("records the comment against the criterion's parent story", async () => {
    const comment = mockComment({ content: "Nice", acceptanceCriteriaId: 5 });
    AcceptanceCriteria.findOne.mockResolvedValue(criterionWithComment(comment));
    const req = { params: { criterionId: "5" }, body: { content: "Nice" } };
    const res = mockRes();

    await controller.createForCriterion(req, res);

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 3,
      subjectType: "comment",
      subjectId: 9,
      userId: 42,
      action: "created",
      metadata: {
        content: "Nice",
        subjectType: "acceptanceCriteria",
        subjectLabel: "Login succeeds",
        user: "Ada Lovelace",
      },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("records nothing when the criterion is missing", async () => {
    AcceptanceCriteria.findOne.mockResolvedValue(null);
    const req = { params: { criterionId: "99" }, body: { content: "Nice" } };
    const res = mockRes();

    await controller.createForCriterion(req, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("delete", () => {
  it("records the deletion of a story comment", async () => {
    const comment = mockComment({ content: "Bye", acceptanceCriteriaId: null, storyId: 3 });
    Comment.findByPk.mockResolvedValue(comment);
    Story.findByPk.mockResolvedValue({ id: 3, title: "Add login page" });
    const req = { params: { id: "9", storyId: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(recordActivity).toHaveBeenCalledWith({
      storyId: 3,
      subjectType: "comment",
      subjectId: 9,
      userId: 42,
      action: "deleted",
      metadata: {
        content: "Bye",
        subjectType: "story",
        subjectLabel: "Add login page",
        user: "Ada Lovelace",
      },
    });
    expect(res.send).toHaveBeenCalledWith({ message: "Comment deleted successfully." });
  });

  it("records the deletion of a criterion comment against the criterion", async () => {
    const comment = mockComment({ content: "Bye", acceptanceCriteriaId: 5 });
    Comment.findByPk.mockResolvedValue(comment);
    AcceptanceCriteria.findByPk.mockResolvedValue({ id: 5, title: "Login succeeds" });
    Story.findByPk.mockResolvedValue({ id: 3, title: "Add login page" });
    const req = { params: { id: "9", storyId: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          subjectType: "acceptanceCriteria",
          subjectLabel: "Login succeeds",
        }),
      }),
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("attributes the deletion to the authenticated user, not a request property", async () => {
    const comment = mockComment({ userId: 77 });
    authenticate.mockResolvedValue({ userId: 77 });
    User.findByPk.mockResolvedValue({ id: 77, firstName: "Grace", lastName: "Hopper" });
    Comment.findByPk.mockResolvedValue(comment);
    Story.findByPk.mockResolvedValue({ id: 3, title: "Add login page" });
    // No req.user: the route only guarantees what authenticate() returns.
    const req = { params: { id: "9", storyId: "3" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 77 }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it("records the deletion before the row is destroyed", async () => {
    const comment = mockComment();
    Comment.findByPk.mockResolvedValue(comment);
    Story.findByPk.mockResolvedValue({ id: 3, title: "Add login page" });

    await controller.delete({ params: { id: "9", storyId: "3" } }, mockRes());

    expect(recordActivity.mock.invocationCallOrder[0]).toBeLessThan(comment.destroy.mock.invocationCallOrder[0]);
  });

  it("records nothing when the caller does not own the comment", async () => {
    Comment.findByPk.mockResolvedValue(mockComment({ userId: 99 }));
    const res = mockRes();

    await controller.delete({ params: { id: "9", storyId: "3" } }, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("records nothing when the comment is missing", async () => {
    Comment.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.delete({ params: { id: "9", storyId: "3" } }, res);

    expect(recordActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
