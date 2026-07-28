// app/models/index.js builds a Sequelize instance at load time (it does not
// connect until a query runs) and user.model.js pulls in the crypto helper,
// which needs a base64 key at import time.
process.env.SECRET_KEY = process.env.SECRET_KEY || Buffer.from("a".repeat(32)).toString("base64");

const db = require("../../app/models");

const Activity = db.activity;
const ActivityChange = db.activityChange;

describe("activity model", () => {
  it("records what kind of thing the activity is about", () => {
    const subjectType = Activity.rawAttributes.subjectType;

    expect(subjectType).toBeDefined();
    expect(subjectType.type.key).toBe("STRING");
    expect(subjectType.allowNull).toBe(false);
  });

  it("records the id of the subject as a plain integer", () => {
    const subjectId = Activity.rawAttributes.subjectId;

    expect(subjectId).toBeDefined();
    expect(subjectId.type.key).toBe("INTEGER");
    expect(subjectId.allowNull).toBe(false);
  });

  it("keeps a required action", () => {
    expect(Activity.rawAttributes.action.type.key).toBe("STRING");
    expect(Activity.rawAttributes.action.allowNull).toBe(false);
  });

  it("stores renderable metadata as JSON defaulting to an empty object", () => {
    const metadata = Activity.rawAttributes.metadata;

    expect(metadata).toBeDefined();
    expect(metadata.type.key).toBe("JSON");
    expect(metadata.allowNull).toBe(false);
    expect(metadata.defaultValue).toEqual({});
  });

  it("no longer carries the old inline changes column", () => {
    // Changes moved to their own table; leaving the column behind would mean
    // two competing sources of truth for the same history.
    expect(Activity.rawAttributes.changes).toBeUndefined();
  });
});

describe("activityChange model", () => {
  it("names the attribute that changed", () => {
    expect(ActivityChange.rawAttributes.attribute.type.key).toBe("STRING");
    expect(ActivityChange.rawAttributes.attribute.allowNull).toBe(false);
  });

  it("allows an optional operation for collection-style changes", () => {
    expect(ActivityChange.rawAttributes.operation.type.key).toBe("STRING");
    expect(ActivityChange.rawAttributes.operation.allowNull).toBe(true);
  });

  it("stores both sides of the change as nullable JSON", () => {
    for (const field of ["oldValue", "newValue"]) {
      expect(ActivityChange.rawAttributes[field].type.key).toBe("JSON");
      expect(ActivityChange.rawAttributes[field].allowNull).toBe(true);
    }
  });

  it("belongs to a required activity and cascades on delete", () => {
    const assoc = ActivityChange.associations.activity;

    expect(assoc).toBeDefined();
    expect(assoc.target).toBe(Activity);
    expect(assoc.options.onDelete).toBe("CASCADE");
    expect(ActivityChange.rawAttributes.activityId.allowNull).toBe(false);
  });

  it("is reachable from the activity it describes", () => {
    const assoc = Activity.associations.change;

    expect(assoc).toBeDefined();
    expect(assoc.target).toBe(ActivityChange);
    expect(assoc.associationType).toBe("HasMany");
    expect(assoc.options.onDelete).toBe("CASCADE");
  });
});

describe("activity <-> user", () => {
  it("keeps the activity when its author is deleted", () => {
    // History outlives the account that produced it, so the FK is nullable and
    // set to null rather than cascading the rows away.
    expect(Activity.rawAttributes.userId.allowNull).toBe(true);
    expect(Activity.associations.user.options.onDelete).toBe("SET NULL");
    expect(db.user.associations.activity.options.onDelete).toBe("SET NULL");
  });
});

describe("activity <-> story", () => {
  it("hangs the feed off the story and cascades with it", () => {
    expect(Activity.associations.story.target).toBe(db.story);
    expect(Activity.associations.story.options.onDelete).toBe("CASCADE");
    expect(db.story.associations.activity.associationType).toBe("HasMany");
  });
});

describe("polymorphic subject associations", () => {
  const cases = [
    ["subjectStory", "story"],
    ["subjectAcceptanceCriteria", "acceptanceCriteria"],
    ["subjectComment", "comment"],
  ];

  it.each(cases)("%s joins on subjectId without a real constraint", (alias, modelKey) => {
    const assoc = Activity.associations[alias];

    expect(assoc).toBeDefined();
    expect(assoc.target).toBe(db[modelKey]);
    expect(assoc.foreignKey).toBe("subjectId");
    expect(assoc.options.constraints).toBe(false);
  });

  it.each(cases)("%s reads back from the subject scoped to its type", (_alias, modelKey) => {
    const assoc = db[modelKey].associations.subjectActivity;

    expect(assoc).toBeDefined();
    expect(assoc.target).toBe(Activity);
    expect(assoc.foreignKey).toBe("subjectId");
    expect(assoc.options.constraints).toBe(false);
    expect(assoc.scope).toEqual({ subjectType: modelKey });
  });

  it("does not turn subjectId into a foreign key column on the table", () => {
    // Three belongsTo aliases share one column; if any of them registered a
    // real reference the column would point at whichever model won the race.
    expect(Activity.rawAttributes.subjectId.references).toBeUndefined();
  });

  it("registers the activityChange model on the db handle", () => {
    expect(db.activityChange).toBeDefined();
    expect(db.activityChange.name).toBe("activityChange");
  });
});
