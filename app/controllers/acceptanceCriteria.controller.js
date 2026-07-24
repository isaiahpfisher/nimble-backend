const db = require("../models");
const AcceptanceCriteria = db.acceptanceCriteria;
const Story = db.story;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");

// helper functions for validation
async function findStoryOrFail(id, projectId) {
  const story = await Story.findOne({
    where: { id, projectId },
  });
  if (!story) {
    throw httpError(`Cannot find Story with id = ${id}.`, 404);
  }
  return story;
}

function validate(body) {
  if (!body.title) {
    throw httpError("Acceptance criteria must have a title.", 400);
  }
  if (!body.status) {
    throw httpError("Acceptance criteria must have a status.", 400);
  }
}

// controller actions
exports.findAll = async (req, res) => {
  try {
    const data = await AcceptanceCriteria.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.create = async (req, res) => {
  try {
    await authenticate(req, res);
    await findStoryOrFail(req.params.storyId, req.params.projectId);
    validate(req.body);

    const criterion = await AcceptanceCriteria.create({
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      storyId: req.params.storyId,
    });

    res.send(criterion);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating acceptance criteria.",
    });
  }
};

exports.update = async (req, res) => {
  try {
    await authenticate(req, res);
    await findStoryOrFail(req.params.storyId, req.params.projectId);
    validate(req.body);

    const criterion = await AcceptanceCriteria.findOne({
      where: { id: req.params.criterionId, storyId: req.params.storyId },
    });

    if (!criterion) {
      throw httpError(
        `Cannot find Acceptance Criteria with id = ${req.params.criterionId}.`,
        404,
      );
    }

    await criterion.update({
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
    });

    res.send(criterion);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating acceptance criteria.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    await authenticate(req, res);
    await findStoryOrFail(req.params.storyId, req.params.projectId);

    const acceptanceCriteria = await AcceptanceCriteria.findOne({
      where: { id: req.params.criterionId, storyId: req.params.storyId },
    });

    if (!acceptanceCriteria) {
      throw httpError(
        `Cannot find Acceptance Criteria with id = ${req.params.criterionId}.`,
        404,
      );
    }

    await acceptanceCriteria.destroy();

    res.send({ message: "Acceptance criteria deleted successfully." });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting acceptance criteria.",
    });
  }
};
