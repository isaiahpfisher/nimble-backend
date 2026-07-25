const db = require("../models");
const AcceptanceCriteria = db.acceptanceCriteria;
const Story = db.story;
const User = db.user;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");
const { recordActivity, ACTIVITY_ACTION, SUBJECT_TYPE } = require("../utils/activity");

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
    const { userId } = await authenticate(req, res);
    await findStoryOrFail(req.params.storyId, req.params.projectId);
    const user = await User.findByPk(userId);
    validate(req.body);

    const criterion = await AcceptanceCriteria.create({
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      storyId: req.params.storyId,
    });

    await recordActivity({
      storyId: req.params.storyId,
      subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
      subjectId: criterion.id,
      userId: userId,
      action: ACTIVITY_ACTION.CREATED,
      metadata: { title: criterion.title, status: req.body.status, user: `${user.firstName} ${user.lastName}` },
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
    const { userId } = await authenticate(req, res);
    const user = await User.findByPk(userId);
    await findStoryOrFail(req.params.storyId, req.params.projectId);
    validate(req.body);

    const criterion = await AcceptanceCriteria.findOne({
      where: { id: req.params.criterionId, storyId: req.params.storyId },
    });

    if (!criterion) {
      throw httpError(`Cannot find Acceptance Criteria with id = ${req.params.criterionId}.`, 404);
    }

    // save previous values for comparison
    const before = {
      title: criterion.title,
      description: criterion.description,
      status: criterion.status,
    };

    await criterion.update({
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
    });

    // perform diff
    const changes = ["title", "description", "status"]
      .filter((f) => before[f] !== criterion[f]) // activity history only cares about changed fields
      .map((f) => ({ attribute: f, oldValue: before[f], newValue: criterion[f] }));

    if (changes.length) {
      await recordActivity({
        storyId: req.params.storyId,
        subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
        subjectId: criterion.id,
        userId,
        action: ACTIVITY_ACTION.UPDATED,
        metadata: { user: `${user.firstName} ${user.lastName}`, title: criterion.title, status: criterion.status },
        changes,
      });
    }

    res.send(criterion);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating acceptance criteria.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await findStoryOrFail(req.params.storyId, req.params.projectId);
    const user = await User.findByPk(userId);

    const acceptanceCriteria = await AcceptanceCriteria.findOne({
      where: { id: req.params.criterionId, storyId: req.params.storyId },
    });

    if (!acceptanceCriteria) {
      throw httpError(`Cannot find Acceptance Criteria with id = ${req.params.criterionId}.`, 404);
    }

    await recordActivity({
      storyId: req.params.storyId,
      subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
      subjectId: acceptanceCriteria.id,
      action: ACTIVITY_ACTION.DELETED,
      metadata: {
        title: acceptanceCriteria.title,
        status: acceptanceCriteria.status,
        user: `${user.firstName} ${user.lastName}`,
      },
      userId: userId,
    });

    await acceptanceCriteria.destroy();

    res.send({ message: "Acceptance criteria deleted successfully." });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting acceptance criteria.",
    });
  }
};
