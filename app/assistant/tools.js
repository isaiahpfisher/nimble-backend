// app/assistant/index.js builds an MCP server from this list and runTool is only ever reached through it

const { z } = require("zod");

const baseUrl = () => process.env.NIMBLE_API_URL || `http://localhost:${process.env.PORT || 3200}/nimbleapi`;

function apiClient(token, { url = baseUrl() } = {}) {
  return async function api(path, { method = "GET", body } = {}) {
    const hasBody = body !== undefined;

    let response;
    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(hasBody && { "Content-Type": "application/json" }),
        },
        ...(hasBody && { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new Error(`Could not reach Nimble's API at ${url} — is the backend running?`, { cause });
    }

    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {}

    if (!response.ok) {
      throw new Error(`${payload?.message ?? text ?? "Request failed"} (HTTP ${response.status})`);
    }

    return payload;
  };
}

// this section shapes a bunch of data
// our API endpoints eager load a lot of data
// much of that is wasted tokens in the model
// so we strip it down to just what the tools need

const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

const isManager = (member) => {
  const flag = member?.isManager;
  if (typeof flag === "boolean") return flag;
  return ["1", "true", "yes"].includes(
    String(flag ?? "")
      .trim()
      .toLowerCase(),
  );
};

const storySummary = (story, projectId = story.projectId) => ({
  id: story.id,
  title: story.title,
  projectId: projectId ?? null,
  state: story.state?.name ?? null,
  type: story.type?.name ?? null,
  priority: story.priority ?? null,
  estimate: story.estimate ?? null,
  sprintId: story.sprintId ?? null,
  assignee: story.assignee ? fullName(story.assignee) : null,
  assigneeId: story.assigneeId ?? null,
  reviewerId: story.reviewerId ?? null,
  completedAt: story.completedAt ?? null,
});

const sprintSummary = (sprint, projectId = sprint.projectId) => ({
  id: sprint.id,
  title: sprint.title,
  projectId: projectId ?? null,
  goal: sprint.goal ?? null,
  status: sprint.status,
  startDate: sprint.startDate,
  endDate: sprint.endDate,
});

const LIST_CAP = 10;
const capped = (rows, limit = LIST_CAP) => ({
  matched: rows.length,
  showing: Math.min(rows.length, limit),
  truncated: rows.length > limit,
  stories: rows.slice(0, limit),
});

// used to priortize work when a user asks what to work on
const PRIORITY_ORDER = new Map([
  ["Blocker", 0],
  ["High", 1],
  ["Medium", 2],
  ["Low", 3],
]);
const priorityRank = (priority) => PRIORITY_ORDER.get(priority) ?? 99;

const byUrgency = (a, b) => {
  if (a.inActiveSprint !== b.inActiveSprint) return a.inActiveSprint ? -1 : 1;
  return priorityRank(a.priority) - priorityRank(b.priority) || a.id - b.id;
};

const STORY_DESCRIPTION = "As a <who>, when I <when>, I want to <what>, so that <why>.";
const CRITERION_DESCRIPTION = "Given <starting state>, when <action>, then <observable result>.";
const PRIORITIES = ["Low", "Medium", "High", "Blocker"];

const DAY_MS = 1000 * 60 * 60 * 24;
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (from, to) => Math.round((new Date(to) - new Date(from)) / DAY_MS);

const isDone = (story, completedStateId = null) =>
  story.completedAt != null || (completedStateId != null && Number(story.stateId) === Number(completedStateId));

// same logic as burndown chart
function sprintProgress(sprint, stories, completedStateId, now = today()) {
  const points = (list) => list.reduce((total, story) => total + (story.estimate ?? 0), 0);
  const done = stories.filter((story) => isDone(story, completedStateId));

  const totalPoints = points(stories);
  const completedPoints = points(done);
  const totalDays = Math.max(dayDiff(sprint.startDate, sprint.endDate), 1);
  const elapsed = Math.min(Math.max(dayDiff(sprint.startDate, now), 0), totalDays);

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
    pointsBehindSchedule: remainingPoints - expectedRemaining,
    onTrack: remainingPoints <= expectedRemaining,
  };
}

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .trim();

/** Stories whose title, type or description mention every word of the query. */
function matchStories(stories, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return stories;

  return stories.filter((story) => {
    const haystack = normalize(
      `${story.title} ${story.type?.name ?? ""} ${String(story.description ?? "").replace(/<[^>]*>/g, " ")}`, // strip HTML tags out of rich-text descriptions
    );
    return words.every((word) => haystack.includes(word));
  });
}

// get the id of a status or type by name (or try to at least, throwing otherwise)
function resolveByName(query, rows, label) {
  const choices = rows.map((row) => row.name).join(", ") || "none defined";
  const wanted = normalize(query);

  const hit =
    rows.find((row) => normalize(row.name) === wanted) ?? rows.find((row) => normalize(row.name).includes(wanted));

  if (!hit) throw new Error(`This project has no ${label} called "${query}". Valid ${label}s: ${choices}.`);
  return hit;
}

const num = (description) => z.number().int().describe(description);
const str = (description) => z.string().describe(description);

const TOOLS = [
  {
    name: "get_projects",
    title: "Projects, teammates and managers",
    description:
      "The projects the current user belongs to, with the people on each one. This is the tool for " +
      '"who is my manager", "who is on my team", "what projects am I on" and for looking up a ' +
      "teammate's name or email. A person flagged `isYou` is the user you are talking to, so never " +
      "report them as their own manager. Managing a project is a permission, not a job title: a " +
      "project may have several managers or none.\n\n" +
      "Pass `projectId` to also get that project's workflow states, story types and sprints — you " +
      "need those ids before creating a story.",
    input: z.object({
      projectId: num("Only this project, with its full setup. Omit for all of them.").optional(),
    }),
    async run({ projectId }, { api, userId }) {
      const mine = await api("/users/me/projects");
      const wanted = projectId === undefined ? mine : mine.filter((row) => Number(row.id) === projectId);

      if (!wanted.length) {
        throw new Error(
          projectId === undefined
            ? "You do not belong to any project yet."
            : `You are not a member of project ${projectId}. Your projects are: ` +
                `${mine.map((row) => `${row.id} = ${row.title}`).join(", ") || "none"}.`,
        );
      }

      // Members live on the project detail endpoint, so each project costs a
      // call. One unreadable project should not sink the whole answer.
      const projects = (
        await Promise.all(
          wanted.map(async (row) => {
            try {
              const project = await api(`/projects/${row.id}`);

              return {
                id: project.id,
                title: project.title,
                deadline: project.deadline ?? null,
                people: (project.projectMembers ?? []).map((member) => ({
                  userId: member.userId,
                  name: fullName(member.user),
                  email: member.user?.email ?? null,
                  isManager: isManager(member),
                  isYou: userId != null && Number(member.userId) === Number(userId),
                })),
                // only when they asked about one project; on the "all projects"
                // answer this is several thousand tokens nobody asked for
                ...(projectId !== undefined && {
                  states: (project.storyState ?? []).map((s) => ({ id: s.id, name: s.name })),
                  types: (project.storyType ?? []).map((t) => ({ id: t.id, name: t.name })),
                  sprints: (project.sprint ?? []).map((s) => sprintSummary(s, project.id)),
                }),
              };
            } catch (err) {
              console.error(`[assistant] skipped project ${row.id}: ${err.message}`);
              return null;
            }
          }),
        )
      ).filter(Boolean);

      // each manager once, carrying what they manage, so "who is my manager" is
      // one list rather than a per-project table to be merged
      const managers = new Map();
      for (const project of projects) {
        for (const person of project.people) {
          if (!person.isManager) continue;
          const seen = managers.get(person.userId) ?? { ...person, manages: [] };
          seen.manages.push(project.title);
          managers.set(person.userId, seen);
        }
      }

      return { managers: [...managers.values()], projects };
    },
  },

  {
    name: "get_sprints",
    title: "Sprints and how they are going",
    description:
      "A project's sprints with their goals, start and end dates and status, plus how the active one " +
      'is actually going. This is the tool for "when does the sprint end", "how is the sprint going", ' +
      '"are we going to finish" and "what is left".\n\n' +
      "Progress is measured in points, the same way the burndown chart is, so a sprint with " +
      "unestimated stories is measured incompletely — `unestimatedStories` says how many, and you " +
      "should mention it when it is not zero. `pointsBehindSchedule` is negative when the sprint is " +
      "ahead of the straight line to zero. Pass `sprintId` for a specific sprint rather than the " +
      "active one.",
    input: z.object({
      projectId: num("Id of the project whose sprints you mean."),
      sprintId: num("A specific sprint. Omit for the active one, which is the usual case.").optional(),
    }),
    async run({ projectId, sprintId }, { api }) {
      const [sprints, project] = await Promise.all([
        api(`/projects/${projectId}/sprints`),
        api(`/projects/${projectId}`),
      ]);

      const all = sprints.map((sprint) => sprintSummary(sprint, projectId));
      const chosen =
        sprintId === undefined
          ? sprints.find((sprint) => sprint.status === "Active")
          : sprints.find((sprint) => Number(sprint.id) === sprintId);

      if (sprintId !== undefined && !chosen) {
        throw new Error(
          `Project ${projectId} has no sprint ${sprintId}. Its sprints are: ` +
            `${all.map((s) => `${s.id} = ${s.title}`).join(", ") || "none"}.`,
        );
      }

      // No active sprint is an ordinary state of affairs, not a failure: the
      // list still answers "when does the next one start".
      if (!chosen) return { sprints: all, active: null };

      const full = await api(`/sprints/${chosen.id}`);
      const stories = full.story ?? [];

      return {
        sprints: all,
        active: {
          ...sprintSummary(full, projectId),
          ...sprintProgress(full, stories, project.completedStateId),
          openStories: capped(
            stories
              .filter((story) => !isDone(story, project.completedStateId))
              .map((story) => storySummary(story, projectId)),
          ),
        },
      };
    },
  },

  {
    name: "get_my_work",
    title: "What I should work on",
    description:
      "The unfinished stories the current user is responsible for, across every project they belong " +
      'to, with active-sprint work first and higher priorities before lower. This is the tool for "what ' +
      'should I work on", "what is on my plate", "what am I doing this sprint" and "what needs my ' +
      'review". It takes no arguments and spans every project — do not assemble this answer yourself ' +
      "out of get_projects and find_stories.\n\n" +
      "The answer has two separate lists, because building a story and reviewing someone else's are " +
      "different jobs: `assigned` is what they are the assignee of, `reviewing` is what they are the " +
      "reviewer of. Never move a story from one list into the other. Each reports `matched` — the true " +
      "total, and the number to quote.",
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
              .filter((story) => !isDone(story, project.completedStateId))
              .map((story) => ({
                ...storySummary(story, project.id),
                project: project.title,
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
      // the model to do the splitting and it reliably got it wrong.
      return {
        userId,
        assigned: capped(mine.filter((story) => story.assigned)),
        reviewing: capped(mine.filter((story) => story.reviewing)),
      };
    },
  },

  {
    name: "find_stories",
    title: "Find stories in a project",
    description:
      "Stories in one project, optionally narrowed. `query` matches words against a story's title, " +
      'type and description, so search with the user\'s own words — "the login bug", "that CSV ' +
      'thing" — rather than making them quote a title. `state` is a workflow state by name, and ' +
      "`inSprint` false is the backlog.\n\n" +
      "Results are summaries and are capped: `matched` is the true total and the number to quote, and " +
      "`truncated` says when there were more. Never call a story the user's own unless they are " +
      "actually its assignee — a project's story list is the project's work, not theirs.",
    input: z.object({
      projectId: num("Id of the project to search."),
      query: str("Words to match, in the user's own phrasing. Omit to list everything.").optional(),
      state: str("Only stories in this workflow state, by name.").optional(),
      inSprint: z.boolean().optional().describe("true for sprint work only, false for the backlog."),
    }),
    async run({ projectId, query, state, inSprint }, { api }) {
      const [stories, project] = await Promise.all([
        api(`/projects/${projectId}/stories`),
        api(`/projects/${projectId}`),
      ]);

      let rows = matchStories(stories, query);

      if (state !== undefined) {
        const wanted = resolveByName(state, project.storyState ?? [], "state");
        rows = rows.filter((story) => Number(story.stateId) === Number(wanted.id));
      }
      if (inSprint !== undefined) {
        rows = rows.filter((story) => (story.sprintId != null) === inSprint);
      }

      return capped(rows.map((story) => storySummary(story, projectId)));
    },
  },

  {
    name: "get_story",
    title: "Get one story in full",
    description:
      "One story with everything on it: description, acceptance criteria, comments, assignee and " +
      "reviewer. Use this when the user asks about a specific story you already have the id for, and " +
      "before adding criteria to it so you do not restate one it already has.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to fetch."),
    }),
    async run({ projectId, storyId }, { api }) {
      const story = await api(`/projects/${projectId}/stories/${storyId}`);

      return {
        ...storySummary(story, projectId),
        description: story.description ?? null,
        reporter: fullName(story.reporter),
        reviewer: fullName(story.reviewer),
        acceptanceCriteria: (story.acceptanceCriteria ?? []).map((criterion) => ({
          id: criterion.id,
          title: criterion.title,
          description: criterion.description,
          status: criterion.status,
        })),
        comments: (story.comment ?? []).map((comment) => ({
          by: fullName(comment.user),
          at: comment.createdAt,
          content: comment.content,
        })),
      };
    },
  },

  // --- writes --------------------------------------------------------------
  // There is deliberately nothing here that deletes or edits. The assistant
  // creates; a person does the removing and the amending.

  {
    name: "create_story",
    title: "Create a story",
    write: true,
    description:
      "Create a new story in a project. Only `projectId`, `title` and `description` are needed — " +
      "everything else has a sensible default, so do not hold up a straightforward request to collect " +
      "it.\n\n" +
      `You write the description, as a user story — "${STORY_DESCRIPTION}" — since that is the shape ` +
      "this team writes them in. Never repeat the title back as the description. Send the user's own " +
      "wording only when they dictated it.\n\n" +
      "The story starts in the first column of the project's board. `type` and `state` are names, not " +
      "ids, and are checked against the project. Leave a field out rather than filling it with a " +
      "guess: an invented estimate is worse than an empty one.",
    input: z.object({
      projectId: num("Id of the project to create the story in."),
      title: str("Short title, in the user's own wording where you can."),
      description: str(
        `The user story, written as "${STORY_DESCRIPTION}" — fill in all four parts. Write it ` +
          "yourself rather than repeating the title.",
      ),
      type: str("Story type by name, from get_projects. Omit to leave it unset.").optional(),
      state: str("Workflow state to start in, by name. Omit for the project's first column.").optional(),
      priority: z.enum(PRIORITIES).optional().describe("Low, Medium, High or Blocker."),
      estimate: num("Estimate in points. Omit unless the user gave one.").optional(),
      sprintId: num("Sprint to put it in. Omit to leave it in the backlog.").optional(),
    }),
    async run({ projectId, title, description, type, state, priority, estimate, sprintId }, { api }) {
      const project = await api(`/projects/${projectId}`);
      const states = [...(project.storyState ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      if (!states.length) {
        throw new Error(`Project ${projectId} has no workflow states, so a story cannot be created.`);
      }

      const defaulted = [];
      let stateId;

      if (state === undefined) {
        stateId = states[0].id;
        defaulted.push(`state ${states[0].name}`);
      } else {
        stateId = resolveByName(state, states, "state").id;
      }

      const body = { title, description, stateId };

      if (type !== undefined) body.typeId = resolveByName(type, project.storyType ?? [], "type").id;
      if (priority !== undefined) body.priority = priority;
      if (estimate !== undefined) body.estimate = estimate;

      if (sprintId !== undefined) {
        if (!(project.sprint ?? []).some((sprint) => Number(sprint.id) === sprintId)) {
          throw new Error(
            `Sprint ${sprintId} does not belong to project ${projectId}. Its sprints are: ` +
              `${(project.sprint ?? []).map((s) => `${s.id} = ${s.title}`).join(", ") || "none"}.`,
          );
        }
        body.sprintId = sprintId;
      }

      const story = await api(`/projects/${projectId}/stories`, { method: "POST", body });

      return { created: "story", defaulted, ...storySummary(story, projectId) };
    },
  },

  {
    name: "add_acceptance_criteria",
    title: "Add acceptance criteria to a story",
    write: true,
    description:
      "Add acceptance criteria to a story — one, or a whole set in a single call. Each is a single " +
      `Given/When/Then — "${CRITERION_DESCRIPTION}" — rather than several conditions folded together ` +
      'with "and"; a story worth spelling out usually needs three to six, covering the ordinary path ' +
      "and the ways it can realistically fail. You write them; send the user's own wording only where " +
      "they spelled a criterion out themselves. New criteria are Pending.\n\n" +
      "Call get_story first and do not restate a criterion it already has. Behind this call they are " +
      "saved one at a time, so a later one can fail after earlier ones landed: `criteria` is what was " +
      "created and `failed` is what was not. Check `failed` before telling the user the story is " +
      "covered.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to add the criteria to."),
      criteria: z
        .array(
          z.object({
            title: str("Short label for the criterion, not the sentence repeated."),
            description: str(`What has to be true for it to pass, written as "${CRITERION_DESCRIPTION}".`),
          }),
        )
        .min(1)
        .max(20)
        .describe("The criteria to add, in the order they should appear on the story."),
    }),
    async run({ projectId, storyId, criteria }, { api }) {
      const created = [];
      const failed = [];

      // Sequentially, not in parallel: these land in the story's activity feed
      // and share an order column, and firing twenty POSTs at once scrambles
      // both for no gain worth having.
      for (const criterion of criteria) {
        try {
          const saved = await api(`/projects/${projectId}/stories/${storyId}/acceptanceCriteria`, {
            method: "POST",
            body: { ...criterion, status: "Pending" },
          });
          created.push({ id: saved.id, title: saved.title, status: saved.status });
        } catch (err) {
          failed.push({ title: criterion.title, error: err.message });
        }
      }

      // Nothing saved is a failure, not a result with an empty list — the
      // difference decides whether the model reports success.
      if (!created.length) {
        throw new Error(`No acceptance criteria were added. ${failed[0]?.error ?? ""}`.trim());
      }

      return { created: "acceptanceCriteria", count: created.length, criteria: created, failed };
    },
  },
];

// map of all tools, keyed by name
const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

// remove wasted tokens from the Zod schemas
const SAFE = Number.MAX_SAFE_INTEGER;
function tidySchema(node) {
  if (Array.isArray(node)) return node.map(tidySchema);
  if (!node || typeof node !== "object") return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if (key === "minimum" && value === -SAFE) continue;
    if (key === "maximum" && value === SAFE) continue;
    out[key] = tidySchema(value);
  }
  return out;
}

let specs = null;

/** converts list of tools to format the model wants to choose a tool */
function toolSpecs() {
  specs ??= TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tidySchema(z.toJSONSchema(tool.input, { io: "input" })),
    write: Boolean(tool.write),
  }));

  return specs;
}

async function runTool(name, args, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { ok: false, error: `There is no tool called "${name}". Available: ${[...BY_NAME.keys()].join(", ")}.` };
  }

  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    const detail = (parsed.error.issues ?? [])
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
      .join("; ");

    return { ok: false, error: `Invalid arguments for ${name} — ${detail}.` };
  }

  try {
    return { ok: true, result: await tool.run(parsed.data, ctx) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  TOOLS,
  toolSpecs,
  runTool,
  tidySchema,
  apiClient,
  sprintProgress,
  matchStories,
  resolveByName,
  capped,
  storySummary,
  isManager,
  isDone,
  byUrgency,
  STORY_DESCRIPTION,
  CRITERION_DESCRIPTION,
  PRIORITIES,
  LIST_CAP,
};
