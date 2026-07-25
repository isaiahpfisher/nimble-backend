module.exports = (sequelize, Sequelize) => {
  const Story = sequelize.define("story", {
    title: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    description: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    priority: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    estimate: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },
    completedAt: {
      type: Sequelize.DATE,
      allowNull: true,
    },
  });

  return Story;
};
