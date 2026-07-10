module.exports = (sequelize, Sequelize) => {
  const Project = sequelize.define("project", {
    title: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    description: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    deadline: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });

  return Project;
};
