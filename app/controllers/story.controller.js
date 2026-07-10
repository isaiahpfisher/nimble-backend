const db = require("../models");
const Story = db.story;
const Op = db.Sequelize.Op;

exports.findAll = async (req, res) => {
  try {
    const data = await Story.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
