module.exports = (sequelize, Sequelize) => {
  const Activity = sequelize.define("activity", {
    subjectType: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    subjectId: {
      // polymorphic, so can't define as FK
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    action: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    metadata: {
      // this is so we always have somethig to render, even if the related object has been deleted
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: {},
    },
  });

  return Activity;
};
