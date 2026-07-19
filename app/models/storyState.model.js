module.exports = (sequelize, Sequelize) => {
  const StoryState = sequelize.define("storyState", {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    order: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
  });

  return StoryState;
};
