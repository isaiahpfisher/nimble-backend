const db = require("../models");
const StoryState = db.storyState;
const Story = db.story;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");
const { requireAdmin, requireProjectMember } = require("../authentication/authorization");

exports.findAll = async (req, res) => {
  try {
    await requireAdmin(req.userId);

    const data = await StoryState.findAll({ order: [["order", "ASC"]] });
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.findAllForProject = async (req, res) => {
  const { projectId } = req.params;
  try {
    await requireProjectMember(req.userId, projectId);

    const data = await StoryState.findAll({
      where: { projectId },
      order: [["order", "ASC"]],
    });

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.create = async (req, res) => {
  const { projectId } = req.params;

  try {
    await requireProjectMember(req.userId, projectId);

    if (!req.body.name || !req.body.order) {
      throw httpError("Missing required fields.", 400);
    }

    const potentialDuplicate = await StoryState.findOne({
      where: { name: req.body.name, projectId },
    });

    if (potentialDuplicate) {
      throw httpError("A story state with this name already exists.", 400);
    }

    const state = await StoryState.create({
      name: req.body.name,
      order: req.body.order,
      projectId,
    });

    res.send(state);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating story state.",
    });
  }
};

exports.update = async (req, res) => {
  const { projectId, stateId } = req.params;

  try {
    await requireProjectMember(req.userId, projectId);

    if (!req.body.name) {
      throw httpError("Missing required fields.", 400);
    }

    const state = await StoryState.findOne({
      where: { id: stateId, projectId },
    });

    if (!state) {
      throw httpError(`Cannot find StoryState with id = ${stateId}.`, 404);
    }

    const potentialDuplicate = await StoryState.findOne({
      where: { name: req.body.name, projectId, id: { [Op.ne]: stateId } },
    });

    if (potentialDuplicate) {
      throw httpError("A story state with this name already exists.", 400);
    }

    await state.update({ name: req.body.name });

    res.send(state);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating story state.",
    });
  }
};

exports.reorder = async (req, res) => {
  const { projectId } = req.params;
  const states = req.body.states;

  try {
    await requireProjectMember(req.userId, projectId);

    if (!states || states.length < 1) {
      throw httpError("Missing required fields.", 400);
    }

    // make sure all the states belong to this project
    const owned = await StoryState.findAll({
      where: { id: states.map((s) => s.id), projectId },
      attributes: ["id"],
    });

    if (owned.length != states.length) {
      throw httpError("At least one state does not belong to this project.", 400);
    }

    await StoryState.bulkCreate(
      states.map((s) => ({ ...s, projectId })),
      {
        updateOnDuplicate: ["name", "order"],
      },
    );

    res.status(200).send({
      message: "Successfully reordered states.",
    });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Failed to reorder states.",
    });
  }
};

exports.delete = async (req, res) => {
  const { projectId, stateId } = req.params;
  const fallbackStateId = req.body.fallbackStateId;

  try {
    await requireProjectMember(req.userId, projectId);

    if (!fallbackStateId) {
      throw httpError("Missing required fields.", 400);
    }

    const state = await StoryState.findOne({
      where: { id: stateId, projectId },
    });

    if (!state) {
      throw httpError(`Cannot find StoryState with id = ${stateId}.`, 404);
    }

    // make sure the fallback state belongs to this project
    const fallback = await StoryState.findOne({
      where: { id: fallbackStateId, projectId },
    });

    if (!fallback) {
      throw httpError(`Cannot find StoryState with id = ${fallbackStateId}.`, 404);
    }

    await Story.update({ stateId: fallbackStateId }, { where: { stateId } });

    await state.destroy();

    res.send({ message: "Story state deleted successfully!" });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting story state.",
    });
  }
};
