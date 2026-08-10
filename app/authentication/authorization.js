const db = require("../models");
const { httpError } = require("../utils/httpUtils");

const ProjectMember = db.projectMember;
const User = db.user;

function isManagerFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

async function isAdmin(userId) {
  if (!userId) return false;
  const user = await User.findByPk(userId, { attributes: ["id", "isAdmin"] });
  return !!user && !!user.isAdmin;
}

async function requireAdmin(userId) {
  if (!userId) {
    throw httpError("Authentication required.", 401);
  }
  if (!(await isAdmin(userId))) {
    throw httpError("Administrator access required.", 403);
  }
}

async function requireSelfOrAdmin(userId, targetUserId) {
  if (!userId) {
    throw httpError("Authentication required.", 401);
  }
  if (userId == targetUserId) return;
  if (await isAdmin(userId)) return;
  throw httpError("You do not have access to this user.", 403);
}

async function requireProjectMember(userId, projectId) {
  if (!userId) {
    throw httpError("Authentication required.", 401);
  }
  if (!projectId) {
    throw httpError("No project specified.", 400);
  }

  const membership = await ProjectMember.findOne({
    where: { userId, projectId },
  });

  if (membership) return membership;
  if (await isAdmin(userId)) return null;

  throw httpError("You do not have access to this project.", 403);
}

async function requireMemberManagement(userId, projectId) {
  const membership = await requireProjectMember(userId, projectId);

  if (membership === null) return null;

  if (!isManagerFlag(membership.isManager)) {
    throw httpError("You must be a project manager to manage members.", 403);
  }
  return membership;
}

function assertBelongsToProject(record, projectId, label) {
  const owner = record && record.projectId;
  if (owner == null || projectId == null || owner != projectId) {
    throw httpError(`Cannot find ${label}.`, 404);
  }
  return record;
}

module.exports = {
  isAdmin,
  isManagerFlag,
  requireAdmin,
  requireSelfOrAdmin,
  requireProjectMember,
  requireMemberManagement,
  assertBelongsToProject,
};
