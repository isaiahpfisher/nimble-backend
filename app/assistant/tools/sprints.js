// Sprints: listing them, reading how one is going, and scheduling them.

const { z } = require("zod");
const {
  RECURRENCE_PATTERNS,
  SPRINT_STATUSES,
  addDays,
  checkDate,
  checkDateRange,
  defined,
  sprintProgress,
  today,
  usualSprintLength,
} = require("../rules");
const { capped, sprintSummary, storySummary } = require("../shape");

const num = (description) => z.number().int().describe(description);
const str = (description) => z.string().describe(description);

module.exports = [
  {
    name: "list_sprints",
    title: "List a project's sprints",
    description:
      "A project's sprints in date order, with title, goal, status (Planned, Active or Completed) and " +
      "dates. Use this to find the current sprint, or to resolve a sprint the user names in words into " +
      "an id. It does not include the stories in each sprint — use get_sprint for that.",
    input: z.object({ projectId: num("Id of the project whose sprints to list.") }),
    async run({ projectId }, { api }) {
      const sprints = await api(`/projects/${projectId}/sprints`);
      return sprints.map((s) => sprintSummary(s, projectId));
    },
  },

  {
    name: "get_sprint",
    title: "Get a sprint with its stories",
    description:
      "One sprint together with summaries of the stories in it. Use this for questions about sprint " +
      "scope, progress or workload. The story rows carry state and type ids but not their names — call " +
      "get_project once if you need to translate those.",
    input: z.object({ sprintId: num("Id of the sprint to fetch.") }),
    async run({ sprintId }, { api }) {
      const sprint = await api(`/sprints/${sprintId}`);
      return {
        ...sprintSummary(sprint),
        stories: (sprint.story ?? []).map((s) => storySummary(s, sprint.projectId)),
      };
    },
  },

  {
    name: "get_sprint_progress",
    title: "How a sprint is going",
    description:
      "Where a sprint actually stands: points done and remaining, how far through the sprint it is, and " +
      'whether that is ahead of or behind the straight line to zero. This is the tool for "how is the ' +
      'sprint going", "are we going to finish", "how much is left" and "what is still open".\n\n' +
      "Progress is measured in points, the same way the burndown chart is, so a sprint with unestimated " +
      "stories is measured incompletely — `unestimatedStories` says how many, and you should mention it " +
      "when it is not zero. `pointsBehindSchedule` is negative when the sprint is ahead.",
    input: z.object({ sprintId: num("Id of the sprint, from list_sprints.") }),
    async run({ sprintId }, { api }) {
      const sprint = await api(`/sprints/${sprintId}`);
      const stories = sprint.story ?? [];
      const project = await api(`/projects/${sprint.projectId}`);

      const stateNames = new Map((project.storyState ?? []).map((s) => [Number(s.id), s.name]));
      const byState = {};
      for (const story of stories) {
        const name = stateNames.get(Number(story.stateId)) ?? `state ${story.stateId}`;
        byState[name] = (byState[name] ?? 0) + 1;
      }

      const open = stories
        .filter(
          (story) =>
            story.completedAt == null &&
            Number(story.stateId) !== Number(project.completedStateId),
        )
        .sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0));

      return {
        ...sprintSummary(sprint, sprint.projectId),
        ...sprintProgress({
          sprint,
          stories,
          completedStateId: project.completedStateId,
          today: today(),
        }),
        byState,
        openStories: capped(open.map((story) => storySummary(story, sprint.projectId))),
      };
    },
  },

  // --- writes --------------------------------------------------------------

  {
    name: "create_sprint",
    title: "Create a sprint",
    write: true,
    description:
      "Create a sprint in a project. Dates are plain YYYY-MM-DD. Leave out `endDate` and the sprint runs " +
      "for however long this project's sprints usually run, taken from its most recent one. A new sprint " +
      "is Planned unless you say otherwise — never make one Active without being asked, since a project " +
      "is meant to have one active sprint at a time.\n\n" +
      "`startDate` is the one thing worth asking about: when a sprint begins is a scheduling decision, " +
      "not a default. The result lists anything defaulted under `defaulted`.",
    input: z.object({
      projectId: num("Id of the project the sprint belongs to."),
      title: str("Name of the sprint."),
      startDate: str("First day, as YYYY-MM-DD."),
      endDate: str("Last day, as YYYY-MM-DD. Omit to use the project's usual sprint length.").optional(),
      goal: str("What the sprint is for.").optional(),
      status: z.enum(SPRINT_STATUSES).default("Planned").describe("Planned, Active or Completed."),
    }),
    async run({ projectId, title, startDate, endDate, goal, status }, { api }) {
      const defaulted = [];

      if (endDate === undefined) {
        // before addDays, or a startDate like "next monday" becomes an
        // Invalid Date and throws something the model cannot act on
        checkDate(startDate, "startDate");
        endDate = addDays(startDate, usualSprintLength(await api(`/projects/${projectId}/sprints`)));
        defaulted.push("endDate");
      }

      checkDateRange(startDate, endDate);

      const sprint = await api("/sprints", {
        method: "POST",
        body: defined({ projectId, title, startDate, endDate, goal, status }),
      });

      return { created: "sprint", defaulted, ...sprintSummary(sprint, projectId) };
    },
  },

  {
    name: "update_sprint",
    title: "Update a sprint",
    write: true,
    description:
      "Change a sprint's title, goal, dates or status — this is the tool for starting a sprint (status " +
      "Active) or closing one (Completed). Only the fields you pass are touched. A sprint cannot be " +
      "moved to another project. Starting or closing a sprint affects everyone on the project, so " +
      "confirm with the user before doing it.",
    input: z.object({
      sprintId: num("Id of the sprint to change, from list_sprints."),
      title: str("New name.").optional(),
      goal: str("New goal.").optional(),
      startDate: str("New first day, as YYYY-MM-DD.").optional(),
      endDate: str("New last day, as YYYY-MM-DD.").optional(),
      status: z.enum(SPRINT_STATUSES).optional().describe("Planned, Active or Completed."),
    }),
    async run({ sprintId, ...input }, { api }) {
      const changes = defined(input);
      if (Object.keys(changes).length === 0) {
        throw new Error("No fields to update — say what should change about the sprint.");
      }

      const current = await api(`/sprints/${sprintId}`);
      checkDateRange(changes.startDate ?? current.startDate, changes.endDate ?? current.endDate);

      const sprint = await api(`/sprints/${sprintId}`, { method: "PUT", body: changes });

      return { updated: "sprint", changed: Object.keys(changes), ...sprintSummary(sprint, sprint.projectId) };
    },
  },

  {
    name: "create_recurring_sprints",
    title: "Create a run of sprints",
    write: true,
    description:
      'Create several evenly spaced sprints in one go — "set up sprints through the end of the ' +
      'quarter", "schedule the next six two-week sprints". The dates you give describe the FIRST ' +
      "sprint; the rest follow at the chosen interval, and each is numbered after the title you give.\n\n" +
      "This creates many records at once, so confirm the count and the starting date with the user " +
      "before calling. Use create_sprint for a single one.",
    input: z.object({
      projectId: num("Id of the project."),
      title: str("Base name; the sprints are numbered from it."),
      startDate: str("First day of the FIRST sprint, as YYYY-MM-DD."),
      endDate: str("Last day of the FIRST sprint, as YYYY-MM-DD. Omit for the project's usual length.").optional(),
      recurrencePattern: z.enum(RECURRENCE_PATTERNS).describe("Weekly, Biweekly or Monthly."),
      recurrenceCount: num("How many sprints to create, at least 2.").min(2).max(26),
      goal: str("Goal applied to each sprint.").optional(),
    }),
    async run({ projectId, title, startDate, endDate, recurrencePattern, recurrenceCount, goal }, { api }) {
      if (endDate === undefined) {
        checkDate(startDate, "startDate");
        endDate = addDays(startDate, usualSprintLength(await api(`/projects/${projectId}/sprints`)));
      }
      checkDateRange(startDate, endDate);

      const created = await api("/sprints/recurring", {
        method: "POST",
        body: defined({ projectId, title, startDate, endDate, recurrencePattern, recurrenceCount, goal }),
      });

      const sprints = Array.isArray(created) ? created : (created?.sprints ?? []);

      return {
        created: "sprints",
        count: sprints.length || recurrenceCount,
        sprints: sprints.map((sprint) => sprintSummary(sprint, projectId)),
      };
    },
  },
];
