const db = require("../models");
const ProjectMember = db.projectMember;
const Op = db.Sequelize.Op;
const User = db.user;
const Project = db.project;
const { authenticate } = require("../authentication/authentication");
const {
  requireAdmin,
  requireSelfOrAdmin,
  requireProjectMember,
  requireMemberManagement,
} = require("../authentication/authorization");
const { httpError } = require("../utils/httpUtils");

exports.findAll = async (req, res) => {
  try {
    await requireAdmin(req.userId);

    const data = await ProjectMember.findAll();
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.create = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    if (!req.body.userId || !req.body.projectId || !req.body.isManager) {
      throw httpError("Missing required fields.", 400);
    }

    await requireMemberManagement(userId, req.body.projectId);

    const projectMember = {
      userId: req.body.userId,
      projectId: req.body.projectId,
      isManager: req.body.isManager,
    };

    const data = await ProjectMember.create(projectMember);

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating projectMember.",
    });
  }
};

exports.findAllForUser = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await requireSelfOrAdmin(userId, req.params.userId);

    const data = await ProjectMember.findAll({
        where: { userId: req.params.userId },
    });
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error retrieving projectMembers for user.",
    });
  }
};

exports.findAllForProject = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await requireProjectMember(userId, req.params.projectId);

    const data = await ProjectMember.findAll({
        where: { projectId: req.params.projectId },
    });
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error retrieving projectMembers for user.",
    });
  }
};

exports.findOne = async (req, res) => {
  const id = req.params.id;
  try {
    const { userId } = await authenticate(req, res);

    const data = await ProjectMember.findByPk(id, {
    });

    if (data) {
      await requireProjectMember(userId, data.projectId);
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find ProjectMember with id = ${id}.`,
      });
    }
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error retrieving ProjectMember with id = " + id,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const projectMember = await ProjectMember.findByPk(req.params.id);
    if (!projectMember) {
      throw httpError(`Cannot find ProjectMember with id = ${req.params.id}.`, 404);
    }

    await requireMemberManagement(userId, projectMember.projectId);

    const { isManager } = req.body;
    await projectMember.update({ isManager });

    res.send(projectMember);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating projectMember.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const projectMember = await ProjectMember.findByPk(req.params.id);
    if (!projectMember) {
      throw httpError(`Cannot find ProjectMember with id = ${req.params.id}.`, 404);
    }

    await requireMemberManagement(userId, projectMember.projectId);

    await projectMember.destroy();
    res.send({ message: "ProjectMember deleted successfully!" });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting projectMember.",
    });
  }
};