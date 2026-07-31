const db = require("../models");
const Retrospective = db.retrospective;
const Op = db.Sequelize.Op;
const { requireAdmin } = require("../authentication/authorization");

exports.findAll = async (req, res) => {
  try {
    await requireAdmin(req.userId);

    const data = await Retrospective.findAll();
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
