const db = require("../models");
const ProjectMember = db.projectMember;
const Op = db.Sequelize.Op;
const User = db.user;
const Project = db.project;
const { authenticate } = require("../authentication/authentication");
const { httpError } = require("../utils/httpUtils");

exports.findAll = async (req, res) => {
  try {
    const data = await ProjectMember.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
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

    const projectMember = {
      userId: req.body.userId,
      projectId: req.body.projectId,
      isManager: req.body.isManager,
    };

    const data = await ProjectMember.create(project);

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating project.",
    });
  }
};