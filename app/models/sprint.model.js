module.exports = (sequelize, Sequelize) => {
  const Sprint = sequelize.define("sprint", {
    title: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    goal: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    startDate: {
      type: Sequelize.DATEONLY,
      allowNull: false,
    },
    endDate: {
      type: Sequelize.DATEONLY,
      allowNull: false,
    },
    status: {
      type: Sequelize.ENUM("Planned", "Active", "Completed"),
      allowNull: false,
      defaultValue: "Planned",
    },
    isRecurring: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    recurrencePattern: {
      type: Sequelize.ENUM("Weekly", "Biweekly", "Monthly"),
      allowNull: true,
    },
    recurrenceGroupId: {
      type: Sequelize.STRING,
      allowNull: true,
    },
  });
  return Sprint;
};