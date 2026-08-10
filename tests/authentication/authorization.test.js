// Mock the models module so requiring the helpers never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  projectMember: { findOne: jest.fn() },
  user: { findByPk: jest.fn() },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const ProjectMember = db.projectMember;
const User = db.user;
const {
  isAdmin,
  isManagerFlag,
  requireAdmin,
  requireSelfOrAdmin,
  requireProjectMember,
  requireMemberManagement,
  assertBelongsToProject,
} = require("../../app/authentication/authorization");

// Resolves the thrown error so both the message and the status can be asserted.
async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, but it resolved");
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findByPk.mockResolvedValue({ id: 42, isAdmin: false });
});

describe("isManagerFlag", () => {
  // isManager is a STRING column defaulting to "0", which is truthy, so the
  // check cannot just be `if (member.isManager)`.
  it("rejects the default '0' string", () => {
    expect(isManagerFlag("0")).toBe(false);
  });

  it.each([true, 1, "1", "true"])("accepts %p", (value) => {
    expect(isManagerFlag(value)).toBe(true);
  });

  it.each([false, 0, "", null, undefined, "no"])("rejects %p", (value) => {
    expect(isManagerFlag(value)).toBe(false);
  });
});

describe("isAdmin", () => {
  it("is false without a user id", async () => {
    await expect(isAdmin(undefined)).resolves.toBe(false);
    expect(User.findByPk).not.toHaveBeenCalled();
  });

  it("is false when the user is missing", async () => {
    User.findByPk.mockResolvedValue(null);
    await expect(isAdmin(42)).resolves.toBe(false);
  });

  it("is true for an administrator", async () => {
    User.findByPk.mockResolvedValue({ id: 42, isAdmin: true });
    await expect(isAdmin(42)).resolves.toBe(true);
  });

  it("only reads the flag, never the credentials", async () => {
    await isAdmin(42);
    expect(User.findByPk).toHaveBeenCalledWith(42, {
      attributes: ["id", "isAdmin"],
    });
  });
});

describe("requireAdmin", () => {
  it("401s without a user id", async () => {
    const err = await rejection(requireAdmin(undefined));
    expect(err.statusCode).toBe(401);
  });

  it("403s a non-administrator", async () => {
    const err = await rejection(requireAdmin(42));
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Administrator access required.");
  });

  it("allows an administrator", async () => {
    User.findByPk.mockResolvedValue({ id: 42, isAdmin: true });
    await expect(requireAdmin(42)).resolves.toBeUndefined();
  });
});

describe("requireSelfOrAdmin", () => {
  it("401s without a user id", async () => {
    const err = await rejection(requireSelfOrAdmin(undefined, 42));
    expect(err.statusCode).toBe(401);
  });

  it("allows a user acting on themselves", async () => {
    await expect(requireSelfOrAdmin(42, 42)).resolves.toBeUndefined();
    // the self check short-circuits before any lookup
    expect(User.findByPk).not.toHaveBeenCalled();
  });

  it("compares ids across types, since route params arrive as strings", async () => {
    await expect(requireSelfOrAdmin(42, "42")).resolves.toBeUndefined();
  });

  it("403s a different, non-administrator user", async () => {
    const err = await rejection(requireSelfOrAdmin(42, 7));
    expect(err.statusCode).toBe(403);
  });

  it("allows an administrator to act on someone else", async () => {
    User.findByPk.mockResolvedValue({ id: 42, isAdmin: true });
    await expect(requireSelfOrAdmin(42, 7)).resolves.toBeUndefined();
  });
});

describe("requireProjectMember", () => {
  it("401s without a user id", async () => {
    const err = await rejection(requireProjectMember(undefined, 1));
    expect(err.statusCode).toBe(401);
  });

  it.each([undefined, null, ""])("400s when the project id is %p", async (projectId) => {
    const err = await rejection(requireProjectMember(42, projectId));
    expect(err.statusCode).toBe(400);
    expect(ProjectMember.findOne).not.toHaveBeenCalled();
  });

  it("returns the membership row for a member", async () => {
    const membership = { id: 5, userId: 42, projectId: 1, isManager: "0" };
    ProjectMember.findOne.mockResolvedValue(membership);

    await expect(requireProjectMember(42, 1)).resolves.toBe(membership);
    expect(ProjectMember.findOne).toHaveBeenCalledWith({
      where: { userId: 42, projectId: 1 },
    });
  });

  it("403s a user who does not belong to the project", async () => {
    ProjectMember.findOne.mockResolvedValue(null);

    const err = await rejection(requireProjectMember(42, 1));
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("You do not have access to this project.");
  });

  it("lets an administrator through without a membership row", async () => {
    ProjectMember.findOne.mockResolvedValue(null);
    User.findByPk.mockResolvedValue({ id: 42, isAdmin: true });

    await expect(requireProjectMember(42, 1)).resolves.toBeNull();
  });
});

describe("requireMemberManagement", () => {
  it("403s a plain member", async () => {
    ProjectMember.findOne.mockResolvedValue({ id: 5, isManager: "0" });

    const err = await rejection(requireMemberManagement(42, 1));
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("You must be a project manager to manage members.");
  });

  it("allows a project manager", async () => {
    const membership = { id: 5, isManager: "1" };
    ProjectMember.findOne.mockResolvedValue(membership);

    await expect(requireMemberManagement(42, 1)).resolves.toBe(membership);
  });

  it("allows an administrator who is not a member at all", async () => {
    ProjectMember.findOne.mockResolvedValue(null);
    User.findByPk.mockResolvedValue({ id: 42, isAdmin: true });

    await expect(requireMemberManagement(42, 1)).resolves.toBeNull();
  });

  it("403s a non-member who is not an administrator", async () => {
    ProjectMember.findOne.mockResolvedValue(null);

    const err = await rejection(requireMemberManagement(42, 1));
    expect(err.statusCode).toBe(403);
  });
});

describe("assertBelongsToProject", () => {
  it("returns the record when it belongs to the project", () => {
    const record = { id: 7, projectId: 1 };
    expect(assertBelongsToProject(record, 1, "Story")).toBe(record);
  });

  it("compares across types, since route params arrive as strings", () => {
    const record = { id: 7, projectId: 1 };
    expect(assertBelongsToProject(record, "1", "Story")).toBe(record);
  });

  it("reports 404 rather than 403, so the id cannot be probed", () => {
    let error;
    try {
      assertBelongsToProject({ id: 7, projectId: 2 }, 1, "Story with id = 7");
    } catch (err) {
      error = err;
    }
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("Cannot find Story with id = 7.");
  });

  it.each([
    ["a missing record", null, 1],
    ["a record with no project", { id: 7 }, 1],
    ["a missing project id", { id: 7, projectId: 1 }, undefined],
  ])("throws 404 for %s", (_label, record, projectId) => {
    expect(() => assertBelongsToProject(record, projectId, "Story")).toThrow(
      "Cannot find Story.",
    );
  });
});
