const db = require("../models");
const Relation = db.relation;
const Story = db.story;
const User = db.user;
const Op = db.Sequelize.Op;
const { httpError } = require("../utils/httpUtils");
const { recordActivity, ACTIVITY_ACTION, SUBJECT_TYPE, RELATION_DIRECTION } = require("../utils/activity");

const RELATION_TYPES = ["BLOCKS", "RELATES_TO", "DUPLICATES", "PARENT_OF"];

exports.findAll = async (req, res) => {
  try {
    const data = await Relation.findAll();
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
    const user = await User.findByPk(userId);

    const { projectId, storyId } = req.params;
    const { type, storyOneId, storyTwoId } = req.body;

    if (!RELATION_TYPES.includes(type)) {
      throw httpError(`Invalid relation type "${type}".`, 400);
    }

    if (storyOneId === storyTwoId) {
      throw httpError("A story cannot be related to itself.", 400);
    }

    // make sure at least one of the two sides of the relation is the story in the URL
    if (Number(storyId) !== storyOneId && Number(storyId) !== storyTwoId) {
      throw httpError("The relation must involve this story.", 400);
    }

    // make sure both stories belong to this project
    const stories = await Story.findAll({
      where: {
        id: { [Op.in]: [storyOneId, storyTwoId] },
        projectId: projectId,
      },
    });

    if (stories.length !== 2) {
      throw httpError("Both stories must exist in this project.", 400);
    }

    // make sure this isn't a duplicate relation (even if type is different)
    const existing = await Relation.findOne({
      where: {
        [Op.or]: [
          { storyOneId: storyOneId, storyTwoId: storyTwoId },
          { storyOneId: storyTwoId, storyTwoId: storyOneId },
        ],
      },
    });

    if (existing) {
      throw httpError("These stories are already related.", 400);
    }

    const relation = await Relation.create({
      type: type,
      storyOneId: storyOneId,
      storyTwoId: storyTwoId,
    });

    const [storyOne, storyTwo] = await Promise.all([Story.findByPk(storyOneId), Story.findByPk(storyTwoId)]);

    await recordActivity({
      storyId: storyOne.id,
      subjectType: SUBJECT_TYPE.RELATION,
      subjectId: relation.id,
      userId: userId,
      action: ACTIVITY_ACTION.CREATED,
      metadata: {
        type: type,
        self: { id: storyOne.id, title: storyOne.title },
        other: { id: storyTwo.id, title: storyTwo.title },
        user: `${user.firstName} ${user.lastName}`,
        direction: RELATION_DIRECTION.OUTGOING,
      },
    });

    await recordActivity({
      storyId: storyTwo.id,
      subjectType: SUBJECT_TYPE.RELATION,
      subjectId: relation.id,
      userId: userId,
      action: ACTIVITY_ACTION.CREATED,
      metadata: {
        type: type,
        self: { id: storyTwo.id, title: storyTwo.title },
        other: { id: storyOne.id, title: storyOne.title },
        user: `${user.firstName} ${user.lastName}`,
        direction: RELATION_DIRECTION.INCOMING,
      },
    });

    res.send(relation);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating relation.",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    const user = await User.findByPk(userId);

    const { storyId, relationId } = req.params;

    const relation = await Relation.findOne({
      where: { id: relationId, storyOneId: storyId },
    });

    if (!relation) {
      throw httpError(`Cannot find Relation with id = ${relationId}.`, 404);
    }

    const [storyOne, storyTwo] = await Promise.all([
      Story.findByPk(relation.storyOneId),
      Story.findByPk(relation.storyTwoId),
    ]);

    await recordActivity({
      storyId: storyOne.id,
      subjectType: SUBJECT_TYPE.RELATION,
      subjectId: relation.id,
      userId: userId,
      action: ACTIVITY_ACTION.DELETED,
      metadata: {
        type: relation.type,
        self: { id: storyOne.id, title: storyOne.title },
        other: { id: storyTwo.id, title: storyTwo.title },
        user: `${user.firstName} ${user.lastName}`,
        direction: RELATION_DIRECTION.OUTGOING,
      },
    });

    await recordActivity({
      storyId: storyTwo.id,
      subjectType: SUBJECT_TYPE.RELATION,
      subjectId: relation.id,
      userId: userId,
      action: ACTIVITY_ACTION.DELETED,
      metadata: {
        type: relation.type,
        self: { id: storyTwo.id, title: storyTwo.title },
        other: { id: storyOne.id, title: storyOne.title },
        user: `${user.firstName} ${user.lastName}`,
        direction: RELATION_DIRECTION.INCOMING,
      },
    });

    await relation.destroy();

    res.send({ message: "Relation deleted successfully." });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error deleting relation.",
    });
  }
};
