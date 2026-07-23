const db = require("../models");
const Comment = db.comment;
const Story = db.story;
const User = db.user;
const AcceptanceCriteria = db.acceptanceCriteria;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");
const {
  notifyMentionedUser,
  commentToPlainText,
  storyUrl,
} = require("../utils/email");

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

// helper to check for mentions in a comment
async function getMentionedUsers(commentText) {
  const regex = /data-id="([^"]+)"/g; // match the data-id="123" part
  const ids = [...commentText.matchAll(regex)].map((match) => match[1]); // get just the ids
  const numberIds = ids.map(Number); // convert to numbers
  const uniqueIds = [...new Set(numberIds)]; // remove duplicates

  // find the users with these ids
  const users = await User.findAll({
    where: { id: uniqueIds },
  });

  return users;
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
    const user = await User.findByPk(userId);
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

    try {
      const mentionedUsers = (await getMentionedUsers(data.content)).filter(
        (u) => u.id !== userId,
      );
      await Promise.all(
        mentionedUsers.map(
          async (mentionedUser) =>
            await notifyMentionedUser(mentionedUser, user, data, [
              { label: "Story", value: story.title, url: storyUrl(story) },
            ]),
        ),
      );
    } catch (emailError) {
      console.error("Failed to send comment notification email:", emailError);
    }

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
    const user = await User.findByPk(userId);
    const criterion = await findCriterionOrFail(criterionId);
    const parentStory = await criterion.getStory();
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

    try {
      const mentionedUsers = (await getMentionedUsers(data.content)).filter(
        (u) => u.id !== userId,
      );
      await Promise.all(
        mentionedUsers.map(
          async (mentionedUser) =>
            await notifyMentionedUser(mentionedUser, user, data, [
              {
                label: "Story",
                value: parentStory.title,
                url: storyUrl(parentStory),
              },
              {
                label: "Acceptance Criteria",
                value: criterion.title,
                url: storyUrl(parentStory, { acId: criterion.id }),
              },
            ]),
        ),
      );
    } catch (emailError) {
      console.error("Failed to send comment notification email:", emailError);
    }

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
