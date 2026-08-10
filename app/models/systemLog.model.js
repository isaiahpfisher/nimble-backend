function parseJsonValue(raw) {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = (sequelize, Sequelize) => {
  const SystemLog = sequelize.define("systemlog", {
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
      get() {
        return parseJsonValue(this.getDataValue("metadata"));
      },
    },
  });

  return SystemLog;
};
