const db = require("../models");
const Sprint = db.sprint;
const Op = db.Sequelize.Op;

exports.findAll = async (req, res) => {
  try {
    const data = await Sprint.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
