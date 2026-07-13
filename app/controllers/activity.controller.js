const db = require("../models");
const Activity = db.activity;
const Op = db.Sequelize.Op;

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
