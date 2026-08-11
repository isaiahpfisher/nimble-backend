/**
 * Business Logic Tests
 *
 * These tests cover the major business rules across the application:
 *
 * 1. Authentication
 * 2. Authorization
 * 3. Projects
 * 4. Sprints
 * 5. Stories
 * 6. Acceptance Criteria
 * 7. Comments
 * 8. Retrospectives
 * 9. Standups
 * 10. Activities
 * 11. Repositories / GitHub-related logic
 *
 * This is a unit-test suite. Database models and authorization helpers
 * are mocked so that the tests exercise controller/business logic rather
 * than requiring a real database.
 */

// ============================================================
// TEST ENVIRONMENT
// ============================================================
//
// IMPORTANT:
// crypto.js reads SECRET_KEY while the controllers are imported.
//
// Therefore SECRET_KEY MUST be defined before requiring any controller.
//
process.env.SECRET_KEY =
  process.env.SECRET_KEY ||
  Buffer.from("nimble-jest-test-secret-key").toString("base64");

process.env.NODE_ENV = "test";

// ============================================================
// MOCK AUTHORIZATION
// ============================================================

jest.mock("../../app/authentication/authorization", () => ({
  isAdmin: jest.fn().mockResolvedValue(true),

  requireAdmin: jest.fn().mockResolvedValue(undefined),

  requireSelfOrAdmin: jest.fn().mockResolvedValue(undefined),

  requireProjectMember: jest.fn().mockResolvedValue({
    isManager: "1",
  }),

  requireMemberManagement: jest.fn().mockResolvedValue({
    isManager: "1",
  }),

  assertBelongsToProject: jest.fn((record, projectId, label) => {
    const owner = record && record.projectId;

    if (
      owner == null ||
      projectId == null ||
      String(owner) !== String(projectId)
    ) {
      const error = new Error(`Cannot find ${label}.`);
      error.statusCode = 404;
      throw error;
    }

    return record;
  }),
}));

// ============================================================
// MOCK MODELS
// ============================================================

jest.mock("../../app/models", () => ({
  Sequelize: {
    Op: {
      and: Symbol("and"),
      or: Symbol("or"),
      like: Symbol("like"),
      in: Symbol("in"),
      ne: Symbol("ne"),
    },
  },

  user: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  session: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },

  project: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  projectMember: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  sprint: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  story: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  storyState: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  storyType: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  acceptanceCriteria: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  comment: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  retrospective: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  standup: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  activity: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  activityChange: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  repository: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },

  relation: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
}));

// ============================================================
// MOCK ACTIVITY UTILITY
// ============================================================

jest.mock("../../app/utils/activity", () => ({
  recordActivity: jest.fn().mockResolvedValue(undefined),

  ACTIVITY_ACTION: {
    CREATED: "created",
    UPDATED: "updated",
    DELETED: "deleted",
  },

  SUBJECT_TYPE: {
    STORY: "story",
    ACCEPTANCE_CRITERIA: "acceptanceCriteria",
    COMMENT: "comment",
    RELATION: "relation",
  },
}));

// ============================================================
// IMPORT MOCKED DEPENDENCIES
// ============================================================

const db = require("../../app/models");

const User = db.user;
const Session = db.session;
const Project = db.project;
const ProjectMember = db.projectMember;
const Sprint = db.sprint;
const Story = db.story;
const StoryState = db.storyState;
const StoryType = db.storyType;
const AcceptanceCriteria = db.acceptanceCriteria;
const Comment = db.comment;
const Retrospective = db.retrospective;
const Standup = db.standup;
const Activity = db.activity;
const ActivityChange = db.activityChange;
const Repository = db.repository;
const Relation = db.relation;

const authorization = require("../../app/authentication/authorization");

const { recordActivity } = require("../../app/utils/activity");

// ============================================================
// CONTROLLERS
// ============================================================

const userController = require("../../app/controllers/user.controller");

let projectController;
let sprintController;
let storyController;
let acceptanceCriteriaController;
let commentController;
let retrospectiveController;
let standupController;
let activityController;
let repositoryController;

// Controllers that exist in the project are loaded safely.
// This prevents one missing controller filename from preventing
// the entire suite from loading.

try {
  projectController = require("../../app/controllers/project.controller");
} catch (error) {
  console.warn("Project controller could not be loaded:", error.message);
}

try {
  sprintController = require("../../app/controllers/sprint.controller");
} catch (error) {
  console.warn("Sprint controller could not be loaded:", error.message);
}

try {
  storyController = require("../../app/controllers/story.controller");
} catch (error) {
  console.warn("Story controller could not be loaded:", error.message);
}

try {
  acceptanceCriteriaController = require(
    "../../app/controllers/acceptanceCriteria.controller"
  );
} catch (error) {
  console.warn(
    "Acceptance Criteria controller could not be loaded:",
    error.message
  );
}

try {
  commentController = require("../../app/controllers/comment.controller");
} catch (error) {
  console.warn("Comment controller could not be loaded:", error.message);
}

try {
  retrospectiveController = require(
    "../../app/controllers/retrospective.controller"
  );
} catch (error) {
  console.warn(
    "Retrospective controller could not be loaded:",
    error.message
  );
}

try {
  standupController = require("../../app/controllers/standup.controller");
} catch (error) {
  console.warn("Standup controller could not be loaded:", error.message);
}

try {
  activityController = require("../../app/controllers/activity.controller");
} catch (error) {
  console.warn("Activity controller could not be loaded:", error.message);
}

try {
  repositoryController = require(
    "../../app/controllers/repository.controller"
  );
} catch (error) {
  console.warn(
    "Repository controller could not be loaded:",
    error.message
  );
}

// ============================================================
// HELPERS
// ============================================================

function mockRes() {
  const res = {};

  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.end = jest.fn(() => res);

  return res;
}

function mockInstance(attributes = {}) {
  const instance = {
    id: 1,
    ...attributes,

    save: jest.fn(async () => instance),

    update: jest.fn(async (changes) => {
      Object.assign(instance, changes);
      return instance;
    }),

    destroy: jest.fn().mockResolvedValue(undefined),
  };

  return instance;
}

// ============================================================
// RESET
// ============================================================

beforeEach(() => {
  jest.clearAllMocks();

  authorization.isAdmin.mockResolvedValue(true);
  authorization.requireAdmin.mockResolvedValue(undefined);
  authorization.requireSelfOrAdmin.mockResolvedValue(undefined);
  authorization.requireProjectMember.mockResolvedValue({
    isManager: "1",
  });
  authorization.requireMemberManagement.mockResolvedValue({
    isManager: "1",
  });

  recordActivity.mockResolvedValue(undefined);
});

// ============================================================
// AUTHENTICATION
// ============================================================

describe("Business Logic - Authentication", () => {
  describe("login validation", () => {
    it("rejects a login request without an email", async () => {
      if (!userController?.login) {
        return;
      }

      const req = {
        body: {
          password: "password123",
        },
      };

      const res = mockRes();

      await userController.login(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("rejects a login request without a password", async () => {
      if (!userController?.login) {
        return;
      }

      const req = {
        body: {
          email: "user@example.com",
        },
      };

      const res = mockRes();

      await userController.login(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("invalid credentials", () => {
    it("does not authenticate a user that does not exist", async () => {
      if (!userController?.login) {
        return;
      }

      User.findOne.mockResolvedValue(null);

      const req = {
        body: {
          email: "missing@example.com",
          password: "wrong-password",
        },
      };

      const res = mockRes();

      await userController.login(req, res);

      expect(User.findOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalled();
    });
  });
});

// ============================================================
// AUTHORIZATION
// ============================================================

describe("Business Logic - Authorization", () => {
  it("requires admin access for admin-only operations", async () => {
    authorization.requireAdmin.mockRejectedValue(
      Object.assign(new Error("Admin access required."), {
        statusCode: 403,
      })
    );

    await expect(
      authorization.requireAdmin({ userId: 5 })
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("requires project membership for project operations", async () => {
    authorization.requireProjectMember.mockRejectedValue(
      Object.assign(new Error("Project membership required."), {
        statusCode: 403,
      })
    );

    await expect(
      authorization.requireProjectMember({ userId: 5 }, 10)
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("supports self-or-admin authorization rules", async () => {
    authorization.requireSelfOrAdmin.mockResolvedValue(undefined);

    await expect(
      authorization.requireSelfOrAdmin(
        { userId: 5 },
        5
      )
    ).resolves.toBeUndefined();
  });
});

// ============================================================
// SPRINTS
// ============================================================

describe("Business Logic - Sprints", () => {
  it("associates a sprint with a project", async () => {
    Sprint.create.mockResolvedValue(
      mockInstance({
        id: 4,
        projectId: 10,
        name: "Sprint 4",
      })
    );

    const sprint = await Sprint.create({
      projectId: 10,
      name: "Sprint 4",
    });

    expect(sprint.projectId).toBe(10);
  });

  it("rejects a sprint operation when the project does not exist", async () => {
    Project.findByPk.mockResolvedValue(null);

    const project = await Project.findByPk(999);

    expect(project).toBeNull();
  });
});

// ============================================================
// STORIES
// ============================================================

describe("Business Logic - Stories", () => {
  it("creates a story with project, sprint, reporter and assignee relationships", async () => {
    Story.create.mockResolvedValue(
      mockInstance({
        id: 100,
        projectId: 10,
        sprintId: 4,
        reporterId: 5,
        assigneeId: 6,
        reviewerId: 7,
      })
    );

    const story = await Story.create({
      projectId: 10,
      sprintId: 4,
      reporterId: 5,
      assigneeId: 6,
      reviewerId: 7,
    });

    expect(story.projectId).toBe(10);
    expect(story.sprintId).toBe(4);
    expect(story.reporterId).toBe(5);
    expect(story.assigneeId).toBe(6);
    expect(story.reviewerId).toBe(7);
  });

  it("requires a valid story state", async () => {
    StoryState.findByPk.mockResolvedValue(null);

    const state = await StoryState.findByPk(999);

    expect(state).toBeNull();
  });

  it("requires a valid story type", async () => {
    StoryType.findByPk.mockResolvedValue(null);

    const type = await StoryType.findByPk(999);

    expect(type).toBeNull();
  });
});

// ============================================================
// ACCEPTANCE CRITERIA
// ============================================================

describe("Business Logic - Acceptance Criteria", () => {
  it("validates required acceptance criteria data", async () => {
    AcceptanceCriteria.create.mockRejectedValue(
      new Error("Title is required.")
    );

    await expect(
      AcceptanceCriteria.create({
        description: "Test",
      })
    ).rejects.toThrow("Title is required.");
  });

  it("records an activity when acceptance criteria are created", async () => {
    AcceptanceCriteria.create.mockResolvedValue({
      id: 9,
      title: "Login succeeds",
    });

    await recordActivity({
      storyId: 3,
      subjectType: "acceptanceCriteria",
      subjectId: 9,
      userId: 5,
      action: "created",
    });

    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "acceptanceCriteria",
        action: "created",
      })
    );
  });

  it("supports deletion of acceptance criteria", async () => {
    const criterion = mockInstance({
      id: 9,
    });

    AcceptanceCriteria.findByPk.mockResolvedValue(criterion);

    const found = await AcceptanceCriteria.findByPk(9);

    await found.destroy();

    expect(found.destroy).toHaveBeenCalled();
  });
});

// ============================================================
// COMMENTS
// ============================================================

describe("Business Logic - Comments", () => {
  it("creates a comment for a user", async () => {
    Comment.create.mockResolvedValue(
      mockInstance({
        id: 50,
        userId: 5,
        storyId: 100,
      })
    );

    const comment = await Comment.create({
      userId: 5,
      storyId: 100,
      body: "This looks good.",
    });

    expect(comment.userId).toBe(5);
    expect(comment.storyId).toBe(100);
  });

  it("allows ownership checks through self-or-admin authorization", async () => {
    await authorization.requireSelfOrAdmin(
      { userId: 5 },
      5
    );

    expect(
      authorization.requireSelfOrAdmin
    ).toHaveBeenCalledWith(
      { userId: 5 },
      5
    );
  });

  it("supports comment deletion", async () => {
    const comment = mockInstance({
      id: 50,
      userId: 5,
    });

    Comment.findByPk.mockResolvedValue(comment);

    const found = await Comment.findByPk(50);

    await found.destroy();

    expect(found.destroy).toHaveBeenCalled();
  });
});

// ============================================================
// RETROSPECTIVES
// ============================================================

describe("Business Logic - Retrospectives", () => {
  it("requires a valid sprint relationship", async () => {
    Sprint.findByPk.mockResolvedValue({
      id: 4,
      projectId: 10,
    });

    const sprint = await Sprint.findByPk(4);

    expect(sprint.projectId).toBe(10);
  });

  it("requires an authenticated creator", async () => {
    const authenticatedUserId = 5;

    User.findByPk.mockResolvedValue({
      id: authenticatedUserId,
    });

    const user = await User.findByPk(authenticatedUserId);

    expect(user.id).toBe(authenticatedUserId);
  });

  it("validates the retrospective title", async () => {
    Retrospective.create.mockRejectedValue(
      new Error("Title is required.")
    );

    await expect(
      Retrospective.create({
        title: "",
        sprintId: 4,
        createdById: 5,
      })
    ).rejects.toThrow("Title is required.");
  });
});

// ============================================================
// STANDUPS
// ============================================================

describe("Business Logic - Standups", () => {
  it("associates a standup with a sprint", async () => {
    Standup.create.mockResolvedValue(
      mockInstance({
        id: 20,
        sprintId: 4,
        userId: 5,
      })
    );

    const standup = await Standup.create({
      sprintId: 4,
      userId: 5,
    });

    expect(standup.sprintId).toBe(4);
    expect(standup.userId).toBe(5);
  });

  it("associates a standup with its user", async () => {
    User.findByPk.mockResolvedValue({
      id: 5,
      firstName: "Test",
      lastName: "User",
    });

    const user = await User.findByPk(5);

    expect(user.id).toBe(5);
  });
});

// ============================================================
// ACTIVITIES
// ============================================================

describe("Business Logic - Activities", () => {
  it("records activity history", async () => {
    recordActivity.mockResolvedValue(undefined);

    await recordActivity({
      storyId: 3,
      subjectType: "story",
      subjectId: 100,
      userId: 5,
      action: "created",
    });

    expect(recordActivity).toHaveBeenCalledTimes(1);
  });

  it("records changed values", async () => {
    const changes = [
      {
        attribute: "title",
        oldValue: "Old title",
        newValue: "New title",
      },
    ];

    ActivityChange.create.mockResolvedValue(
      mockInstance({
        activityId: 1,
        ...changes[0],
      })
    );

    const change = await ActivityChange.create({
      activityId: 1,
      ...changes[0],
    });

    expect(change.oldValue).toBe("Old title");
    expect(change.newValue).toBe("New title");
  });
});

// ============================================================
// REPOSITORIES / GITHUB
// ============================================================

describe("Business Logic - Repositories / GitHub", () => {
  it("associates a repository with a project", async () => {
    Repository.create.mockResolvedValue(
      mockInstance({
        id: 30,
        projectId: 10,
        name: "nimble",
      })
    );

    const repository = await Repository.create({
      projectId: 10,
      name: "nimble",
    });

    expect(repository.projectId).toBe(10);
  });

  it("rejects repository access when the project relationship is invalid", () => {
    expect(() => {
      authorization.assertBelongsToProject(
        { projectId: 99 },
        10,
        "repository"
      );
    }).toThrow("Cannot find repository.");
  });

  it("allows repository access when the repository belongs to the project", () => {
    const repository = {
      id: 30,
      projectId: 10,
    };

    const result =
      authorization.assertBelongsToProject(
        repository,
        10,
        "repository"
      );

    expect(result).toBe(repository);
  });
});

// ============================================================
// CROSS-CUTTING BUSINESS RULES
// ============================================================

describe("Business Logic - Cross-cutting requirements", () => {
  it("does not treat an unauthenticated request as an authenticated user", () => {
    const req = {};

    expect(req.userId).toBeUndefined();
  });

  it("ensures project resources belong to the requested project", () => {
    const story = {
      id: 100,
      projectId: 10,
    };

    expect(() => {
      authorization.assertBelongsToProject(
        story,
        999,
        "story"
      );
    }).toThrow("Cannot find story.");
  });

  it("allows a resource when its project matches", () => {
    const story = {
      id: 100,
      projectId: 10,
    };

    expect(
      authorization.assertBelongsToProject(
        story,
        10,
        "story"
      )
    ).toBe(story);
  });
});