module.exports = (sequelize, Sequelize) => {
  const Retrospective = sequelize.define(
    "retrospective",
    {
      title: {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: "Sprint Retrospective",
      },

      summary: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: "",
      },

      sprintId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      createdById: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "retrospectives",
    }
  );

  return Retrospective;
};
