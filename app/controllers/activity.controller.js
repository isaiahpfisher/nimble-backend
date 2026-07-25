const db = require("../models");
const Activity = db.activity;
const Story = db.story;
const User = db.user;
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

exports.findAll = async (req, res) => {
  try {
    const data = await Activity.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};

exports.findAllForStory = async (req, res) => {
  const { projectId, storyId } = req.params;

  try {
    const story = await findStoryOrFail(storyId, req.params.projectId);

    const data = await Activity.findAll({
      where: { storyId },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.user,
          as: "user",
          attributes: ["id", "email", "firstName", "lastName"],
        },
        {
          model: db.story,
          as: "story",
          attributes: ["id", "title"],
        },
        {
          model: db.activityChange,
          as: "change",
        },
      ],
    });

    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
