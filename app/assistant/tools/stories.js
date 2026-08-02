// Stories: reading them, creating them, and changing them.
//
// Every write checks its per-project references before it goes anywhere near
// the API. A model that guesses a state id otherwise produces a foreign-key
// error that says nothing useful; refusing with the actual choices is what lets
// the assistant either correct itself or put a real question to the user
// instead of writing something wrong.

const { z } = require("zod");
const {
  PRIORITIES,
  STORY_DESCRIPTION,
  defined,
  firstState,
  listChoices,
  resolvePerson,
  resolveState,
} = require("../rules");
const { fullName, projectMembers, storySummary, storyUrl } = require("../shape");

const num = (description) => z.number().int().describe(description);
const str = (description) => z.string().describe(description);

/**
 * Checks every per-project reference a story write mentions, and returns the
 * project so the caller can read its defaults off the same copy.
 *
 * Names arrive as `assignee`/`reviewer` and leave as ids, resolved against this
 * project on the same copy the validation uses — so the model never has to know
 * that a person has both a user id and a membership row id, which is the mix-up
 * that produced "there is no Erin Engineer in this project" directly above a
 * list containing Erin Engineer.
 *
 * Every problem is reported at once, so a wrong state and a wrong assignee take
 * one correction rather than two round trips.
 */
async function resolveStoryFields(projectId, input, { api, userId }) {
  const project = await api(`/projects/${projectId}`);
  const members = projectMembers(project);
  const fields = { ...input };
  const problems = [];

  for (const [name, idField] of [
    ["assignee", "assigneeId"],
    ["reviewer", "reviewerId"],
  ]) {
    if (fields[name] === undefined) continue;
    fields[idField] = resolvePerson(fields[name], members, { meId: userId }).userId;
    delete fields[name];
  }

  // states resolve the same way, and for the same reason
  if (fields.state !== undefined) {
    fields.stateId = resolveState(fields.state, project.storyState ?? []).stateId;
    delete fields.state;
  }

  const oneOf = (value, rows, field, label) => {
    if (value === undefined || value === null) return;
    if (!rows.some((row) => Number(row.id) === Number(value))) {
      problems.push(
        `${field} ${value} does not exist in project ${projectId}. Valid ${label}: ${listChoices(rows)}.`,
      );
    }
  };

  oneOf(fields.stateId, project.storyState ?? [], "stateId", "states");
  oneOf(fields.typeId, project.storyType ?? [], "typeId", "types");
  oneOf(
    fields.sprintId,
    (project.sprint ?? []).map((s) => ({ id: s.id, name: s.title })),
    "sprintId",
    "sprints",
  );
  oneOf(fields.repositoryId, project.repository ?? [], "repositoryId", "repositories");
  oneOf(fields.assigneeId, members, "assigneeId", "members");
  oneOf(fields.reviewerId, members, "reviewerId", "members");

  if (fields.priority != null && !PRIORITIES.includes(fields.priority)) {
    problems.push(`priority "${fields.priority}" is not valid. Use one of: ${PRIORITIES.join(", ")}.`);
  }

  if (problems.length) throw new Error(problems.join(" "));

  return { project, fields };
}

// A story write names people rather than numbering them: a name is what the
// user said, while an id is something the model would have to look up and then
// not mix up. The id fields stay for the case where it already has a verified
// one, and resolveStoryFields checks either against the project's members.
const personIds = {
  assigneeId: num("Assignee as a user id, if you already have a verified one. Prefer `assignee`.")
    .nullable()
    .optional(),
  reviewerId: num("Reviewer as a user id. Prefer `reviewer`.").nullable().optional(),
};

module.exports = [
  {
    name: "list_stories",
    title: "List stories in a project",
    description:
      "A project's stories as short summaries, filtered exactly. Use this to survey a project or answer " +
      "questions spanning several stories — not to hunt for one the user described in their own words, " +
      "which is what find_story is for. Every filter is optional and they combine with AND; prefer " +
      "filtering here over listing everything and sifting it yourself. Summaries omit description text, " +
      "comment bodies and relations; call get_story for those. The result reports `matched`, the total " +
      "that passed the filters and the number to quote when asked how many; `stories` may be shorter if " +
      "you passed a limit.",
    input: z.object({
      projectId: num("Id of the project to list stories for."),
      stateId: num("Only stories in this workflow state. Read state ids from get_project.").optional(),
      typeId: num("Only stories of this type. Read type ids from get_project.").optional(),
      assigneeId: num("Only stories assigned to this user. User ids come from get_project's members.").optional(),
      unassigned: z.boolean().optional().describe("Only stories with nobody assigned. Not valid with assigneeId."),
      unestimated: z.boolean().optional().describe("Only stories with no estimate. For grooming questions."),
      sprintId: num("Only stories in this sprint. For stories in no sprint at all, use get_backlog.").optional(),
      search: z
        .string()
        .optional()
        .describe(
          'Exact case-insensitive substring of the title, nothing cleverer — "login bug" will not match ' +
            '"Fix the login page". For anything the user described loosely, use find_story instead.',
        ),
      limit: num("Return at most this many stories. `matched` still reports the full count.")
        .min(1)
        .max(200)
        .optional(),
    }),
    async run(
      { projectId, stateId, typeId, assigneeId, unassigned, unestimated, sprintId, search, limit },
      { api },
    ) {
      // these two would silently cancel out, so say so rather than return []
      if (unassigned && assigneeId !== undefined) {
        throw new Error("Pass either assigneeId or unassigned, not both — they contradict each other.");
      }

      // the REST API takes no query parameters, so filtering happens here; the
      // saving is in what goes back to the model, not in what is fetched
      const stories = await api(`/projects/${projectId}/stories`);
      const needle = search?.trim().toLowerCase();

      const matches = stories.filter(
        (story) =>
          (stateId === undefined || Number(story.stateId) === stateId) &&
          (typeId === undefined || Number(story.typeId) === typeId) &&
          (sprintId === undefined || Number(story.sprintId) === sprintId) &&
          (assigneeId === undefined || Number(story.assigneeId) === assigneeId) &&
          (!unassigned || story.assigneeId == null) &&
          (!unestimated || story.estimate == null) &&
          (!needle || String(story.title ?? "").toLowerCase().includes(needle)),
      );

      return {
        matched: matches.length,
        stories: (limit === undefined ? matches : matches.slice(0, limit)).map((s) =>
          storySummary(s, projectId),
        ),
      };
    },
  },

  {
    name: "get_story",
    title: "Get a story",
    description:
      "One story in full: state, type, sprint, repository, reporter, assignee, reviewer, acceptance " +
      "criteria, comments and relations to other stories. Use this when the user asks about a specific " +
      "story and you already know its id.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to fetch."),
    }),
    async run({ projectId, storyId }, { api }) {
      const story = await api(`/projects/${projectId}/stories/${storyId}`);
      return { ...story, url: storyUrl(projectId, storyId) };
    },
  },

  {
    name: "get_backlog",
    title: "Get a project's backlog",
    description:
      "The stories in a project that are in no sprint, as summaries. Use this for backlog grooming, " +
      "sprint planning, or when the user asks what work is unscheduled. It is not filtered by state — " +
      "states are user-defined, so 'not in a sprint' is all backlog means here.",
    input: z.object({ projectId: num("Id of the project whose backlog to read.") }),
    async run({ projectId }, { api }) {
      const stories = await api(`/projects/${projectId}/backlog`);
      return { matched: stories.length, stories: stories.map((s) => storySummary(s, projectId)) };
    },
  },

  {
    name: "get_story_activity",
    title: "Get a story's history",
    description:
      "The change history of one story, newest first: who changed what, when, and the before and after " +
      "values. Covers the story itself plus its acceptance criteria, comments and relations. Use this " +
      "for questions about what happened, when something moved, or who has been working on a story.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story whose history to read."),
      limit: num("How many of the most recent entries to return.").min(1).max(100).default(30),
    }),
    async run({ projectId, storyId, limit }, { api }) {
      const entries = await api(`/projects/${projectId}/stories/${storyId}/activity`);

      return entries.slice(0, limit).map((entry) => ({
        at: entry.createdAt,
        action: entry.action,
        subjectType: entry.subjectType,
        by: fullName(entry.user),
        changes: (entry.change ?? []).map((c) => ({
          attribute: c.attribute,
          from: c.oldValue,
          to: c.newValue,
        })),
        metadata: entry.metadata ?? null,
      }));
    },
  },

  // --- writes --------------------------------------------------------------
  // There is deliberately nothing here that deletes. The assistant can create
  // and amend; a person does the removing.

  {
    name: "create_story",
    title: "Create a story",
    write: true,
    description:
      "Create a new story in a project. Only `projectId` and `title` are needed — a story you cannot " +
      "name is not a story yet, but everything else has a sensible default and you should not hold up a " +
      "straightforward request to collect it.\n\n" +
      `You write the description, as a user story — "${STORY_DESCRIPTION}" — since that is the shape ` +
      "this team writes them in; send the user's own wording only when they dictated it. Left out, " +
      "`stateId` becomes the first column of the project's board. The result lists what was defaulted " +
      "under `defaulted`; mention those briefly so the user can refine them.\n\n" +
      "Do still ask when the user's intent is genuinely unclear, when they plainly meant to describe the " +
      "work and you would be putting words in their mouth, or when they care about a field they have not " +
      "given you. Ids are per-project: read them from get_project, since this tool refuses ids that do " +
      "not belong to the project.",
    input: z.object({
      projectId: num("Id of the project to create the story in."),
      title: str("Short title. Use the user's own wording where you can."),
      description: str(
        `The user story, written as "${STORY_DESCRIPTION}" — fill in all four parts. Required: ` +
          "write it yourself rather than repeating the title. If the user dictated a description, " +
          "send theirs exactly as they wrote it instead.",
      ),
      state: str('Workflow state to start in, by name. Omit for the project\'s first state.').optional(),
      stateId: num("Workflow state as an id, if you already have a verified one. Prefer `state`.").optional(),
      typeId: num("Story type, from get_project.").optional(),
      priority: z.enum(PRIORITIES).optional().describe("Low, Medium, High or Blocker."),
      estimate: num("Estimate in points.").optional(),
      sprintId: num("Sprint to put it in. Omit to leave it in the backlog.").optional(),
      repositoryId: num("Repository it belongs to, from get_project.").optional(),
      assignee: str('Who to assign it to, by name — "Erin", "Erin Engineer" or "me".').optional(),
      reviewer: str("Who should review it, by name.").optional(),
      ...personIds,
    }),
    async run({ projectId, ...input }, ctx) {
      // resolveStoryFields already fetches the project, and the defaults are
      // read off the same copy rather than costing another round trip
      const { project, fields } = await resolveStoryFields(projectId, input, ctx);
      const defaulted = [];

      if (fields.stateId === undefined) {
        fields.stateId = firstState(project).id;
        defaulted.push("stateId");
      }

      const story = await ctx.api(`/projects/${projectId}/stories`, {
        method: "POST",
        body: defined(fields),
      });

      return { created: "story", defaulted, ...storySummary(story, projectId) };
    },
  },

  {
    name: "update_story",
    title: "Update a story",
    write: true,
    description:
      "Change one or more fields on an existing story: move it between states or sprints, reassign it, " +
      "reprioritise it, re-estimate it, or edit its title or description. Only the fields you pass are " +
      "touched; everything else is left alone, so never send a field back just to keep its current " +
      "value.\n\n" +
      "Ids are per-project — read them from get_project rather than guessing, and this tool will refuse " +
      "any that do not belong to the project. To take an assignee or reviewer off a story, pass null. " +
      "If you are not certain which story the user means, look it up and confirm before changing it.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to change."),
      title: str("New title.").optional(),
      description: str(
        `New description, written as "${STORY_DESCRIPTION}" — unless the user dictated the new ` +
          "wording, in which case send theirs exactly as they wrote it.",
      ).optional(),
      state: str(
        'Move it to this workflow state, by name — "Doing", "in review", "done". When the state is the ' +
          "only thing changing, use set_story_state instead.",
      ).optional(),
      stateId: num("Workflow state as an id, if you already have a verified one. Prefer `state`.").optional(),
      typeId: num("Change the type, from get_project.").optional(),
      priority: z.enum(PRIORITIES).optional().describe("Low, Medium, High or Blocker."),
      estimate: num("New estimate in points.").optional(),
      sprintId: num("Move into this sprint; null moves it back to the backlog.").nullable().optional(),
      repositoryId: num("Set the repository; null clears it.").nullable().optional(),
      assignee: str('Reassign by name — "Erin", "Erin Engineer", "me", or "nobody" to unassign.').optional(),
      reviewer: str('Set the reviewer by name, or "nobody" to clear it.').optional(),
      ...personIds,
    }),
    async run({ projectId, storyId, ...input }, ctx) {
      if (Object.keys(defined(input)).length === 0) {
        throw new Error("No fields to update — say which fields should change.");
      }

      const { fields } = await resolveStoryFields(projectId, defined(input), ctx);
      const changes = defined(fields);

      const story = await ctx.api(`/projects/${projectId}/stories/${storyId}`, {
        method: "PUT",
        body: changes,
      });

      return { updated: "story", changed: Object.keys(changes), ...storySummary(story, projectId) };
    },
  },

  {
    name: "set_story_state",
    title: "Move a story to a different state",
    write: true,
    description:
      'Move one story to a different column of the project\'s board. This is the tool for "mark it done", ' +
      '"move it to Doing", "put it back in review" — anything where the state is what changes.\n\n' +
      "Name the state the way the user said it and this tool matches it against that project's own board, " +
      "allowing for case, spacing and near-misses. Do not look up a state id for this and never guess " +
      "one: states are defined per project, so an id from anywhere else is wrong. If the name matches " +
      "nothing, or two states equally, it comes back with that project's real states — offer those " +
      "rather than retrying.\n\n" +
      "Use update_story instead when other fields change at the same time. Moving a story into the " +
      "project's completed state is what marks it finished; Nimble records the date itself.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to move."),
      state: str('The state to move it to, by name — "Doing", "In Review", "done". Never an id.'),
    }),
    async run({ projectId, storyId, state }, { api }) {
      const project = await api(`/projects/${projectId}`);
      const states = project.storyState ?? [];
      const { stateId } = resolveState(state, states);

      const story = await api(`/projects/${projectId}/stories/${storyId}`, {
        method: "PUT",
        body: { stateId },
      });

      return {
        updated: "story",
        changed: ["stateId"],
        ...storySummary(story, projectId),
        // the resolved name, so the reply can say where it landed rather than
        // echoing back the words the user happened to use
        state: states.find((row) => Number(row.id) === stateId)?.name ?? null,
      };
    },
  },

  {
    name: "move_stories_to_sprint",
    title: "Move several stories into a sprint",
    write: true,
    description:
      "Move a batch of stories into one sprint, or out to the backlog with `sprintId: null`. This is the " +
      "tool for sprint planning — \"pull the top three backlog items in\", \"push what is left to next " +
      'sprint" — and it is much better than calling update_story once per story.\n\n' +
      "Moving work in or out of a sprint changes what the team has committed to, so confirm the list " +
      "with the user before calling unless they named the stories themselves. Every story is reported " +
      "back individually: a batch can partly succeed.",
    input: z.object({
      projectId: num("Id of the project the stories belong to."),
      storyIds: z.array(z.number().int()).min(1).max(50).describe("Ids of the stories to move."),
      sprintId: num("Sprint to move them into, or null for the backlog.").nullable(),
    }),
    async run({ projectId, storyIds, sprintId }, ctx) {
      await resolveStoryFields(projectId, { sprintId }, ctx);

      const unique = [...new Set(storyIds)];
      const results = [];

      // sequential on purpose: the API records an activity entry per change,
      // and firing fifty parallel writes at it is a good way to find out how
      // the connection pool behaves under load
      for (const storyId of unique) {
        try {
          const story = await ctx.api(`/projects/${projectId}/stories/${storyId}`, {
            method: "PUT",
            body: { sprintId },
          });
          results.push({ ok: true, ...storySummary(story, projectId) });
        } catch (err) {
          results.push({ ok: false, storyId, error: err.message });
        }
      }

      const moved = results.filter((row) => row.ok);

      return {
        updated: "stories",
        sprintId,
        requested: unique.length,
        moved: moved.length,
        failed: results.length - moved.length,
        stories: results,
      };
    },
  },
];
