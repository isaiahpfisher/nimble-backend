const db = require("../models");
const Standup = db.standup;
const Op = db.Sequelize.Op;

exports.findAll = async (req, res) => {
  try {
    const data = await Standup.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
