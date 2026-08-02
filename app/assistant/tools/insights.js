// The questions that span more than one project or more than one person.
//
// These exist because the model is bad at assembling them. "What am I working
// on" done from its side costs a list_stories per project — thousands of tokens
// and a turn each — and it still has to stitch the results together itself.

const { z } = require("zod");
const { daysSince, today } = require("../rules");
const { rankStories } = require("../search");
const {
  byUrgency,
  capped,
  fullName,
  storyBrief,
  storySummary,
  withProject,
} = require("../shape");

const num = (description) => z.number().int().describe(description);
const str = (description) => z.string().describe(description);

/**
 * Every story in every project the user belongs to, each tagged with the
 * project it came from. One unreadable project does not sink the answer.
 */
async function allMyStories(api) {
  const projects = await api("/users/me/projects");

  const perProject = await Promise.all(
    projects.map(async (project) => {
      try {
        const stories = await api(`/projects/${project.id}/stories`);
        return stories.map((story) => ({ story, project }));
      } catch (err) {
        console.error(`[assistant] skipped project ${project.id}: ${err.message}`);
        return [];
      }
    }),
  );

  return perProject.flat();
}

/** Whether a story counts as finished, by its own project's definition. */
const isFinished = ({ story, project }) =>
  project.completedStateId != null && Number(story.stateId) === Number(project.completedStateId);

module.exports = [
  {
    name: "get_my_work",
    title: "Get my current work",
    description:
      "The unfinished stories the current user is responsible for, across every project they belong to, " +
      "with active-sprint work first and higher priorities before lower. This is the tool for \"what " +
      'should I work on", "what is on my plate", "what am I doing this sprint" and "what needs my ' +
      'review". It takes no arguments. Do not assemble this answer yourself out of list_my_projects and ' +
      "list_stories.\n\n" +
      "The answer has two separate lists, because building a story and reviewing someone else's are " +
      "different jobs: `assigned` is every unfinished story they are the assignee of, `reviewing` is " +
      "every unfinished story they are the reviewer of. Being named the reviewer is what puts a story in " +
      "`reviewing` — every story in that list needs their review, whatever state it is in. A story can " +
      "appear in both, flagged `alsoReviewing` or `alsoAssigned`. Never move a story from one list into " +
      "the other. Each list reports `matched` (the true total, the number to quote), `showing`, and " +
      "`truncated`.",
    input: z.object({}),
    async run(_args, { api, userId }) {
      if (!userId) throw new Error("I do not know which user you are, so I cannot answer this one.");

      const isMe = (value) => value != null && Number(value) === Number(userId);

      // whole project rows, so each project's own completedStateId comes with
      // them — every project defines "finished" for itself
      const projects = await api("/users/me/projects");

      const perProject = await Promise.all(
        projects.map(async (project) => {
          try {
            const [stories, sprints] = await Promise.all([
              api(`/projects/${project.id}/stories`),
              api(`/projects/${project.id}/sprints`),
            ]);

            const active = new Set(sprints.filter((s) => s.status === "Active").map((s) => s.id));
            const titles = new Map(sprints.map((s) => [s.id, s.title]));

            return stories
              .filter((story) => isMe(story.assigneeId) || isMe(story.reviewerId))
              .filter((story) => Number(story.stateId) !== Number(project.completedStateId ?? NaN))
              .map((story) => ({
                ...storySummary(story, project.id),
                project: project.title,
                // Reviewer id is what makes a story yours to review. The only
                // state test is the completedStateId filter above, which drops
                // finished work from both lists. There is deliberately no
                // second test against the project's prReviewState: that is a
                // board position, not an assignment, and gating on it hid every
                // review on every project that never configured one.
                assigned: isMe(story.assigneeId),
                reviewing: isMe(story.reviewerId),
                sprint: story.sprintId == null ? null : (titles.get(story.sprintId) ?? null),
                inActiveSprint: active.has(story.sprintId),
              }));
          } catch (err) {
            console.error(`[assistant] get_my_work skipped project ${project.id}: ${err.message}`);
            return [];
          }
        }),
      );

      const mine = perProject.flat().sort(byUrgency);

      // Two lists rather than one list with a role field. A single list left
      // the model to do the splitting, and it reliably got it wrong: it either
      // dropped the reviewer rows or filed stories it was merely assigned under
      // "waiting on your review". Splitting it here is not something it can
      // misread.
      const shape = ({ assigned, reviewing, ...story }, list) => ({
        ...story,
        ...(list === "reviewing" ? { alsoAssigned: assigned } : { alsoReviewing: reviewing }),
      });

      return {
        userId,
        assigned: capped(mine.filter((s) => s.assigned).map((s) => shape(s, "assigned"))),
        reviewing: capped(mine.filter((s) => s.reviewing).map((s) => shape(s, "reviewing"))),
      };
    },
  },

  {
    name: "find_story",
    title: "Find a story across all my projects",
    description:
      "Find a story from a loose description of it, across every project the user belongs to. Pass their " +
      'own words — "the login bug", "notification emails", "story 47" — rather than trying to ' +
      "reconstruct an exact title. Words are matched separately and allow for plurals and punctuation, " +
      "results come back best first, and a bare number is treated as a story id.\n\n" +
      'This is the tool for "where is the story about X", "did we already log this", and for turning ' +
      "any vague reference into a story before you act on it. `confident` is true when one result stands " +
      "clearly above the rest — act on it. When it is false and several look plausible, show the top few " +
      "and ask which they meant rather than guessing.\n\n" +
      "Use list_stories instead when you already know the project and want precise filters — state, " +
      "type, assignee, sprint. That one filters exactly; this one searches everywhere and ranks.",
    input: z.object({
      query: str("Text to look for in story titles and descriptions. Case-insensitive."),
      includeFinished: z.boolean().default(false).describe("Include completed stories. Off by default."),
      limit: num("Most stories to return.").min(1).max(50).default(10),
    }),
    async run({ query, includeFinished, limit }, { api }) {
      if (!query.trim()) throw new Error("Give some text to search for.");

      const rows = (await allMyStories(api)).filter((row) => includeFinished || !isFinished(row));
      const { terms, scored, confident } = rankStories(rows, query);

      return {
        query,
        terms,
        confident,
        ...capped(
          scored.map(({ row, score }) => ({ ...withProject(row), score })),
          limit,
        ),
      };
    },
  },

  {
    name: "find_stale_stories",
    title: "Find work that has stopped moving",
    description:
      "Unfinished stories that have not been touched in a while, oldest first. This is the tool for " +
      '"what has stalled", "what is stuck in review", "what have we forgotten" and standup questions ' +
      "about work that is not progressing. Searches every project the user belongs to unless you name " +
      "one. `daysSinceUpdate` on each row is how long it has sat.",
    input: z.object({
      days: num("How many days without an update counts as stale.").min(1).max(365).default(14),
      projectId: num("Limit to one project. Omit to search all of them.").optional(),
      stateId: num("Only this workflow state, e.g. stories stuck in review. Per-project, so pair it with projectId.").optional(),
      limit: num("Most stories to return.").min(1).max(50).default(10),
    }),
    async run({ days, projectId, stateId, limit }, { api }) {
      const now = today();

      const stale = (await allMyStories(api))
        .filter((row) => projectId === undefined || Number(row.project.id) === projectId)
        .filter((row) => stateId === undefined || Number(row.story.stateId) === stateId)
        .filter((row) => !isFinished(row))
        .map((row) => ({ ...row, age: row.story.updatedAt ? daysSince(row.story.updatedAt, now) : null }))
        .filter((row) => row.age != null && row.age >= days)
        .sort((a, b) => b.age - a.age);

      return {
        staleAfterDays: days,
        ...capped(
          stale.map((row) => ({ ...withProject(row), daysSinceUpdate: row.age })),
          limit,
        ),
      };
    },
  },

  {
    name: "get_team_workload",
    title: "What everyone on a project is working on",
    description:
      "Unfinished work on one project grouped by the person it is assigned to, with a story count and " +
      'point total each, plus whatever nobody has picked up. This is the tool for "what is the team ' +
      'working on", "who is overloaded", "who has capacity" and "what is unassigned".\n\n' +
      "Use get_my_work for the current user's own workload — that one spans every project. This one is " +
      "one project, everyone on it. Each person shows a few example stories; call list_stories with " +
      "their assigneeId for the full list.",
    input: z.object({
      projectId: num("Id of the project."),
      sprintId: num("Only count work in this sprint. Omit for all unfinished work.").optional(),
    }),
    async run({ projectId, sprintId }, { api }) {
      const [project, stories] = await Promise.all([
        api(`/projects/${projectId}`),
        api(`/projects/${projectId}/stories`),
      ]);

      const open = stories
        .filter(
          (story) =>
            project.completedStateId == null ||
            Number(story.stateId) !== Number(project.completedStateId),
        )
        .filter((story) => sprintId === undefined || Number(story.sprintId) === sprintId);

      const bucket = () => ({ stories: 0, points: 0, examples: [] });
      const byUser = new Map(
        (project.projectMembers ?? []).map((m) => [Number(m.userId), { name: fullName(m.user), ...bucket() }]),
      );
      const unassigned = bucket();

      for (const story of open) {
        const target = story.assigneeId == null ? unassigned : byUser.get(Number(story.assigneeId));
        // an assignee who has since left the project still has work on the board
        if (!target) continue;
        target.stories += 1;
        target.points += story.estimate ?? 0;
        if (target.examples.length < 3) target.examples.push(storyBrief(story, projectId));
      }

      const remaining = (row) => Math.max(row.stories - row.examples.length, 0);

      return {
        project: project.title,
        projectId,
        totalOpenStories: open.length,
        people: [...byUser.entries()]
          .map(([userId, row]) => ({ userId, ...row, more: remaining(row) }))
          .sort((a, b) => b.points - a.points || b.stories - a.stories),
        unassigned: { ...unassigned, more: remaining(unassigned) },
      };
    },
  },
];
