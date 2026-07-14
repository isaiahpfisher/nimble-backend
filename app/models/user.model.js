const { saltSize, keySize } = require("../authentication/crypto");

module.exports = (sequelize, Sequelize) => {
  const User = sequelize.define("user", {
    firstName: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    lastName: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    email: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    isAdmin: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    password: {
      type: Sequelize.BLOB,
      allowNull: true, // GitHub-authenticated users won't have a local password
    },
    salt: {
      type: Sequelize.BLOB,
      allowNull: true, // GitHub-authenticated users won't have a local password
    },
    githubId: {
      type: Sequelize.STRING,
      allowNull: true, // null for users who signed up via password, set for GitHub users
      unique: true,
    },
    avatarUrl: {
      type: Sequelize.STRING,
      allowNull: true,
    },
  });

  return User;
};