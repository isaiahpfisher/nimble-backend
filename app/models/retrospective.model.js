module.exports = (sequelize, Sequelize) => {
  const Retrospective = sequelize.define("retrospective", {
    agenda: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    summary: {
      type: Sequelize.STRING,
      allowNull: false,
    },
  });

  return Retrospective;
};
