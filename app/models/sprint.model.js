module.exports = (sequelize, Sequelize) => {
  const Sprint = sequelize.define("sprint", {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    start: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    end: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });

  return Sprint;
};
