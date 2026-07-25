module.exports = (sequelize, Sequelize) => {
  const ActivityChange = sequelize.define("activityChange", {
    attribute: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    operation: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    oldValue: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    newValue: {
      type: Sequelize.JSON,
      allowNull: true,
    },
  });

  return ActivityChange;
};
