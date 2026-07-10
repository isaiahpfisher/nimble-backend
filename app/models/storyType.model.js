module.exports = (sequelize, Sequelize) => {
  const StoryType = sequelize.define("storyType", {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
  });

  return StoryType;
};
