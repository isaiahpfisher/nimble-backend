// The pure decisions behind the tools: what counts as a valid value, what a
// field becomes when the user did not say, and the arithmetic behind a sprint.
//
// Nothing here does any I/O, which is what makes it testable on its own and
// what keeps the tool bodies down to "fetch, decide, return".

const PRIORITIES = ["Low", "Medium", "High", "Blocker"];
const AC_STATUSES = ["Pending", "Passed", "Failed"];
const SPRINT_STATUSES = ["Planned", "Active", "Completed"];
const RECURRENCE_PATTERNS = ["Weekly", "Biweekly", "Monthly"];

// How the assistant writes the two prose fields it is ever asked to compose.
// Stated once here because they are quoted in four tool schemas and in the
// prompt, and a format that disagrees with itself is worse than none.
const STORY_DESCRIPTION = "As a <who>, when I <when>, I want to <what>, so that <why>.";
const CRITERION_DESCRIPTION = "Given <starting state>, when <action>, then <observable result>.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

// A fortnight. Used only when a project has no sprint to learn from.
const FALLBACK_SPRINT_DAYS = 14;

/** Renders "1 = Not Started, 2 = Ready" for an error that has to be actionable. */
const listChoices = (rows, label = "name") =>
  rows.length ? rows.map((row) => `${row.id} = ${row[label]}`).join(", ") : "none defined";

/** Drops keys the caller left undefined, so a partial update stays partial. */
const defined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

// --- dates -----------------------------------------------------------------

function checkDate(value, label) {
  if (!ISO_DATE.test(String(value))) {
    throw new Error(`${label} must be a plain date like 2026-03-01, not "${value}".`);
  }
  return value;
}

/**
 * Sprint dates are DATEONLY columns, so anything that is not YYYY-MM-DD lands
 * as an invalid date rather than an error. A backwards range is caught too: the
 * API accepts one happily and the burndown chart then renders empty.
 */
function checkDateRange(startDate, endDate) {
  checkDate(startDate, "startDate");
  checkDate(endDate, "endDate");

  if (endDate < startDate) {
    throw new Error(`endDate ${endDate} is before startDate ${startDate}.`);
  }
}

const addDays = (date, days) =>
  new Date(new Date(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const dayDiff = (from, to) => Math.round((new Date(to) - new Date(from)) / DAY_MS);

/** Whole days since a story last moved. */
const daysSince = (timestamp, now) => dayDiff(new Date(timestamp).toISOString().slice(0, 10), now);

const today = () => new Date().toISOString().slice(0, 10);

// --- defaults --------------------------------------------------------------

/**
 * The state a new story starts in: the first column of the project's board,
 * which is what Nimble's own create form defaults to.
 */
function firstState(project) {
  const states = [...(project.storyState ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!states.length) {
    throw new Error(`Project ${project.id} has no workflow states, so a story cannot be created.`);
  }
  return states[0];
}

/**
 * How long this project's sprints usually run, in days, taken from the most
 * recent one that has both dates. A team that runs three-week sprints should
 * get a three-week sprint without having to say so every time.
 */
function usualSprintLength(sprints) {
  const recent = [...(sprints ?? [])]
    .filter((sprint) => sprint.startDate && sprint.endDate)
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0];

  if (!recent) return FALLBACK_SPRINT_DAYS;

  const days = dayDiff(recent.startDate, recent.endDate);
  return days > 0 ? days : FALLBACK_SPRINT_DAYS;
}

// --- relations -------------------------------------------------------------

/**
 * A relation is stored as storyOne/storyTwo plus a type, so direction lives in
 * the column order — the frontend's own comment on this calls it "confusing
 * :(". Asking the model for a phrase and doing the swap here means it never
 * has to work out which story is "one".
 */
const RELATION_PHRASES = {
  blocks: { type: "BLOCKS", swap: false },
  "is blocked by": { type: "BLOCKS", swap: true },
  "relates to": { type: "RELATES_TO", swap: false },
  duplicates: { type: "DUPLICATES", swap: false },
  "is parent of": { type: "PARENT_OF", swap: false },
  "is child of": { type: "PARENT_OF", swap: true },
};

function resolveRelation(storyId, phrase, otherStoryId) {
  const mapping = RELATION_PHRASES[phrase];
  if (!mapping) {
    throw new Error(
      `Unknown relation "${phrase}". Use one of: ${Object.keys(RELATION_PHRASES).join(", ")}.`,
    );
  }
  if (Number(storyId) === Number(otherStoryId)) {
    throw new Error("A story cannot be related to itself.");
  }

  return {
    type: mapping.type,
    storyOneId: mapping.swap ? Number(otherStoryId) : Number(storyId),
    storyTwoId: mapping.swap ? Number(storyId) : Number(otherStoryId),
  };
}

// --- people ----------------------------------------------------------------

// Ways of saying "take this off whoever has it".
const NOBODY = new Set([
  "nobody", "none", "no one", "noone", "unassigned", "unassign", "null", "clear", "remove",
]);

/**
 * Turns however the user referred to a person into a member's user id.
 *
 * Nimble has two numbers per member — the user id and the projectMember row id
 * — and picking the wrong one produces "there is no Erin Engineer in this
 * project" listing Erin Engineer among the members. Letting the model pass a
 * name instead of an id removes the choice, and with it the whole failure.
 *
 * Returns `{ userId }`, where null means "clear the field". Throws with the
 * actual candidates when nothing or too much matches, so the caller can ask.
 */
function resolvePerson(query, members, { meId = null } = {}) {
  const choices = () =>
    members.length ? members.map((m) => m.name).filter(Boolean).join(", ") : "nobody";

  const text = String(query ?? "").trim();
  if (!text) throw new Error("Say who, or 'nobody' to clear it.");

  const lower = text.toLowerCase();
  if (NOBODY.has(lower)) return { userId: null };

  if (/^\d+$/.test(text)) {
    const id = Number(text);
    if (!members.some((m) => Number(m.id) === id)) {
      throw new Error(`No member of this project has user id ${id}. Members are: ${choices()}.`);
    }
    return { userId: id };
  }

  if ((lower === "me" || lower === "myself" || lower === "i") && meId != null) {
    return { userId: Number(meId) };
  }

  const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const parts = lower.split(/\s+/);

  // Most specific first, stopping at the first tier that matches exactly once.
  // Names outrank email fragments deliberately: in a project with an Erin
  // Engineer and an Erin Zhang, "Erin" is ambiguous and has to be asked about,
  // even though only one of them happens to have "erin" in her address.
  const tiers = [
    (m) => norm(m.name) === lower,
    (m) => norm(m.email) === lower,
    (m) => norm(m.name).split(" ").some((word) => word === lower),
    (m) => parts.every((part) => norm(m.name).includes(part)),
    (m) => norm(m.email).split("@")[0] === lower,
    (m) => norm(m.name).includes(lower) || norm(m.email).includes(lower),
  ];

  for (const tier of tiers) {
    const hits = members.filter(tier);
    if (hits.length === 1) return { userId: Number(hits[0].id) };
    if (hits.length > 1) {
      throw new Error(
        `"${text}" matches more than one member: ${hits.map((m) => m.name).join(", ")}. Which one?`,
      );
    }
  }

  throw new Error(`Nobody called "${text}" is on this project. Members are: ${choices()}.`);
}

// --- workflow states -------------------------------------------------------

/**
 * Turns however the user named a workflow state into that project's state id.
 *
 * States are per-project and user-defined: "Doing" in one project is "In
 * Progress" in the next, with different ids in both. The model has no way to
 * know one without fetching the project first, and given a numeric field it
 * reliably guesses instead — "stateId 5 does not exist in the Atlas project"
 * with the real ids listed underneath. Taking the name and resolving it here
 * removes the number from its hands entirely.
 */
function resolveState(query, states) {
  const inOrder = [...states].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const choices = () => listChoices(inOrder);

  const text = String(query ?? "").trim();
  if (!text) throw new Error(`Say which state. This project has: ${choices()}.`);

  if (/^\d+$/.test(text)) {
    const id = Number(text);
    if (!inOrder.some((state) => Number(state.id) === id)) {
      throw new Error(`stateId ${id} does not exist in this project. Valid states: ${choices()}.`);
    }
    return { stateId: id };
  }

  const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const squash = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  const lower = norm(text);
  const squashed = squash(text);
  // "d" would prefix-match both Doing and Done; a fuzzy tier needs something
  // to go on before it is allowed to guess
  const fuzzy = squashed.length >= 2;

  const tiers = [
    (state) => norm(state.name) === lower,
    // "todo" and "to-do" are both "To Do"
    (state) => squash(state.name) === squashed,
    // Containment in either direction, as one tier rather than prefix first.
    // Split, a board of "In Review" and "Review Done" resolves a bare "review"
    // to whichever the narrower tier happened to reach — and moving a story to
    // the wrong column silently beats asking which was meant.
    (state) =>
      fuzzy && (squash(state.name).includes(squashed) || squashed.includes(squash(state.name))),
  ];

  for (const tier of tiers) {
    const hits = inOrder.filter(tier);
    if (hits.length === 1) return { stateId: Number(hits[0].id) };
    if (hits.length > 1) {
      throw new Error(
        `"${text}" matches more than one state: ${hits.map((state) => state.name).join(", ")}. Which one?`,
      );
    }
  }

  throw new Error(`This project has no state called "${text}". Valid states: ${choices()}.`);
}

// --- sprint maths ----------------------------------------------------------

/**
 * Whether a story counts as finished.
 *
 * Two things can say so and they disagree in practice: `completedAt` is stamped
 * when work lands, and a project's `completedStateId` is the board column that
 * means done. A story dragged to the last column without the timestamp is still
 * finished to the team looking at the board, so either one is enough.
 */
const isStoryDone = (story, completedStateId = null) =>
  story.completedAt != null ||
  (completedStateId != null && Number(story.stateId) === Number(completedStateId));

/**
 * Where a sprint actually stands, in the same terms the burndown chart uses:
 * points, not story counts, with `completedAt` marking when work landed.
 *
 * `expectedRemaining` is the straight line from full to zero across the sprint,
 * which is what makes "ahead" or "behind" meaningful rather than a vibe.
 */
function sprintProgress({ sprint, stories, completedStateId = null, today: now }) {
  const points = (list) => list.reduce((total, story) => total + (story.estimate ?? 0), 0);
  const done = stories.filter((story) => isStoryDone(story, completedStateId));

  const totalPoints = points(stories);
  const completedPoints = points(done);

  const totalDays = Math.max(dayDiff(sprint.startDate, sprint.endDate), 1);
  const elapsed = Math.min(Math.max(dayDiff(sprint.startDate, now), 0), totalDays);

  // the ideal burndown line at today's position
  const expectedRemaining = Math.round(totalPoints * (1 - elapsed / totalDays));
  const remainingPoints = totalPoints - completedPoints;

  return {
    totalStories: stories.length,
    completedStories: done.length,
    totalPoints,
    completedPoints,
    remainingPoints,
    percentComplete: totalPoints === 0 ? null : Math.round((completedPoints / totalPoints) * 100),
    unestimatedStories: stories.filter((story) => story.estimate == null).length,
    daysTotal: totalDays,
    daysElapsed: elapsed,
    daysRemaining: Math.max(totalDays - elapsed, 0),
    expectedRemaining,
    // negative means less work left than the straight line predicts
    pointsBehindSchedule: remainingPoints - expectedRemaining,
    onTrack: remainingPoints <= expectedRemaining,
  };
}

module.exports = {
  PRIORITIES,
  AC_STATUSES,
  SPRINT_STATUSES,
  RECURRENCE_PATTERNS,
  RELATION_PHRASES,
  FALLBACK_SPRINT_DAYS,
  STORY_DESCRIPTION,
  CRITERION_DESCRIPTION,
  listChoices,
  defined,
  checkDate,
  checkDateRange,
  addDays,
  dayDiff,
  daysSince,
  today,
  firstState,
  usualSprintLength,
  resolveRelation,
  resolvePerson,
  resolveState,
  isStoryDone,
  sprintProgress,
};
