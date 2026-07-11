const db = require("../models");
const Project = db.project;
const ProjectMember = db.projectMember;
const User = db.user;
const { authenticate } = require("../authentication/authentication");
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");

exports.findAll = async (req, res) => {
  try {
    const data = await Project.findAll({
      include: {
        model: db.projectMember,
        as: "projectMembers",
        include: {
          model: db.user,
          as: "user",
          required: false,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      },
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving all projects",
    });
  }
};

exports.findAllForUser = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const data = await Project.findAll({
      include: {
        model: db.projectMember,
        as: "projectMembers",
        where: { userId },
        attributes: [],
      },
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving projects for user.",
    });
  }
};

exports.findOne = async (req, res) => {
  try {
    const id = req.params.id;
    const data = await Project.findByPk(id, {
      include: {
        model: db.projectMember,
        as: "projectMembers",
        include: {
          model: db.user,
          as: "user",
          required: false,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      },
    });

    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find Project with id = ${id}.`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving Project with id = " + id,
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

exports.adminCreate = async (req, res) => {
  try {
    if (
      !req.body.title ||
      !req.body.deadline ||
      !req.body.description ||
      !req.body.managerId
    ) {
      throw httpError("Missing required fields.", 400);
    }

    const deadline = new Date(req.body.deadline);
    if (isNaN(deadline.getTime()) || deadline < new Date()) {
      throw httpError("Invalid deadline.", 400);
    }

    const manager = await User.findByPk(req.body.managerId);
    if (!manager) {
      throw httpError(`Cannot find User with id = ${req.body.managerId}.`, 404);
    }

    const project = {
      title: req.body.title,
      description: req.body.description,
      deadline: req.body.deadline,
    };

    const data = await Project.create(project);

    await ProjectMember.create({
      userId: manager.id,
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

exports.update = async (req, res) => {
  try {
    await authenticate(req, res);

    const project = await Project.findByPk(req.params.id);
    if (!project) {
      throw httpError(`Cannot find Project with id = ${req.params.id}.`, 404);
    }

    if (req.body.deadline) {
      const deadline = new Date(req.body.deadline);
      if (isNaN(deadline.getTime()) || deadline < new Date()) {
        throw httpError("Invalid deadline.", 400);
      }
    }

    const { title, description, deadline } = req.body;
    await project.update({ title, description, deadline });

    res.send(project);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating project.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    await authenticate(req, res);

    const project = await Project.findByPk(req.params.id);
    if (!project) {
      throw httpError(`Cannot find Project with id = ${req.params.id}.`, 404);
    }

    await project.destroy();
    res.send({ message: "Project deleted successfully!" });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting project.",
    });
  }
};
