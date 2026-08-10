const db = require("../models");
const Story = db.story;
const Sprint = db.sprint;
const SystemLog = db.systemLog;
const { httpError } = require("../utils/httpUtils");
exports.findAllForProject = async (req, res) => {
  const projectId = req.params.id;
  try {
    const stories = await Story.findAll({
      where: { projectId: projectId, sprintId: null },
      include: [
        {
         model: db.storyState, as: "state",
        },
        { model: db.storyType, as: "type" },
        {
          model: db.user,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
    });

    res.send(stories);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.assignSprint = async (req, res) => {
  const projectId = req.params.id;
  const storyId = req.params.storyId;

  try {
    if (!req.body.sprintId) {
      throw httpError("Missing required fields.", 400);
    }

    const story = await Story.findByPk(storyId);

    if (!story || story.projectId != projectId) {
      throw httpError(`Cannot find Story with id = ${storyId}.`, 404);
    }

    const sprint = await Sprint.findByPk(req.body.sprintId);

    if (!sprint || sprint.projectId != projectId) {
      throw httpError(
        `Cannot find Sprint with id = ${req.body.sprintId}.`,
        404,
      );
    }

    await story.update({ sprintId: sprint.id });
    await SystemLog.create({
      subjectType: "BACKLOG",
      subjectId: story.id,
      action: "ASSIGN_STORY_TO_SPRINT",
      metadata: {
        message: "Story assigned to sprint",
        storyTitle: story.title,
        sprintTitle: sprint.title,
        projectId: story.projectId,
      },
      userId: req.userId,
    });

    res.send({ message: "Story assigned to sprint successfully!" });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error assigning Story to Sprint.",
    });
  }
};