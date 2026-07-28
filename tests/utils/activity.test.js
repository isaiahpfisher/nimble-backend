// Mock the models module so requiring the util never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  activity: { create: jest.fn() },
  activityChange: { bulkCreate: jest.fn() },
  storyState: { name: "storyState" },
  sprint: { name: "sprint" },
  storyType: { name: "storyType" },
  user: { name: "user" },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const Activity = db.activity;
const ActivityChange = db.activityChange;

// The module is loaded per-test rather than at file scope so a load-time
// failure is reported against each behaviour it breaks instead of taking the
// whole suite down with a single "failed to run".
function loadActivity() {
  return require("../../app/utils/activity");
}

beforeEach(() => {
  jest.clearAllMocks();
  Activity.create.mockResolvedValue({ id: 100 });
  ActivityChange.bulkCreate.mockResolvedValue([]);
});

describe("exported constants", () => {
  it("exposes the three activity actions", () => {
    expect(loadActivity().ACTIVITY_ACTION).toEqual({
      CREATED: "created",
      UPDATED: "updated",
      DELETED: "deleted",
    });
  });

  it("exposes every subject type an activity can point at", () => {
    expect(loadActivity().SUBJECT_TYPE).toEqual({
      STORY: "story",
      ACCEPTANCE_CRITERIA: "acceptanceCriteria",
      COMMENT: "comment",
      RELATION: "relation",
    });
  });

  it("exposes the relation directions", () => {
    expect(loadActivity().RELATION_DIRECTION).toEqual({
      OUTGOING: "outgoing",
      INCOMING: "incoming",
    });
  });

  it("does not export names that have no definition behind them", () => {
    // Every key on the exports object has to resolve to something; a name
    // listed in module.exports with no binding is a load-time ReferenceError.
    const activity = loadActivity();
    for (const [key, value] of Object.entries(activity)) {
      expect([key, value]).not.toEqual([key, undefined]);
    }
  });
});

describe("story field configuration", () => {
  it("tracks the scalar story columns that belong in the history", () => {
    expect(loadActivity().STORY_PLAIN_FIELDS).toEqual(["title", "description", "priority", "estimate"]);
  });

  it("keys the association config by the story's foreign key columns", () => {
    expect(Object.keys(loadActivity().STORY_ASSOC_FIELDS)).toEqual([
      "stateId",
      "sprintId",
      "typeId",
      "assigneeId",
      "reporterId",
      "reviewerId",
      "repositoryId",
    ]);
  });

  it("resolves each association to its model lazily", () => {
    const { STORY_ASSOC_FIELDS } = loadActivity();

    expect(STORY_ASSOC_FIELDS.stateId.model()).toBe(db.storyState);
    expect(STORY_ASSOC_FIELDS.sprintId.model()).toBe(db.sprint);
    expect(STORY_ASSOC_FIELDS.typeId.model()).toBe(db.storyType);
    expect(STORY_ASSOC_FIELDS.assigneeId.model()).toBe(db.user);
    expect(STORY_ASSOC_FIELDS.reporterId.model()).toBe(db.user);
    expect(STORY_ASSOC_FIELDS.reviewerId.model()).toBe(db.user);
  });

  it("labels each association from the right column", () => {
    const { STORY_ASSOC_FIELDS } = loadActivity();

    expect(STORY_ASSOC_FIELDS.stateId.label({ name: "In Progress" })).toBe("In Progress");
    expect(STORY_ASSOC_FIELDS.sprintId.label({ title: "Sprint 4" })).toBe("Sprint 4");
    expect(STORY_ASSOC_FIELDS.typeId.label({ name: "Bug" })).toBe("Bug");
    expect(STORY_ASSOC_FIELDS.assigneeId.label({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(STORY_ASSOC_FIELDS.reporterId.label({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(STORY_ASSOC_FIELDS.reviewerId.label({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
  });

  it("names the attribute each association is rendered as", () => {
    const { STORY_ASSOC_FIELDS } = loadActivity();
    const attributes = Object.fromEntries(
      Object.entries(STORY_ASSOC_FIELDS).map(([key, config]) => [key, config.attribute]),
    );

    expect(attributes).toEqual({
      stateId: "state",
      sprintId: "sprint",
      typeId: "type",
      assigneeId: "assignee",
      reporterId: "reporter",
      reviewerId: "reviewer",
      repositoryId: "repository",
    });
  });
});

describe("recordActivity", () => {
  const base = {
    storyId: 7,
    subjectType: "story",
    subjectId: 7,
    action: "created",
    userId: 42,
  };

  it("writes the activity row from the supplied fields", async () => {
    const { recordActivity } = loadActivity();

    await recordActivity({ ...base, metadata: { title: "Add login" } });

    expect(Activity.create).toHaveBeenCalledWith({
      storyId: 7,
      userId: 42,
      subjectType: "story",
      subjectId: 7,
      action: "created",
      metadata: { title: "Add login" },
    });
  });

  it("defaults missing metadata to an empty object", async () => {
    const { recordActivity } = loadActivity();

    await recordActivity(base);

    expect(Activity.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
  });

  it("writes one change row per change, linked to the new activity", async () => {
    const { recordActivity } = loadActivity();
    Activity.create.mockResolvedValue({ id: 555 });

    await recordActivity({
      ...base,
      action: "updated",
      changes: [
        { attribute: "title", oldValue: "Old", newValue: "New" },
        { attribute: "estimate", oldValue: 3, newValue: 5 },
      ],
    });

    expect(ActivityChange.bulkCreate).toHaveBeenCalledWith([
      { activityId: 555, attribute: "title", operation: null, oldValue: "Old", newValue: "New" },
      { activityId: 555, attribute: "estimate", operation: null, oldValue: 3, newValue: 5 },
    ]);
  });

  it("keeps an explicit operation on the change row", async () => {
    const { recordActivity } = loadActivity();

    await recordActivity({
      ...base,
      changes: [{ attribute: "assignee", operation: "added", newValue: { id: 3, label: "Ada Lovelace" } }],
    });

    expect(ActivityChange.bulkCreate).toHaveBeenCalledWith([
      {
        activityId: 100,
        attribute: "assignee",
        operation: "added",
        oldValue: null,
        newValue: { id: 3, label: "Ada Lovelace" },
      },
    ]);
  });

  it("does not touch the change table when there are no changes", async () => {
    const { recordActivity } = loadActivity();

    await recordActivity(base);
    await recordActivity({ ...base, changes: [] });

    expect(Activity.create).toHaveBeenCalledTimes(2);
    expect(ActivityChange.bulkCreate).not.toHaveBeenCalled();
  });

  it("propagates a failure to write the activity", async () => {
    const { recordActivity } = loadActivity();
    Activity.create.mockRejectedValue(new Error("insert failed"));

    await expect(recordActivity(base)).rejects.toThrow("insert failed");
    expect(ActivityChange.bulkCreate).not.toHaveBeenCalled();
  });
});
