const db = require("../models");
const Comment = db.comment;
const Story = db.story;
const AcceptanceCriteria = db.acceptanceCriteria;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");

// helper functions for validation
async function findStoryOrFail(id) {
  const story = await Story.findOne({
    where: { id },
  });
  if (!story) {
    throw httpError(`Cannot find Story with id = ${id}.`, 404);
  }
  return story;
}

async function findCriterionOrFail(id) {
  const story = await AcceptanceCriteria.findOne({
    where: { id },
  });
  if (!story) {
    throw httpError(`Cannot find Acceptance Criteria with id = ${id}.`, 404);
  }
  return story;
}

function validate(body) {
  if (!body.content) {
    throw httpError("Comment must have content.", 400);
  }
}

exports.findAll = async (req, res) => {
  try {
    const data = await Comment.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.findAllForStory = async (req, res) => {
  const storyId = req.params.storyId;

  try {
    const story = await findStoryOrFail(storyId);
    const data = await story.getComment({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.createForStory = async (req, res) => {
  const storyId = req.params.storyId;
  const { userId } = await authenticate(req, res);

  try {
    const story = await findStoryOrFail(storyId);
    validate(req.body);

    const data = await story.createComment({
      content: req.body.content,
      userId: userId,
    });

    await data.reload({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating comment.",
    });
  }
};

exports.findAllForCriterion = async (req, res) => {
  const criterionId = req.params.criterionId;

  try {
    const criterion = await findCriterionOrFail(criterionId);
    const data = await criterion.getComment({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.createForCriterion = async (req, res) => {
  const criterionId = req.params.criterionId;
  const { userId } = await authenticate(req, res);

  try {
    const criterion = await findCriterionOrFail(criterionId);
    validate(req.body);

    const data = await criterion.createComment({
      content: req.body.content,
      userId: userId,
    });

    await data.reload({
      include: {
        model: db.user,
        as: "user",
        attributes: ["id", "email", "firstName", "lastName"],
      },
    });

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating comment.",
    });
  }
};

exports.update = async (req, res) => {
  const id = req.params.id;
  const { userId } = await authenticate(req, res);

  try {
    const comment = await Comment.findByPk(id);

    if (!comment) {
      throw httpError(`Cannot find Comment with id = ${id}.`, 400);
    }

    if (comment.userId !== userId) {
      throw httpError(
        "You do not have permission to update this comment.",
        400,
      );
    }

    await comment.update({
      content: req.body.content,
    });

    res.send(comment);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating comment.",
    });
  }
};

exports.delete = async (req, res) => {
  const id = req.params.id;
  const { userId } = await authenticate(req, res);

  try {
    const comment = await Comment.findByPk(id);

    if (!comment) {
      throw httpError(`Cannot find Comment with id = ${id}.`, 400);
    }

    if (comment.userId !== userId) {
      throw httpError(
        "You do not have permission to delete this comment.",
        400,
      );
    }

    await comment.destroy();

    res.send({ message: "Comment deleted successfully." });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting comment.",
    });
  }
};
