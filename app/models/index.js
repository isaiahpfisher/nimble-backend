const dbConfig = require("../config/db.config.js");

const Sequelize = require("sequelize");

const sequelize = new Sequelize(
  dbConfig.DB,
  dbConfig.USER,
  dbConfig.PASSWORD,
  {
    host: dbConfig.HOST,
    port: dbConfig.PORT,
    dialect: dbConfig.dialect,
    logging: false,

    dialectOptions: dbConfig.ssl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        }
      : {},

    pool: {
      max: dbConfig.pool.max,
      min: dbConfig.pool.min,
      acquire: dbConfig.pool.acquire,
      idle: dbConfig.pool.idle,
    },
  }
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// =========================
// Models
// =========================

db.user = require("./user.model.js")(sequelize, Sequelize);
db.session = require("./session.model.js")(sequelize, Sequelize);
db.activity = require("./activity.model.js")(sequelize, Sequelize);
db.activityChange = require("./activityChange.model.js")(
  sequelize,
  Sequelize
);

db.project = require("./project.model.js")(sequelize, Sequelize);
db.projectMember = require("./projectMember.model.js")(
  sequelize,
  Sequelize
);

db.repository = require("./repository.model.js")(sequelize, Sequelize);
db.storyState = require("./storyState.model.js")(sequelize, Sequelize);
db.storyType = require("./storyType.model.js")(sequelize, Sequelize);
db.sprint = require("./sprint.model.js")(sequelize, Sequelize);

// Retrospective
db.retrospective = require("./retrospective.model.js")(
  sequelize,
  Sequelize
);

db.standup = require("./standup.model.js")(sequelize, Sequelize);
db.story = require("./story.model.js")(sequelize, Sequelize);
db.relation = require("./relation.model.js")(sequelize, Sequelize);
db.acceptanceCriteria = require("./acceptanceCriteria.model.js")(
  sequelize,
  Sequelize
);
db.comment = require("./comment.model.js")(sequelize, Sequelize);

// =========================
// Session <-> User
// =========================

db.user.hasMany(db.session, {
  as: "session",
  foreignKey: {
    name: "userId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.session.belongsTo(db.user, {
  as: "user",
  foreignKey: {
    name: "userId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// ProjectMember <-> User
// =========================

db.user.hasMany(db.projectMember, {
  as: "projectMember",
  foreignKey: {
    name: "userId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.projectMember.belongsTo(db.user, {
  as: "user",
  foreignKey: {
    name: "userId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// ProjectMember <-> Project
// =========================

db.project.hasMany(db.projectMember, {
  as: "projectMembers",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.projectMember.belongsTo(db.project, {
  as: "project",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Project <-> Repository
// =========================

db.project.hasMany(db.repository, {
  as: "repository",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.repository.belongsTo(db.project, {
  as: "project",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Project <-> StoryState
// =========================

db.project.hasMany(db.storyState, {
  as: "storyState",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.storyState.belongsTo(db.project, {
  as: "project",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// StoryState <-> Project
// GitHub automation
// =========================

db.storyState.hasMany(db.project, {
  as: "branchCreationForProject",
  foreignKey: {
    name: "branchCreationStateId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.project.belongsTo(db.storyState, {
  as: "branchCreationState",
  foreignKey: {
    name: "branchCreationStateId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.storyState.hasMany(db.project, {
  as: "prReviewForProject",
  foreignKey: {
    name: "prReviewStateId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.project.belongsTo(db.storyState, {
  as: "prReviewState",
  foreignKey: {
    name: "prReviewStateId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.storyState.hasMany(db.project, {
  as: "completedStateForProject",
  foreignKey: {
    name: "completedStateId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.project.belongsTo(db.storyState, {
  as: "completedState",
  foreignKey: {
    name: "completedStateId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// Project <-> StoryType
// =========================

db.project.hasMany(db.storyType, {
  as: "storyType",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.storyType.belongsTo(db.project, {
  as: "project",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Project <-> Sprint
// =========================

db.project.hasMany(db.sprint, {
  as: "sprint",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.sprint.belongsTo(db.project, {
  as: "project",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Sprint <-> Retrospective
// =========================

db.sprint.hasMany(db.retrospective, {
  as: "retrospectives",
  foreignKey: {
    name: "sprintId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.retrospective.belongsTo(db.sprint, {
  as: "sprint",
  foreignKey: {
    name: "sprintId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// User <-> Retrospective
// =========================

db.user.hasMany(db.retrospective, {
  as: "retrospectives",
  foreignKey: {
    name: "createdById",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.retrospective.belongsTo(db.user, {
  as: "createdBy",
  foreignKey: {
    name: "createdById",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Sprint <-> Standup
// =========================

db.sprint.hasMany(db.standup, {
  as: "standup",
  foreignKey: {
    name: "sprintId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.standup.belongsTo(db.sprint, {
  as: "sprint",
  foreignKey: {
    name: "sprintId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Project <-> Story
// =========================

db.project.hasMany(db.story, {
  as: "story",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.story.belongsTo(db.project, {
  as: "project",
  foreignKey: {
    name: "projectId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Repository <-> Story
// =========================

db.repository.hasMany(db.story, {
  as: "story",
  foreignKey: {
    name: "repositoryId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.story.belongsTo(db.repository, {
  as: "repository",
  foreignKey: {
    name: "repositoryId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// Sprint <-> Story
// =========================

db.sprint.hasMany(db.story, {
  as: "story",
  foreignKey: {
    name: "sprintId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.story.belongsTo(db.sprint, {
  as: "sprint",
  foreignKey: {
    name: "sprintId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// StoryState <-> Story
// =========================

db.storyState.hasMany(db.story, {
  as: "story",
  foreignKey: {
    name: "stateId",
    allowNull: false,
  },
  onDelete: "RESTRICT",
});

db.story.belongsTo(db.storyState, {
  as: "state",
  foreignKey: {
    name: "stateId",
    allowNull: false,
  },
  onDelete: "RESTRICT",
});

// =========================
// StoryType <-> Story
// =========================

db.storyType.hasMany(db.story, {
  as: "story",
  foreignKey: {
    name: "typeId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.story.belongsTo(db.storyType, {
  as: "type",
  foreignKey: {
    name: "typeId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// User <-> Story
// Reporter
// =========================

db.user.hasMany(db.story, {
  as: "reportedStory",
  foreignKey: {
    name: "reporterId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.story.belongsTo(db.user, {
  as: "reporter",
  foreignKey: {
    name: "reporterId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// User <-> Story
// Assignee
// =========================

db.user.hasMany(db.story, {
  as: "assignedStory",
  foreignKey: {
    name: "assigneeId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.story.belongsTo(db.user, {
  as: "assignee",
  foreignKey: {
    name: "assigneeId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// User <-> Story
// Reviewer
// =========================

db.user.hasMany(db.story, {
  as: "reviewedStory",
  foreignKey: {
    name: "reviewerId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.story.belongsTo(db.user, {
  as: "reviewer",
  foreignKey: {
    name: "reviewerId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// Story <-> Relation
// =========================

db.story.hasMany(db.relation, {
  as: "relationOne",
  foreignKey: {
    name: "storyOneId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.relation.belongsTo(db.story, {
  as: "storyOne",
  foreignKey: {
    name: "storyOneId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.story.hasMany(db.relation, {
  as: "relationTwo",
  foreignKey: {
    name: "storyTwoId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.relation.belongsTo(db.story, {
  as: "storyTwo",
  foreignKey: {
    name: "storyTwoId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Story <-> AcceptanceCriteria
// =========================

db.story.hasMany(db.acceptanceCriteria, {
  as: "acceptanceCriteria",
  foreignKey: {
    name: "storyId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.acceptanceCriteria.belongsTo(db.story, {
  as: "story",
  foreignKey: {
    name: "storyId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Story <-> Comment
// =========================

db.story.hasMany(db.comment, {
  as: "comment",
  foreignKey: {
    name: "storyId",
    allowNull: true,
  },
  onDelete: "CASCADE",
});

db.comment.belongsTo(db.story, {
  as: "story",
  foreignKey: {
    name: "storyId",
    allowNull: true,
  },
  onDelete: "CASCADE",
});

// =========================
// AcceptanceCriteria <-> Comment
// =========================

db.acceptanceCriteria.hasMany(db.comment, {
  as: "comment",
  foreignKey: {
    name: "acceptanceCriteriaId",
    allowNull: true,
  },
  onDelete: "CASCADE",
});

db.comment.belongsTo(db.acceptanceCriteria, {
  as: "acceptanceCriteria",
  foreignKey: {
    name: "acceptanceCriteriaId",
    allowNull: true,
  },
  onDelete: "CASCADE",
});

// =========================
// User <-> Comment
// =========================

db.user.hasMany(db.comment, {
  as: "comment",
  foreignKey: {
    name: "userId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.comment.belongsTo(db.user, {
  as: "user",
  foreignKey: {
    name: "userId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Activity <-> User
// =========================

db.user.hasMany(db.activity, {
  as: "activity",
  foreignKey: {
    name: "userId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

db.activity.belongsTo(db.user, {
  as: "user",
  foreignKey: {
    name: "userId",
    allowNull: true,
  },
  onDelete: "SET NULL",
});

// =========================
// Activity <-> Story
// =========================

db.story.hasMany(db.activity, {
  as: "activity",
  foreignKey: {
    name: "storyId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.activity.belongsTo(db.story, {
  as: "story",
  foreignKey: {
    name: "storyId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Activity <-> Subject
// Polymorphic relationship
// =========================

db.activity.belongsTo(db.story, {
  as: "subjectStory",
  foreignKey: {
    name: "subjectId",
    allowNull: false,
  },
  constraints: false,
});

db.activity.belongsTo(db.acceptanceCriteria, {
  as: "subjectAcceptanceCriteria",
  foreignKey: {
    name: "subjectId",
    allowNull: false,
  },
  constraints: false,
});

db.activity.belongsTo(db.comment, {
  as: "subjectComment",
  foreignKey: {
    name: "subjectId",
    allowNull: false,
  },
  constraints: false,
});

db.story.hasMany(db.activity, {
  as: "subjectActivity",
  foreignKey: {
    name: "subjectId",
    allowNull: false,
  },
  constraints: false,
  scope: {
    subjectType: "story",
  },
});

db.acceptanceCriteria.hasMany(db.activity, {
  as: "subjectActivity",
  foreignKey: {
    name: "subjectId",
    allowNull: false,
  },
  constraints: false,
  scope: {
    subjectType: "acceptanceCriteria",
  },
});

db.comment.hasMany(db.activity, {
  as: "subjectActivity",
  foreignKey: {
    name: "subjectId",
    allowNull: false,
  },
  constraints: false,
  scope: {
    subjectType: "comment",
  },
});

// =========================
// Activity <-> ActivityChange
// =========================

db.activity.hasMany(db.activityChange, {
  as: "change",
  foreignKey: {
    name: "activityId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

db.activityChange.belongsTo(db.activity, {
  as: "activity",
  foreignKey: {
    name: "activityId",
    allowNull: false,
  },
  onDelete: "CASCADE",
});

// =========================
// Export
// =========================

module.exports = db;