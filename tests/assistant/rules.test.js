// Defaults are the kind of logic that rots quietly: nothing fails, a story
// just lands in the wrong column. These are the decisions behind the write
// tools, kept out of the tool bodies so they can be checked directly.

const {
  FALLBACK_SPRINT_DAYS,
  listChoices,
  defined,
  checkDate,
  checkDateRange,
  addDays,
  daysSince,
  firstState,
  usualSprintLength,
  resolveRelation,
  resolvePerson,
  resolveState,
  sprintProgress,
} = require("../../app/assistant/rules");

describe("firstState", () => {
  // Nimble's own create form starts a story in the project's first column
  it("is the lowest-ordered state, not the first one the API happened to return", () => {
    const project = {
      id: 1,
      storyState: [
        { id: 5, name: "Done", order: 4 },
        { id: 1, name: "Not Started", order: 0 },
        { id: 3, name: "In Progress", order: 2 },
      ],
    };

    expect(firstState(project)).toEqual({ id: 1, name: "Not Started", order: 0 });
  });

  it("refuses rather than inventing one when the project has no states", () => {
    expect(() => firstState({ id: 9, storyState: [] })).toThrow(/no workflow states/);
    expect(() => firstState({ id: 9 })).toThrow(/no workflow states/);
  });
});

describe("usualSprintLength", () => {
  const sprint = (startDate, endDate) => ({ startDate, endDate });

  it("learns the project's cadence from its most recent sprint", () => {
    const sprints = [sprint("2026-01-01", "2026-01-15"), sprint("2026-02-01", "2026-02-22")];

    expect(usualSprintLength(sprints)).toBe(21);
  });

  it("falls back to a fortnight with nothing to learn from", () => {
    expect(usualSprintLength([])).toBe(FALLBACK_SPRINT_DAYS);
    expect(usualSprintLength(undefined)).toBe(FALLBACK_SPRINT_DAYS);
    expect(usualSprintLength([sprint("2026-01-01", null)])).toBe(FALLBACK_SPRINT_DAYS);
  });

  it("ignores a zero-length or backwards sprint rather than propagating it", () => {
    expect(usualSprintLength([sprint("2026-01-01", "2026-01-01")])).toBe(FALLBACK_SPRINT_DAYS);
    expect(usualSprintLength([sprint("2026-02-01", "2026-01-01")])).toBe(FALLBACK_SPRINT_DAYS);
  });

  it("does not mutate the caller's array", () => {
    const sprints = [sprint("2026-01-01", "2026-01-15"), sprint("2026-03-01", "2026-03-15")];
    const before = [...sprints];

    usualSprintLength(sprints);

    expect(sprints).toEqual(before);
  });
});

describe("addDays", () => {
  it("returns a plain date the API will accept", () => {
    expect(addDays("2026-10-05", 14)).toBe("2026-10-19");
  });

  it("crosses a month and a leap day correctly", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("checkDate", () => {
  it("rejects anything that is not YYYY-MM-DD", () => {
    // a DATEONLY column swallows these as an invalid date rather than erroring
    expect(() => checkDate("next monday", "startDate")).toThrow(/startDate must be a plain date/);
    expect(() => checkDate("05/10/2026", "startDate")).toThrow(/plain date/);
    expect(() => checkDate(undefined, "endDate")).toThrow(/endDate must be a plain date/);
  });

  it("passes a real date straight through", () => {
    expect(checkDate("2026-10-05", "startDate")).toBe("2026-10-05");
  });
});

describe("checkDateRange", () => {
  it("accepts a forward range and a single-day sprint", () => {
    expect(() => checkDateRange("2026-10-05", "2026-10-19")).not.toThrow();
    expect(() => checkDateRange("2026-10-05", "2026-10-05")).not.toThrow();
  });

  // the API takes a backwards range happily and the burndown renders empty
  it("rejects an end before the start", () => {
    expect(() => checkDateRange("2026-10-19", "2026-10-05")).toThrow(/before startDate/);
  });
});

describe("defined", () => {
  // a partial update has to stay partial, but null is a real instruction:
  // it is how an assignee gets cleared
  it("drops undefined and keeps null", () => {
    expect(defined({ title: "x", assigneeId: null, estimate: undefined })).toEqual({
      title: "x",
      assigneeId: null,
    });
  });

  it("keeps falsy values that mean something", () => {
    expect(defined({ estimate: 0, goal: "" })).toEqual({ estimate: 0, goal: "" });
  });
});

describe("listChoices", () => {
  it("renders ids with their names for an error the model can act on", () => {
    expect(listChoices([{ id: 1, name: "Not Started" }, { id: 2, name: "Ready" }])).toBe(
      "1 = Not Started, 2 = Ready",
    );
  });

  it("reads a different label when the rows are titled", () => {
    expect(listChoices([{ id: 7, title: "Sprint 4" }], "title")).toBe("7 = Sprint 4");
  });

  it("says so when there is nothing to choose from", () => {
    expect(listChoices([])).toBe("none defined");
  });
});

describe("resolveRelation", () => {
  // Nimble stores direction as column order, which the frontend's own comment
  // calls "confusing :(" — the phrase is what keeps the model out of it
  it("puts the blocker in storyOne whichever way round it is phrased", () => {
    expect(resolveRelation(42, "is blocked by", 7)).toEqual({ type: "BLOCKS", storyOneId: 7, storyTwoId: 42 });
    expect(resolveRelation(7, "blocks", 42)).toEqual({ type: "BLOCKS", storyOneId: 7, storyTwoId: 42 });
  });

  it("maps parent and child to the same type, swapped", () => {
    expect(resolveRelation(1, "is parent of", 2)).toEqual({ type: "PARENT_OF", storyOneId: 1, storyTwoId: 2 });
    expect(resolveRelation(1, "is child of", 2)).toEqual({ type: "PARENT_OF", storyOneId: 2, storyTwoId: 1 });
  });

  it("keeps the symmetric ones in the order given", () => {
    expect(resolveRelation(3, "relates to", 4)).toEqual({ type: "RELATES_TO", storyOneId: 3, storyTwoId: 4 });
    expect(resolveRelation(3, "duplicates", 4)).toEqual({ type: "DUPLICATES", storyOneId: 3, storyTwoId: 4 });
  });

  it("lists the phrases it knows when given one it does not", () => {
    expect(() => resolveRelation(1, "is a sibling of", 2)).toThrow(/Use one of: blocks, is blocked by/);
  });

  it("refuses to link a story to itself, however it is typed", () => {
    expect(() => resolveRelation(5, "blocks", 5)).toThrow(/cannot be related to itself/);
    expect(() => resolveRelation(5, "blocks", "5")).toThrow(/cannot be related to itself/);
  });
});

describe("daysSince", () => {
  it("counts whole days from a timestamp to a date", () => {
    expect(daysSince("2026-07-22T06:49:42.000Z", "2026-08-01")).toBe(10);
    expect(daysSince("2026-08-01T23:00:00.000Z", "2026-08-01")).toBe(0);
  });
});

describe("sprintProgress", () => {
  const sprint = { startDate: "2026-07-23", endDate: "2026-08-06" }; // 14 days
  const story = (estimate, done) => ({ estimate, completedAt: done ? "2026-07-30" : null, stateId: done ? 5 : 1 });

  it("measures in points and compares against the straight line", () => {
    const p = sprintProgress({
      sprint,
      stories: [story(10, true), story(10, true), story(20, false)],
      today: "2026-08-01", // day 9 of 14
    });

    expect(p).toMatchObject({
      totalPoints: 40,
      completedPoints: 20,
      remainingPoints: 20,
      percentComplete: 50,
      daysTotal: 14,
      daysElapsed: 9,
      daysRemaining: 5,
    });
    // the line says 40 * (1 - 9/14) ≈ 14 should be left, and 20 is
    expect(p.expectedRemaining).toBe(14);
    expect(p.pointsBehindSchedule).toBe(6);
    expect(p.onTrack).toBe(false);
  });

  it("counts a story done by its project's completed state, not only completedAt", () => {
    const stories = [{ estimate: 5, completedAt: null, stateId: 5 }, story(5, false)];

    expect(sprintProgress({ sprint, stories, completedStateId: 5, today: "2026-07-23" })).toMatchObject({
      completedStories: 1,
      completedPoints: 5,
    });
  });

  it("flags unestimated stories, since they make the points meaningless", () => {
    const stories = [story(5, true), { estimate: null, completedAt: null, stateId: 1 }];

    expect(sprintProgress({ sprint, stories, today: "2026-07-23" }).unestimatedStories).toBe(1);
  });

  it("does not divide by zero on a sprint with no points", () => {
    const p = sprintProgress({ sprint, stories: [], today: "2026-07-30" });

    expect(p.percentComplete).toBeNull();
    expect(p.totalPoints).toBe(0);
    expect(p.onTrack).toBe(true);
  });

  it("clamps a sprint that has not started or has run over", () => {
    const early = sprintProgress({ sprint, stories: [story(10, false)], today: "2026-07-01" });
    expect(early.daysElapsed).toBe(0);
    expect(early.expectedRemaining).toBe(10);

    const late = sprintProgress({ sprint, stories: [story(10, false)], today: "2026-09-01" });
    expect(late.daysElapsed).toBe(14);
    expect(late.daysRemaining).toBe(0);
    expect(late.expectedRemaining).toBe(0);
  });

  it("handles a one-day sprint without dividing by zero", () => {
    const p = sprintProgress({
      sprint: { startDate: "2026-07-23", endDate: "2026-07-23" },
      stories: [story(4, false)],
      today: "2026-07-23",
    });

    expect(p.daysTotal).toBe(1);
    expect(Number.isFinite(p.expectedRemaining)).toBe(true);
  });
});

describe("resolveState", () => {
  // Atlas, from the report: the model sent stateId 5 and was told 6, 7 and 8
  // were the real ones. Naming the state is what removes that failure.
  const states = [
    { id: 6, name: "To Do", order: 0 },
    { id: 7, name: "Doing", order: 1 },
    { id: 8, name: "Done", order: 2 },
  ];

  it.each([
    ["the name as written", "Doing"],
    ["the wrong case", "doing"],
    ["surrounding whitespace", "  Doing  "],
  ])("resolves %s", (_label, query) => {
    expect(resolveState(query, states)).toEqual({ stateId: 7 });
  });

  it("looks past spacing and punctuation", () => {
    expect(resolveState("todo", states)).toEqual({ stateId: 6 });
    expect(resolveState("to-do", states)).toEqual({ stateId: 6 });
    expect(resolveState("done!", states)).toEqual({ stateId: 8 });
  });

  it("accepts an id that really belongs to the project", () => {
    expect(resolveState(7, states)).toEqual({ stateId: 7 });
  });

  it("refuses an id from somewhere else, listing the real ones", () => {
    expect(() => resolveState(5, states)).toThrow(
      /stateId 5 does not exist in this project. Valid states: 6 = To Do, 7 = Doing, 8 = Done/,
    );
  });

  it("names the states when nothing matches", () => {
    expect(() => resolveState("Archived", states)).toThrow(
      /no state called "Archived". Valid states: 6 = To Do, 7 = Doing, 8 = Done/,
    );
  });

  it("asks rather than guessing between two that match", () => {
    const reviews = [
      { id: 1, name: "In Review", order: 0 },
      { id: 2, name: "Review Done", order: 1 },
    ];

    expect(() => resolveState("review", reviews)).toThrow(
      /matches more than one state: In Review, Review Done/,
    );
  });

  // "d" prefixes both Doing and Done; a fuzzy tier needs something to go on
  it("does not guess from a single letter", () => {
    expect(() => resolveState("d", states)).toThrow(/no state called "d"/);
  });

  it("asks which when given nothing at all", () => {
    expect(() => resolveState("", states)).toThrow(/Say which state. This project has: 6 = To Do/);
  });

  it("lists the states in board order, not the order the API returned them", () => {
    const shuffled = [states[2], states[0], states[1]];

    expect(() => resolveState("Archived", shuffled)).toThrow(/6 = To Do, 7 = Doing, 8 = Done/);
  });
});

describe("resolvePerson", () => {
  // Erin's user id is 5 but her projectMember row id is 14. Picking the wrong
  // one produced "there is no Erin Engineer in this project" printed directly
  // above a list containing Erin Engineer.
  const members = [
    { id: 1, name: "Test User", email: "admin@example.com" },
    { id: 2, name: "Bob Builder", email: "bob@example.com" },
    { id: 5, name: "Erin Engineer", email: "erin@example.com" },
    { id: 9, name: "Ivan Infra", email: "ivan@example.com" },
  ];

  it.each([
    ["a full name", "Erin Engineer"],
    ["a first name", "Erin"],
    ["a surname", "Engineer"],
    ["the wrong case", "erin engineer"],
    ["an email", "erin@example.com"],
    ["an email local part", "erin"],
    ["surrounding whitespace", "  Erin  "],
  ])("resolves %s", (_label, query) => {
    expect(resolvePerson(query, members)).toEqual({ userId: 5 });
  });

  it("accepts a user id that really is a member", () => {
    expect(resolvePerson(5, members)).toEqual({ userId: 5 });
  });

  // 14 is Erin's membership row, not her user id
  it("rejects a number that is not a member's user id", () => {
    expect(() => resolvePerson(14, members)).toThrow(/No member of this project has user id 14/);
  });

  it.each([["nobody"], ["none"], ["unassigned"], ["no one"]])("treats %s as clearing the field", (word) => {
    expect(resolvePerson(word, members)).toEqual({ userId: null });
  });

  it("resolves 'me' to the current user", () => {
    expect(resolvePerson("me", members, { meId: 2 })).toEqual({ userId: 2 });
  });

  it("names the people it could not choose between", () => {
    const twoErins = [...members, { id: 21, name: "Erin Zhang", email: "ez@example.com" }];

    expect(() => resolvePerson("Erin", twoErins)).toThrow(
      /matches more than one member: Erin Engineer, Erin Zhang/,
    );
    // the full name is still unambiguous
    expect(resolvePerson("Erin Zhang", twoErins)).toEqual({ userId: 21 });
  });

  it("lists the members when nobody matches", () => {
    expect(() => resolvePerson("Carol Coder", members)).toThrow(
      /Nobody called "Carol Coder" is on this project. Members are: Test User, Bob Builder, Erin Engineer, Ivan Infra/,
    );
  });

  it("asks rather than guessing when given nothing", () => {
    expect(() => resolvePerson("", members)).toThrow(/Say who/);
    expect(() => resolvePerson(undefined, members)).toThrow(/Say who/);
  });
});
