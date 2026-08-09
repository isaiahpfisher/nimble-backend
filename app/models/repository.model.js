const { saltSize, keySize } = require("../authentication/crypto");

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
    owner: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    githubToken: {
      type: Sequelize.STRING,
      allowNull: true, 
    },
  });

  return Repository;
};
