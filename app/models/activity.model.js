module.exports = (sequelize, Sequelize) => {
  const Activity = sequelize.define("activity", {
    action: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    changes: {
      type: Sequelize.JSON,
      allowNull: false,
    },
  });

  return Activity;
};
