const dbConfig = require("../config/db.config.js");
const Sequelize = require("sequelize");
const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
  host: dbConfig.HOST,
  port: dbConfig.PORT,
  dialect: dbConfig.dialect,
  logging: false,
  dialectOptions: dbConfig.ssl
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  pool: {
    max: dbConfig.pool.max,
    min: dbConfig.pool.min,
    acquire: dbConfig.pool.acquire,
    idle: dbConfig.pool.idle,
  },
});
const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.user = require("./user.model.js")(sequelize, Sequelize);
db.session = require("./session.model.js")(sequelize, Sequelize);
db.activity = require("./activity.model.js")(sequelize, Sequelize);
db.project = require("./project.model.js")(sequelize, Sequelize);
db.projectMember = require("./projectMember.model.js")(sequelize, Sequelize);
db.repository = require("./repository.model.js")(sequelize, Sequelize);
db.storyState = require("./storyState.model.js")(sequelize, Sequelize);
db.storyType = require("./storyType.model.js")(sequelize, Sequelize);
db.sprint = require("./sprint.model.js")(sequelize, Sequelize);
db.retrospective = require("./retrospective.model.js")(sequelize, Sequelize);
db.standup = require("./standup.model.js")(sequelize, Sequelize);
db.story = require("./story.model.js")(sequelize, Sequelize);
db.relation = require("./relation.model.js")(sequelize, Sequelize);
db.acceptanceCriteria = require("./acceptanceCriteria.model.js")(
  sequelize,
  Sequelize,
);
db.comment = require("./comment.model.js")(sequelize, Sequelize);

// session
db.user.hasMany(db.session, {
  as: "session",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.session.belongsTo(db.user, {
  as: "user",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// projectMember <-> user
db.user.hasMany(db.projectMember, {
  as: "projectMember",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.projectMember.belongsTo(db.user, {
  as: "user",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// projectMember <-> project
db.project.hasMany(db.projectMember, {
  as: "projectMembers",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.projectMember.belongsTo(db.project, {
  as: "project",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// project <-> repository
db.project.hasMany(db.repository, {
  as: "repository",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.repository.belongsTo(db.project, {
  as: "project",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// project <-> storyState
db.project.hasMany(db.storyState, {
  as: "storyState",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.storyState.belongsTo(db.project, {
  as: "project",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// project <-> storyType
db.project.hasMany(db.storyType, {
  as: "storyType",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.storyType.belongsTo(db.project, {
  as: "project",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// project <-> sprint
db.project.hasMany(db.sprint, {
  as: "sprint",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.sprint.belongsTo(db.project, {
  as: "project",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// sprint <-> retrospective
db.sprint.hasOne(db.retrospective, {
  as: "retrospective",
  foreignKey: { name: "sprintId", allowNull: false },
  onDelete: "CASCADE",
});
db.retrospective.belongsTo(db.sprint, {
  as: "sprint",
  foreignKey: { name: "sprintId", allowNull: false },
  onDelete: "CASCADE",
});

// sprint <-> standup
db.sprint.hasMany(db.standup, {
  as: "standup",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.standup.belongsTo(db.sprint, {
  as: "sprint",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// project <-> story
db.project.hasMany(db.story, {
  as: "story",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.story.belongsTo(db.project, {
  as: "project",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// story <-> user
db.repository.hasMany(db.story, {
  as: "story",
  foreignKey: { name: "repositoryId", allowNull: true },
  onDelete: "SET NULL",
});
db.story.belongsTo(db.repository, {
  as: "repository",
  foreignKey: { name: "repositoryId", allowNull: true },
  onDelete: "SET NULL",
});

// story <-> sprint
db.sprint.hasMany(db.story, {
  as: "story",
  foreignKey: { name: "sprintId", allowNull: true },
  onDelete: "CASCADE",
});
db.story.belongsTo(db.sprint, {
  as: "sprint",
  foreignKey: { name: "sprintId", allowNull: true },
  onDelete: "CASCADE",
});

// story <-> storyState
db.storyState.hasMany(db.story, {
  as: "story",
  foreignKey: { name: "stateId", allowNull: false },
  onDelete: "CASCADE",
});
db.story.belongsTo(db.storyState, {
  as: "state",
  foreignKey: { name: "stateId", allowNull: false },
  onDelete: "CASCADE",
});

// story <-> storyType
db.storyType.hasMany(db.story, {
  as: "story",
  foreignKey: { name: "typeId", allowNull: true },
  onDelete: "SET NULL",
});
db.story.belongsTo(db.storyType, {
  as: "type",
  foreignKey: { name: "typeId", allowNull: true },
  onDelete: "SET NULL",
});

// story <-> user (reporter, assignee, reviewer)
db.user.hasMany(db.story, {
  as: "reportedStory",
  foreignKey: { name: "reporterId", allowNull: true },
  onDelete: "SET NULL",
});
db.story.belongsTo(db.user, {
  as: "reporter",
  foreignKey: { name: "reporterId", allowNull: true },
  onDelete: "SET NULL",
});
db.user.hasMany(db.story, {
  as: "assignedStory",
  foreignKey: { name: "assigneeId", allowNull: true },
  onDelete: "SET NULL",
});
db.story.belongsTo(db.user, {
  as: "assignee",
  foreignKey: { name: "assigneeId", allowNull: true },
  onDelete: "SET NULL",
});
db.user.hasMany(db.story, {
  as: "reviewedStory",
  foreignKey: { name: "reviewerId", allowNull: true },
  onDelete: "SET NULL",
});
db.story.belongsTo(db.user, {
  as: "reviewer",
  foreignKey: { name: "reviewerId", allowNull: true },
  onDelete: "SET NULL",
});

// story <-> relation (story one, story two)
db.story.hasMany(db.relation, {
  as: "relationOne",
  foreignKey: { name: "storyOneId", allowNull: false },
  onDelete: "CASCADE",
});
db.relation.belongsTo(db.story, {
  as: "storyOne",
  foreignKey: { name: "storyOneId", allowNull: false },
  onDelete: "CASCADE",
});
db.story.hasMany(db.relation, {
  as: "relationTwo",
  foreignKey: { name: "storyTwoId", allowNull: false },
  onDelete: "CASCADE",
});
db.relation.belongsTo(db.story, {
  as: "storyTwo",
  foreignKey: { name: "storyTwoId", allowNull: false },
  onDelete: "CASCADE",
});

// story <-> acceptanceCriteria
db.story.hasMany(db.acceptanceCriteria, {
  as: "acceptanceCriteria",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.acceptanceCriteria.belongsTo(db.story, {
  as: "story",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// comment <-> story
db.story.hasMany(db.comment, {
  as: "comment",
  foreignKey: { name: "storyId", allowNull: true },
  onDelete: "CASCADE",
});
db.comment.belongsTo(db.story, {
  as: "story",
  foreignKey: { name: "storyId", allowNull: true },
  onDelete: "CASCADE",
});

// comment <-> acceptanceCriteria
db.acceptanceCriteria.hasMany(db.comment, {
  as: "comment",
  foreignKey: { name: "acceptanceCriteriaId", allowNull: true },
  onDelete: "CASCADE",
});
db.comment.belongsTo(db.acceptanceCriteria, {
  as: "acceptanceCriteria",
  foreignKey: { name: "acceptanceCriteriaId", allowNull: true },
  onDelete: "CASCADE",
});

// comment <-> user
db.user.hasMany(db.comment, {
  as: "comment",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.comment.belongsTo(db.user, {
  as: "user",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// activity <-> user
db.user.hasMany(db.activity, {
  as: "activity",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.activity.belongsTo(db.user, {
  as: "user",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

// activity <-> story
db.story.hasMany(db.activity, {
  as: "activity",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});
db.activity.belongsTo(db.story, {
  as: "story",
  foreignKey: { allowNull: false },
  onDelete: "CASCADE",
});

module.exports = db;
