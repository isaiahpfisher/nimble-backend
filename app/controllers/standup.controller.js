const db = require("../models");
const Standup = db.standup;
const Op = db.Sequelize.Op;
const { requireAdmin } = require("../authentication/authorization");

exports.findAll = async (req, res) => {
  try {
    await requireAdmin(req.userId);

    const data = await Standup.findAll();
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
