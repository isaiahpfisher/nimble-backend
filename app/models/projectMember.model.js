module.exports = (sequelize, Sequelize) => {
  const ProjectMember = sequelize.define("projectMember", {
    isManager: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: false,
    },
  });

  return ProjectMember;
};
