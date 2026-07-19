const db = require("../models");
const StoryType = db.storyType;
const Story = db.story;
const Op = db.Sequelize.Op;
const Sequelize = db.Sequelize;

const { httpError } = require("../utils/httpUtils");

exports.findAll = async (req, res) => {
  try {
    const data = await StoryType.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.findAllForProject = async (req, res) => {
  const { projectId } = req.params;
  try {
    const data = await StoryType.findAll({
      where: { projectId },
      include: {
        model: Story,
        as: "story",
      },
    });

    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.create = async (req, res) => {
  const { projectId } = req.params;

  try {
    if (!req.body.name) {
      throw httpError("Missing required fields.", 400);
    }

    const potentialDuplicate = await StoryType.findOne({
      where: { name: req.body.name, projectId },
    });

    if (potentialDuplicate) {
      throw httpError("A story type with this name already exists.", 400);
    }

    const type = await StoryType.create({
      name: req.body.name,
      projectId,
    });

    res.send(type);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating story type.",
    });
  }
};

exports.update = async (req, res) => {
  const { projectId, typeId } = req.params;

  try {
    if (!req.body.name) {
      throw httpError("Missing required fields.", 400);
    }

    const type = await StoryType.findOne({
      where: { id: typeId, projectId },
    });

    if (!type) {
      throw httpError(`Cannot find StoryType with id = ${typeId}.`, 404);
    }

    const potentialDuplicate = await StoryType.findOne({
      where: { name: req.body.name, projectId, id: { [Op.ne]: typeId } },
    });

    if (potentialDuplicate) {
      throw httpError("A story type with this name already exists.", 400);
    }

    await type.update({ name: req.body.name });

    res.send(type);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating story type.",
    });
  }
};

exports.delete = async (req, res) => {
  const { projectId, typeId } = req.params;

  try {
    const type = await StoryType.findOne({
      where: { id: typeId, projectId },
    });

    if (!type) {
      throw httpError(`Cannot find StoryType with id = ${typeId}.`, 404);
    }

    await type.destroy();

    res.send({ message: "Story type deleted successfully!" });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting story type.",
    });
  }
};
