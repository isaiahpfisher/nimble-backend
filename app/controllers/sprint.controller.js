const db = require("../models");
const Sprint = db.sprint;
const { authenticate } = require("../authentication/authentication");
const { requireAdmin, requireProjectMember } = require("../authentication/authorization");
const { httpError } = require("../utils/httpUtils");

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function intervalDays(pattern) {
  if (pattern === "Weekly") return 7;
  if (pattern === "Biweekly") return 14;
  if (pattern === "Monthly") return 30;

  throw httpError(`Unknown recurrence pattern: ${pattern}`, 400);
}

exports.findAll = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await requireAdmin(userId);

    const data = await Sprint.findAll();
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

    if (
      req.body.title === undefined ||
      req.body.startDate === undefined ||
      req.body.endDate === undefined ||
      req.body.projectId === undefined
    ) {
      throw httpError("Missing required fields.", 400);
    }

    await requireProjectMember(userId, req.body.projectId);

    const sprint = {
      title: req.body.title,
      goal: req.body.goal,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      status: req.body.status || "Planned",
      isRecurring: false,
      projectId: req.body.projectId,
    };

    const data = await Sprint.create(sprint);

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating Sprint.",
    });
  }
};

exports.createRecurring = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    if (
      req.body.title === undefined ||
      req.body.startDate === undefined ||
      req.body.endDate === undefined ||
      req.body.projectId === undefined ||
      req.body.recurrencePattern === undefined ||
      req.body.recurrenceCount === undefined
    ) {
      throw httpError("Missing required fields.", 400);
    }

    if (req.body.recurrenceCount < 2) {
      throw httpError("Recurrence Count must be at least 2!", 400);
    }

    await requireProjectMember(userId, req.body.projectId);

    const step = intervalDays(req.body.recurrencePattern);

    const start = new Date(req.body.startDate);
    const end = new Date(req.body.endDate);

    const sprintLength = end - start;
    const groupId = crypto.randomUUID();

    const sprints = [];

    for (let i = 0; i < req.body.recurrenceCount; i++) {
      const sprintStart = addDays(start, step * i);
      const sprintEnd = new Date(sprintStart.getTime() + sprintLength);

      sprints.push({
        title: `${req.body.title} ${i + 1}`,
        goal: req.body.goal,
        startDate: sprintStart,
        endDate: sprintEnd,
        status: "Planned",
        isRecurring: true,
        recurrencePattern: req.body.recurrencePattern,
        recurrenceGroupId: groupId,
        projectId: req.body.projectId,
      });
    }

    const data = await Sprint.bulkCreate(sprints);

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating recurring Sprints.",
    });
  }
};

exports.findAllForProject = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await requireProjectMember(userId, req.params.projectId);

    const data = await Sprint.findAll({
      where: {
        projectId: req.params.projectId,
      },
      order: [["startDate", "ASC"]],
    });

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error retrieving Sprints for project.",
    });
  }
};

exports.findOne = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const id = req.params.id;

    const data = await Sprint.findByPk(id, {
      include: [
        {
          model: db.project,
          as: "project",
        },
        {
          model: db.story,
          as: "story",
        },
      ],
    });

    if (data) {
      await requireProjectMember(userId, data.projectId);
      res.send(data);
    } else {
      throw httpError(`Cannot find Sprint with id = ${id}.`, 404);
    }
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error retrieving Sprint.",
    });
  }
};

exports.update = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const sprint = await Sprint.findByPk(req.params.id);

    if (!sprint) {
      throw httpError(`Cannot find Sprint with id = ${req.params.id}.`, 404);
    }

    await requireProjectMember(userId, sprint.projectId);

    // don't allow updating the project id, so extract that out of the update body
    const { projectId, ...updates } = req.body;
    await sprint.update(updates);

    res.send(sprint);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating Sprint.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const sprint = await Sprint.findByPk(req.params.id);

    if (!sprint) {
      throw httpError(`Cannot find Sprint with id = ${req.params.id}.`, 404);
    }

    await requireProjectMember(userId, sprint.projectId);

    await sprint.destroy();

    res.send({
      message: "Sprint deleted successfully!",
    });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting Sprint.",
    });
  }
};
