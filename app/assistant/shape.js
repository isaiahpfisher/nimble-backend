// Turning Nimble's API rows into what the model reads.
//
// The REST API eager-loads generously — a story list carries every comment and
// acceptance criterion of every story. Fine for a web page, which drops what it
// does not render, but tool output is context the model re-reads on every later
// turn. Lists return summaries; get_story fetches depth on demand.
//
// Every row carries a `url`. The assistant links constantly, and composing
// "/projects/<a>/stories/<b>" out of two separate numbers is exactly the kind
// of thing a small model gets wrong, so the url arrives already built and it
// only has to copy the string. It is also what the reply's links are checked
// against, so a url the model was never shown cannot survive into an answer.

const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

const storyUrl = (projectId, storyId) => `/projects/${projectId}/stories/${storyId}`;
const sprintUrl = (projectId, sprintId) =>
  projectId == null ? null : `/projects/${projectId}/sprints/${sprintId}`;

/**
 * Whether a membership row makes that person a manager of the project.
 *
 * `isManager` is a STRING column defaulting to "0", and the update endpoint
 * writes whatever the caller sent, so the honest read is a permissive one
 * rather than `=== "1"`.
 */
const isProjectManager = (member) => {
  const flag = member?.isManager;
  if (typeof flag === "boolean") return flag;
  return ["1", "true", "yes"].includes(String(flag ?? "").trim().toLowerCase());
};

/** A project's members as {id, name, email}, which is what resolvePerson wants. */
const projectMembers = (project) =>
  (project.projectMembers ?? []).map((m) => ({
    id: m.userId,
    name: fullName(m.user),
    email: m.user?.email ?? null,
  }));

function storySummary(story, projectId = story.projectId) {
  const summary = {
    id: story.id,
    title: story.title,
    url: storyUrl(projectId, story.id),
    projectId: projectId ?? null,
    stateId: story.stateId ?? null,
    typeId: story.typeId ?? null,
    priority: story.priority ?? null,
    estimate: story.estimate ?? null,
    sprintId: story.sprintId ?? null,
    assigneeId: story.assigneeId ?? null,
    reviewerId: story.reviewerId ?? null,
    // Timestamps are cheap here and unlock whole questions without a tool of
    // their own: completedAt is how sprint progress is measured, updatedAt is
    // the only way to tell that something has stopped moving.
    completedAt: story.completedAt ?? null,
    updatedAt: story.updatedAt ?? null,
  };

  // names only when the endpoint eager-loaded them, so the model is never
  // shown a name that is really an id
  if (story.state) summary.state = story.state.name;
  if (story.type) summary.type = story.type.name;
  if (story.assignee) summary.assignee = fullName(story.assignee);
  if (Array.isArray(story.acceptanceCriteria)) {
    summary.acceptanceCriteriaCount = story.acceptanceCriteria.length;
  }
  if (Array.isArray(story.comment)) summary.commentCount = story.comment.length;

  return summary;
}

/**
 * The smallest shape that is still linkable and still says something.
 *
 * Used where stories are illustrative rather than the answer — a few examples
 * under each person's name. A full storySummary there costs several thousand
 * tokens on a big project to show detail nobody asked for.
 */
const storyBrief = (story, projectId) => ({
  id: story.id,
  title: story.title,
  url: storyUrl(projectId, story.id),
  priority: story.priority ?? null,
  estimate: story.estimate ?? null,
  state: story.state?.name ?? null,
});

const sprintSummary = (sprint, projectId = sprint.projectId) => ({
  id: sprint.id,
  title: sprint.title,
  url: sprintUrl(projectId, sprint.id),
  projectId: projectId ?? null,
  goal: sprint.goal ?? null,
  status: sprint.status,
  startDate: sprint.startDate,
  endDate: sprint.endDate,
  isRecurring: sprint.isRecurring,
});

const projectSummary = (project) => ({
  id: project.id,
  title: project.title,
  url: `/projects/${project.id}`,
  description: project.description ?? null,
  deadline: project.deadline ?? null,
});

/** A story tagged with the project it came from, for the cross-project tools. */
const withProject = ({ story, project }) => ({
  ...storySummary(story, project.id),
  project: project.title,
});

// Seeded and user-entered priorities, most urgent first. A Map, not an object:
// priorities are user-entered, and a story with a priority of "constructor"
// would pick up Object.prototype and poison the sort. Anything unrecognised
// (including null) sorts last rather than being dropped.
const PRIORITY_ORDER = new Map([
  ["Blocker", 0],
  ["High", 1],
  ["Medium", 2],
  ["Low", 3],
]);

const priorityRank = (priority) => PRIORITY_ORDER.get(priority) ?? 99;

// Active sprint first, then priority, then oldest — the order you would
// actually pick work up in.
const byUrgency = (a, b) => {
  if (a.inActiveSprint !== b.inActiveSprint) return a.inActiveSprint ? -1 : 1;
  return priorityRank(a.priority) - priorityRank(b.priority) || a.id - b.id;
};

// Even a correctly filtered answer is useless past a certain length. Applied
// per list, and the truncation is always reported rather than silent.
const LIST_CAP = 10;

const capped = (rows, limit = LIST_CAP) => ({
  matched: rows.length,
  showing: Math.min(rows.length, limit),
  truncated: rows.length > limit,
  stories: rows.slice(0, limit),
});

module.exports = {
  fullName,
  isProjectManager,
  storyUrl,
  sprintUrl,
  projectMembers,
  storySummary,
  storyBrief,
  sprintSummary,
  projectSummary,
  withProject,
  priorityRank,
  byUrgency,
  capped,
  LIST_CAP,
};
