const db = require("../models");
const Story = db.story;
const StoryState = db.storyState;
const Project = db.project;
const User = db.user;
const Repository = db.repository;
const Sprint = db.sprint;
const AcceptanceCriteria = db.acceptanceCriteria;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");
const {
  recordActivity,
  ACTIVITY_ACTION,
  SUBJECT_TYPE,
  STORY_PLAIN_FIELDS,
  STORY_ASSOC_FIELDS,
} = require("../utils/activity");
const { notifyAssignedUser, notifyReviewerUser, storyUrl } = require("../utils/email");

const UPDATABLE_STORY_FIELDS = [
  "title",
  "description",
  "typeId",
  "stateId",
  "priority",
  "estimate",
  "sprintId",
  "repositoryId",
  "assigneeId",
  "reviewerId",
];

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

    const [state, assignee] = await Promise.all([
      req.body.stateId ? StoryState.findByPk(req.body.stateId, { attributes: ["id", "name"] }) : null,
      req.body.assigneeId ? User.findByPk(req.body.assigneeId, { attributes: ["id", "firstName", "lastName"] }) : null,
    ]);

    await recordActivity({
      storyId: data.id,
      subjectType: "story",
      subjectId: data.id,
      userId,
      action: "created",
      metadata: {
        title: data.title,
        state: state?.name ?? null,
        assignee: assignee ? `${assignee.firstName} ${assignee.lastName}` : null,
      },
    });

    const activeUser = await User.findByPk(userId);
    const context = [{ label: "Story", value: data.title, url: storyUrl(data) }];

    try {
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
    } catch (emailError) {
      console.error("Failed to send story notification email:", emailError);
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
    const activeUser = await User.findByPk(userId);

    const newStory = {};
    for (const field of UPDATABLE_STORY_FIELDS) {
      if (req.body[field] !== undefined) newStory[field] = req.body[field];
    }

    // required fields
    if (["title", "description", "stateId"].some((f) => f in newStory && !newStory[f])) {
      throw httpError("Missing required fields.", 400);
    }

    const story = await Story.findByPk(storyId, {
      include: {
        model: db.project,
        as: "project",
        attributes: ["id"],
        include: {
          model: db.storyState,
          as: "completedState",
        },
      },
    });

    if (!story) {
      throw httpError(`Cannot find Story with id = ${storyId}.`, 404);
    }

    const context = [{ label: "Story", value: story.title, url: storyUrl(story) }];

    try {
      if (req.body.assigneeId && req.body.assigneeId != story.assigneeId && req.body.assigneeId != userId) {
        const assignee = await User.findByPk(req.body.assigneeId);
        if (assignee) {
          await notifyAssignedUser(assignee, activeUser, story, context);
        }
      }

      if (req.body.reviewerId && req.body.reviewerId != story.reviewerId && req.body.reviewerId != userId) {
        const reviewer = await User.findByPk(req.body.reviewerId);
        if (reviewer) {
          await notifyReviewerUser(reviewer, activeUser, story, context);
        }
      }
    } catch (emailError) {
      console.error("Failed to send story notification email:", emailError);
    }

    if (
      req.body.stateId &&
      req.body.stateId !== story.stateId &&
      req.body.stateId == story.project?.completedState?.id
    ) {
      newStory.completedAt = new Date();
    }

    // save previous values for comparison
    const assocKeys = Object.keys(STORY_ASSOC_FIELDS);
    const before = {};
    for (const field of STORY_PLAIN_FIELDS) {
      before[field] = story[field];
    }

    for (const field of assocKeys) {
      before[field] = story[field];
    }

    await story.update(newStory);

    const plainFieldChanges = STORY_PLAIN_FIELDS.filter((f) => before[f] != story[f]).map((f) => ({
      attribute: f,
      oldValue: before[f],
      newValue: story[f],
    }));

    const assocFieldChanges = [];
    const assocFieldChangesRaw = assocKeys.filter((f) => before[f] != story[f]);
    for (const field of assocFieldChangesRaw) {
      const config = STORY_ASSOC_FIELDS[field];
      const model = config.model();

      const [oldRow, newRow] = await Promise.all([
        before[field] != null ? model.findByPk(before[field]) : null,
        story[field] != null ? model.findByPk(story[field]) : null,
      ]);

      assocFieldChanges.push({
        attribute: config.attribute,
        oldValue: oldRow ? { id: oldRow.id, label: config.label(oldRow) } : null,
        newValue: newRow ? { id: newRow.id, label: config.label(newRow) } : null,
      });
    }

    const changes = [...plainFieldChanges, ...assocFieldChanges];
    if (changes.length) {
      await recordActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.STORY,
        subjectId: story.id,
        userId,
        action: ACTIVITY_ACTION.UPDATED,
        metadata: { user: `${activeUser.firstName} ${activeUser.lastName}` },
        changes,
      });
    }

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
