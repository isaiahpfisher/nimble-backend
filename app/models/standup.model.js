module.exports = (sequelize, Sequelize) => {
  const Standup = sequelize.define("standup", {
    agenda: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    notes: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    date: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });

  return Standup;
};
