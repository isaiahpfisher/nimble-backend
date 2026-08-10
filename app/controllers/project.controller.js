const db = require("../models");
const Project = db.project;
const ProjectMember = db.projectMember;
const StoryType = db.storyType;
const StoryState = db.storyState;
const User = db.user;
const { authenticate } = require("../authentication/authentication");
const { requireAdmin, requireProjectMember } = require("../authentication/authorization");
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");

const DEFAULT_PROJECT_STORY_TYPES = [{ name: "Feature" }, { name: "Bug" }, { name: "Chore" }];

const DEFAULT_PROJECT_STORY_STATES = [
  { name: "Not Started", order: 1 },
  { name: "In Progress", order: 2 },
  { name: "Ready for Test", order: 3 },
  { name: "In Test", order: 4 },
  { name: "Done", order: 5 },
];

exports.findAll = async (req, res) => {
  try {
    await requireAdmin(req.userId);

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
    res.status(err.statusCode || 500).send({
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
  const id = req.params.id;
  try {
    await requireProjectMember(req.userId, id);

    const data = await Project.findByPk(id, {
      include: [
        { model: db.storyType, as: "storyType" },
        { model: db.storyState, as: "storyState" },
        { model: db.sprint, as: "sprint" },
        { model: db.repository, as: "repository" },
        { model: db.storyState, as: "branchCreationState" },
        { model: db.storyState, as: "prReviewState" },
        {
          model: db.projectMember,
          as: "projectMembers",
          include: {
            model: db.user,
            as: "user",
            required: false,
            attributes: ["id", "firstName", "lastName", "email"],
          },
        },
      ],
    });

    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find Project with id = ${id}.`,
      });
    }
  } catch (err) {
    res.status(err.statusCode || 500).send({
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
      isManager: "1",
    });

    await StoryType.bulkCreate(DEFAULT_PROJECT_STORY_TYPES.map((t) => ({ ...t, projectId: data.id })));
    const states = await StoryState.bulkCreate(DEFAULT_PROJECT_STORY_STATES.map((s) => ({ ...s, projectId: data.id })));

    await data.update({
      completedStateId: states[states.length - 1].id,
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
    const { userId } = await authenticate(req, res);
    await requireAdmin(userId);

    if (!req.body.title || !req.body.deadline || !req.body.description || !req.body.managerId) {
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
      isManager: "1",
    });

    await StoryType.bulkCreate(
      DEFAULT_PROJECT_STORY_TYPES.map((t) => ({
        ...t,
        projectId: data.id,
      })),
    );
    const states = await StoryState.bulkCreate(
      DEFAULT_PROJECT_STORY_STATES.map((s) => ({
        ...s,
        projectId: data.id,
      })),
    );

    await data.update({
      completedStateId: states[states.length - 1].id,
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
    const { userId } = await authenticate(req, res);
    await requireProjectMember(userId, req.params.id);

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

    const STATE_FIELDS = {
      completedStateId: "completed state",
      branchCreationStateId: "branch creation state",
      prReviewStateId: "PR review state",
    };

    for (const [field, label] of Object.entries(STATE_FIELDS)) {
      if (req.body[field]) {
        const state = await StoryState.findOne({
          where: { id: req.body[field], projectId: req.params.id },
        });
        if (!state) {
          throw httpError(`Invalid ${label}.`, 400);
        }
      }
    }

    const { title, description, deadline, branchCreationStateId, prReviewStateId, completedStateId } = req.body;
    await project.update({
      title,
      description,
      deadline,
      branchCreationStateId,
      prReviewStateId,
      completedStateId,
    });

    res.send(project);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating project.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await requireProjectMember(userId, req.params.id);

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
