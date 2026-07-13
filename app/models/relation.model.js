module.exports = (sequelize, Sequelize) => {
  const Relation = sequelize.define("relation", {
    type: {
      type: Sequelize.STRING,
      allowNull: false,
    },
  });

  return Relation;
};
