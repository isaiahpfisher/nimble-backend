const db = require("../models");
const Story = db.story;
const Project = db.project;
const User = db.user;
const Repository = db.repository;
const Sprint = db.sprint;
const AcceptanceCriteria = db.acceptanceCriteria;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");
const {
  notifyAssignedUser,
  notifyReviewerUser,
  storyUrl,
} = require("../utils/email");

exports.findAll = async (req, res) => {
  try {
    const data = await Story.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.findOne = async (req, res) => {
  const storyId = req.params.storyId;

  try {
    const data = await Story.findByPk(storyId, {
      include: [
        { model: db.storyState, as: "state" },
        { model: db.storyType, as: "type" },
        { model: db.repository, as: "repository" },
        { model: db.project, as: "project" },
        { model: db.sprint, as: "sprint" },
        {
          model: db.user,
          as: "reporter",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: db.user,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: db.user,
          as: "reviewer",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: db.acceptanceCriteria, as: "acceptanceCriteria" },
        { model: db.comment, as: "comment" },
        {
          model: db.relation,
          as: "relationOne",
          include: [
            {
              model: db.story,
              as: "storyTwo",
              attributes: ["id", "title", "typeId", "stateId"],
            },
          ],
        },
        {
          model: db.relation,
          as: "relationTwo",
          include: [
            {
              model: db.story,
              as: "storyOne",
              attributes: ["id", "title", "typeId", "stateId"],
            },
          ],
        },
      ],
    });

    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find Story with id = ${storyId}.`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving Story with id = " + storyId,
    });
  }
};

exports.findAllForProject = async (req, res) => {
  const projectId = req.params.id;
  try {
    const data = await Story.findAll({
      where: { projectId: projectId },
      include: [
        { model: db.storyState, as: "state" },
        { model: db.storyType, as: "type" },
        { model: db.repository, as: "repository" },
        { model: db.project, as: "project" },
        { model: db.sprint, as: "sprint" },
        {
          model: db.user,
          as: "reporter",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: db.user,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: db.user,
          as: "reviewer",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: db.acceptanceCriteria, as: "acceptanceCriteria" },
        { model: db.comment, as: "comment" },
      ],
    });
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
    const projectId = req.params.id;

    if (!req.body.title || !req.body.description || !req.body.stateId) {
      throw httpError("Missing required fields.", 400);
    }

    const project = await Project.findByPk(projectId);

    if (!project) {
      throw httpError(`Cannot find Project with id = ${projectId}.`, 404);
    }

    const story = {
      title: req.body.title,
      description: req.body.description,
      typeId: req.body.typeId,
      stateId: req.body.stateId,
      priority: req.body.priority,
      estimate: req.body.estimate,
      projectId: projectId,
      sprintId: req.body.sprintId,
      repositoryId: req.body.repositoryId,
      reporterId: userId,
      assigneeId: req.body.assigneeId,
      reviewerId: req.body.reviewerId,
    };

    const data = await Story.create(story);

    const activeUser = await User.findByPk(userId);
    const context = [
      { label: "Story", value: data.title, url: storyUrl(data) },
    ];

    if (data.assigneeId && data.assigneeId !== userId) {
      const assignee = await User.findByPk(data.assigneeId);
      if (assignee) {
        await notifyAssignedUser(assignee, activeUser, data, context);
      }
    }

    if (data.reviewerId && data.reviewerId !== userId) {
      const reviewer = await User.findByPk(data.reviewerId);
      if (reviewer) {
        await notifyReviewerUser(reviewer, activeUser, data, context);
      }
    }

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating story.",
    });
  }
};

exports.update = async (req, res) => {
  const storyId = req.params.storyId;

  try {
    const { userId } = await authenticate(req, res);

    if (!req.body.title || !req.body.description || !req.body.stateId) {
      throw httpError("Missing required fields.", 400);
    }

    const story = await Story.findByPk(storyId);

    if (!story) {
      throw httpError(`Cannot find Story with id = ${storyId}.`, 404);
    }

    const activeUser = await User.findByPk(userId);
    const context = [
      { label: "Story", value: story.title, url: storyUrl(story) },
    ];

    if (
      req.body.assigneeId &&
      req.body.assigneeId != story.assigneeId &&
      req.body.assigneeId != userId
    ) {
      const assignee = await User.findByPk(req.body.assigneeId);
      if (assignee) {
        await notifyAssignedUser(assignee, activeUser, story, context);
      }
    }

    if (
      req.body.reviewerId &&
      req.body.reviewerId != story.reviewerId &&
      req.body.reviewerId != userId
    ) {
      const reviewer = await User.findByPk(req.body.reviewerId);
      if (reviewer) {
        await notifyReviewerUser(reviewer, activeUser, story, context);
      }
    }

    await story.update({
      title: req.body.title,
      description: req.body.description,
      typeId: req.body.typeId,
      stateId: req.body.stateId,
      priority: req.body.priority,
      estimate: req.body.estimate,
      sprintId: req.body.sprintId,
      repositoryId: req.body.repositoryId,
      reporterId: req.body.reporterId,
      assigneeId: req.body.assigneeId,
      reviewerId: req.body.reviewerId,
    });

    res.send(story);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating story.",
    });
  }
};

exports.delete = async (req, res) => {
  const storyId = req.params.storyId;
  try {
    await authenticate(req, res);

    const story = await Story.findByPk(storyId);
    if (!story) {
      throw httpError(`Cannot find Story with id = ${storyId}.`, 404);
    }

    await story.destroy();
    res.send({ message: "Story deleted successfully!" });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting story.",
    });
  }
};
