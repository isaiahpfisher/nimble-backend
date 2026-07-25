const db = require("../models");
const Activity = db.activity;
const ActivityChange = db.activityChange;

const ACTIVITY_ACTION = {
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
};

const SUBJECT_TYPE = {
  STORY: "story",
  ACCEPTANCE_CRITERIA: "acceptanceCriteria",
  COMMENT: "comment",
  RELATION: "relation",
};

const CHANGE_OPERATION = {
  ADDED: "added",
  REMOVED: "removed",
};

const RELATION_DIRECTION = {
  OUTGOING: "outgoing",
  INCOMING: "incoming",
};

const COMMENT_TARGET = {
  STORY: "story",
  ACCEPTANCE_CRITERIA: "acceptanceCriteria",
};

const STORY_PLAIN_FIELDS = ["title", "description", "priority", "estimate"];

const STORY_ASSOC_FIELDS = {
  stateId: { attribute: "state", model: () => db.storyState, label: (r) => r.name },
  sprintId: { attribute: "sprint", model: () => db.sprint, label: (r) => r.title },
  typeId: { attribute: "type", model: () => db.storyType, label: (r) => r.name },
  assigneeId: {
    attribute: "assignee",
    model: () => db.user,
    label: (r) => `${r.firstName} ${r.lastName}`,
  },
  reporterId: {
    attribute: "reporter",
    model: () => db.user,
    label: (r) => `${r.firstName} ${r.lastName}`,
  },
  reviewerId: {
    attribute: "reviewer",
    model: () => db.user,
    label: (r) => `${r.firstName} ${r.lastName}`,
  },
};

async function recordActivity({ storyId, subjectType, subjectId, action, metadata, userId, changes }) {
  const activity = await Activity.create({ storyId, userId, subjectType, subjectId, action, metadata: metadata ?? {} });

  if (changes?.length) {
    await ActivityChange.bulkCreate(
      changes.map((c) => ({
        activityId: activity.id,
        attribute: c.attribute,
        operation: c.operation ?? null,
        oldValue: c.oldValue ?? null,
        newValue: c.newValue ?? null,
      })),
    );
  }
}

module.exports = {
  ACTIVITY_ACTION,
  SUBJECT_TYPE,
  CHANGE_OPERATION,
  RELATION_DIRECTION,
  COMMENT_TARGET,
  STORY_PLAIN_FIELDS,
  STORY_ASSOC_FIELDS,
  recordActivity,
};
