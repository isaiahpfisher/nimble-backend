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
      allowNull: false,
    },
    estimate: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
  });

  return Story;
};
