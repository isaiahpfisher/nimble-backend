const db = require("../models");
const Retrospective = db.retrospective;
const Op = db.Sequelize.Op;

exports.findAll = async (req, res) => {
  try {
    const data = await Retrospective.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
