module.exports = (sequelize, Sequelize) => {
  const Repository = sequelize.define("repository", {
    githubId: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
  });

  return Repository;
};
