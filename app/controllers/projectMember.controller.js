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

    if (!req.body.title || !req.body.deadline || !req.body.description) {
      throw httpError("Missing required fields.", 400);
    }

    const deadline = new Date(req.body.deadline);
    if (isNaN(deadline.getTime()) || deadline < new Date()) {
      throw httpError("Invalid deadline.", 400);
    }

    const project = {
      title: req.body.title,
      description: req.body.description,
      deadline: req.body.deadline,
    };

    const data = await Project.create(project);

    await ProjectMember.create({
      userId,
      projectId: data.id,
      isManager: true,
    });

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating project.",
    });
  }
};