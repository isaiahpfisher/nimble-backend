const db = require("../models");

const SystemLog = db.systemLog;
const User = db.user;


exports.findAll = async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);

    if (!user) {
      return res.status(404).send({
        message: "User not found",
      });
    }
    console.log("ADMIN VALUE:", user.isAdmin, typeof user.isAdmin);

    if (!user.isAdmin) {
      return res.status(403).send({
        message: "Admin access required",
      });
    }

    const logs = await SystemLog.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.user,
          as: "user",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
          ],
        },
      ],
    });

    res.send(logs);

  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving system logs",
    });
  }
};