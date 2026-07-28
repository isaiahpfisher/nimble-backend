function parseJsonValue(raw) {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = (sequelize, Sequelize) => {
  const ActivityChange = sequelize.define("activityChange", {
    attribute: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    operation: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    oldValue: {
      type: Sequelize.JSON,
      allowNull: true,
      get() {
        return parseJsonValue(this.getDataValue("oldValue"));
      },
    },
    newValue: {
      type: Sequelize.JSON,
      allowNull: true,
      get() {
        return parseJsonValue(this.getDataValue("newValue"));
      },
    },
  });

  return ActivityChange;
};
