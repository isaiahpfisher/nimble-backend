#!/usr/bin/env node
//
// Nimble MCP server.
//
// Exposes Nimble as MCP tools. It owns no database access — every tool is an
// HTTP call back to the Nimble REST API carrying a bearer token supplied
// through the environment, so the API's authorization rules apply unchanged:
// this server reaches exactly what the token's owner can reach.
//
// Run it directly for development:
//   NIMBLE_TOKEN=<token> NIMBLE_USER_ID=<id> npm run mcp
//
// In production the Express app spawns one per chat request with the calling
// user's own token.
//
// ---------------------------------------------------------------------------
// IMPORTANT: stdout is the MCP protocol channel. Never console.log() here —
// a stray write corrupts the JSON-RPC stream and the client disconnects.
// Use console.error() for diagnostics; stderr is free.
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.NIMBLE_API_URL ?? "http://localhost:3200/nimbleapi";
const TOKEN = process.env.NIMBLE_TOKEN;

// The API has no /users/me, so the token alone cannot say which user we are
// acting as. Only get_my_work needs it, and it says so plainly when missing.
const USER_ID = process.env.NIMBLE_USER_ID ? Number(process.env.NIMBLE_USER_ID) : null;

if (!TOKEN) {
  console.error("NIMBLE_TOKEN is required. Pass the bearer token of the user this server acts as.");
  process.exit(1);
}

// --- api -------------------------------------------------------------------

/**
 * Calls the Nimble REST API as the token's owner. Throws on any non-2xx so
 * tool bodies stay linear.
 */
async function api(path, { method = "GET", body } = {}) {
  const hasBody = body !== undefined;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(hasBody && { "Content-Type": "application/json" }),
    },
    ...(hasBody && { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON; keep the raw text */
  }

  if (!response.ok) {
    throw new Error(`${payload?.message ?? text ?? "Request failed"} (HTTP ${response.status})`);
  }
  return payload;
}

// --- shaping ---------------------------------------------------------------
// The REST API eager-loads generously — a story list carries every comment and
// acceptance criterion of every story. Fine for a web page, which drops what it
// does not render, but tool output is context the model re-reads on every later
// turn. Lists return summaries; get_story fetches depth on demand.
//
// Every row carries a `url`. The assistant links to things constantly and
// composing "/projects/<a>/stories/<b>" from two separate numbers is exactly
// the kind of thing a small model gets wrong, so the URL is handed to it
// already built and it only has to copy the string.

const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

const storyUrl = (projectId, storyId) => `/projects/${projectId}/stories/${storyId}`;

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
  };

  // names only when the endpoint eager-loaded them, so the model is never
  // shown a name that is really an id
  if (story.state) summary.state = story.state.name;
  if (story.type) summary.type = story.type.name;
  if (story.assignee) summary.assignee = fullName(story.assignee);
  if (Array.isArray(story.acceptanceCriteria)) summary.acceptanceCriteriaCount = story.acceptanceCriteria.length;
  if (Array.isArray(story.comment)) summary.commentCount = story.comment.length;

  return summary;
}

const sprintSummary = (sprint, projectId = sprint.projectId) => ({
  id: sprint.id,
  title: sprint.title,
  url: projectId == null ? null : `/projects/${projectId}/sprints/${sprint.id}`,
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
const MY_WORK_CAP = 10;

const capped = (stories) => ({
  matched: stories.length,
  showing: Math.min(stories.length, MY_WORK_CAP),
  truncated: stories.length > MY_WORK_CAP,
  stories: stories.slice(0, MY_WORK_CAP),
});

// --- tools -----------------------------------------------------------------
// One entry per tool. Descriptions matter more than you'd expect: they are the
// only thing the model uses to pick a tool, so say when to reach for it, not
// just what it returns.
//
// `write: true` marks a tool that changes something. Nothing sets it yet, but
// the flag is what the annotation and the assistant's own description of its
// abilities are derived from, so adding one is a single entry here.

const num = (description) => z.number().int().describe(description);

const TOOLS = [
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
    input: {},
    async run() {
      if (!USER_ID) throw new Error("This server was started without NIMBLE_USER_ID, so it cannot tell who 'me' is.");

      // whole project rows, so each project's own completedStateId comes with
      // them — every project defines "finished" for itself
      const projects = await api("/users/me/projects");
      const isMe = (value) => value != null && Number(value) === USER_ID;

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
                // board position, not an assignment, and gating on it hid
                // every review on every project that never configured one.
                assigned: isMe(story.assigneeId),
                reviewing: isMe(story.reviewerId),
                sprint: story.sprintId == null ? null : (titles.get(story.sprintId) ?? null),
                inActiveSprint: active.has(story.sprintId),
              }));
          } catch (err) {
            // one unreadable project should not sink the whole answer
            console.error(`[nimble-mcp] get_my_work skipped project ${project.id}: ${err.message}`);
            return [];
          }
        }),
      );

      const mine = perProject.flat().sort(byUrgency);

      // Two lists rather than one list with a role field. A single list left
      // the model to do the splitting, and it reliably got it wrong: it either
      // dropped the reviewer rows or filed stories it was merely assigned
      // under "waiting on your review". Splitting it here is not something it
      // can misread.
      const shape = ({ assigned, reviewing, ...story }, list) => ({
        ...story,
        ...(list === "reviewing" ? { alsoAssigned: assigned } : { alsoReviewing: reviewing }),
      });

      return {
        userId: USER_ID,
        assigned: capped(mine.filter((story) => story.assigned).map((s) => shape(s, "assigned"))),
        reviewing: capped(mine.filter((story) => story.reviewing).map((s) => shape(s, "reviewing"))),
      };
    },
  },

  {
    name: "list_my_projects",
    title: "List my projects",
    description:
      "Every project the current user belongs to, with id, title and url. Call this first whenever the " +
      "user names a project in words rather than by id, so you can resolve it to a project id.",
    input: {},
    async run() {
      const projects = await api("/users/me/projects");
      return projects.map(projectSummary);
    },
  },

  {
    name: "get_project",
    title: "Get a project",
    description:
      "A project's setup: workflow states, story types, members, repositories and sprints. Call this " +
      "before filtering or changing stories — it is where you learn which state, type, sprint and user " +
      "ids a project actually has. Those are per-project and can never be guessed.",
    input: { projectId: num("Id of the project to fetch.") },
    async run({ projectId }) {
      const project = await api(`/projects/${projectId}`);
      return {
        ...projectSummary(project),
        workflow: {
          completedStateId: project.completedStateId ?? null,
          branchCreationStateId: project.branchCreationStateId ?? null,
          prReviewStateId: project.prReviewStateId ?? null,
        },
        states: (project.storyState ?? [])
          .map((s) => ({ id: s.id, name: s.name, order: s.order }))
          .sort((a, b) => a.order - b.order),
        types: (project.storyType ?? []).map((t) => ({ id: t.id, name: t.name })),
        members: (project.projectMembers ?? []).map((m) => ({
          userId: m.userId,
          name: fullName(m.user),
          email: m.user?.email ?? null,
          isManager: m.isManager === "1" || m.isManager === "true",
        })),
        repositories: (project.repository ?? []).map((r) => ({ id: r.id, name: r.name })),
        sprints: (project.sprint ?? []).map((s) => sprintSummary(s, project.id)),
      };
    },
  },

  {
    name: "list_stories",
    title: "List stories in a project",
    description:
      "A project's stories as short summaries. Use this to survey a project, find stories matching a " +
      "description, or answer questions spanning several stories. Every filter is optional and they " +
      "combine with AND — prefer filtering here over listing everything and sifting it yourself. " +
      "Summaries omit description text, comment bodies and relations; call get_story for those. The " +
      "result reports `matched`, the total that passed the filters and the number to quote when asked " +
      "how many; `stories` may be shorter if you passed a limit.",
    input: {
      projectId: num("Id of the project to list stories for."),
      stateId: num("Only stories in this workflow state. Read state ids from get_project.").optional(),
      typeId: num("Only stories of this type. Read type ids from get_project.").optional(),
      assigneeId: num("Only stories assigned to this user. User ids come from get_project's members.").optional(),
      unassigned: z.boolean().optional().describe("Only stories with nobody assigned. Not valid with assigneeId."),
      sprintId: num("Only stories in this sprint. For stories in no sprint at all, use get_backlog.").optional(),
      search: z.string().optional().describe("Case-insensitive substring match on the story title."),
      limit: num("Return at most this many stories. `matched` still reports the full count.").min(1).max(200).optional(),
    },
    async run({ projectId, stateId, typeId, assigneeId, unassigned, sprintId, search, limit }) {
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
          (!needle || String(story.title ?? "").toLowerCase().includes(needle)),
      );

      return {
        matched: matches.length,
        stories: (limit === undefined ? matches : matches.slice(0, limit)).map((s) => storySummary(s, projectId)),
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
    input: {
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to fetch."),
    },
    async run({ projectId, storyId }) {
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
    input: { projectId: num("Id of the project whose backlog to read.") },
    async run({ projectId }) {
      const stories = await api(`/projects/${projectId}/backlog`);
      return { matched: stories.length, stories: stories.map((s) => storySummary(s, projectId)) };
    },
  },

  {
    name: "list_sprints",
    title: "List a project's sprints",
    description:
      "A project's sprints in date order, with title, goal, status (Planned, Active or Completed) and " +
      "dates. Use this to find the current sprint, or to resolve a sprint the user names in words into " +
      "an id. It does not include the stories in each sprint — use get_sprint for that.",
    input: { projectId: num("Id of the project whose sprints to list.") },
    async run({ projectId }) {
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
    input: { sprintId: num("Id of the sprint to fetch.") },
    async run({ sprintId }) {
      const sprint = await api(`/sprints/${sprintId}`);
      return {
        ...sprintSummary(sprint),
        stories: (sprint.story ?? []).map((s) => storySummary(s, sprint.projectId)),
      };
    },
  },

  {
    name: "get_story_activity",
    title: "Get a story's history",
    description:
      "The change history of one story, newest first: who changed what, when, and the before and after " +
      "values. Covers the story itself plus its acceptance criteria, comments and relations. Use this " +
      "for questions about what happened, when something moved, or who has been working on a story.",
    input: {
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story whose history to read."),
      limit: num("How many of the most recent entries to return.").min(1).max(100).default(30),
    },
    async run({ projectId, storyId, limit = 30 }) {
      const entries = await api(`/projects/${projectId}/stories/${storyId}/activity`);
      return entries.slice(0, limit).map((entry) => ({
        at: entry.createdAt,
        action: entry.action,
        subjectType: entry.subjectType,
        by: fullName(entry.user),
        changes: (entry.change ?? []).map((c) => ({ attribute: c.attribute, from: c.oldValue, to: c.newValue })),
        metadata: entry.metadata ?? null,
      }));
    },
  },
];

// --- start -----------------------------------------------------------------

const server = new McpServer({ name: "nimble", version: "0.1.0" });

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: !tool.write },
    },
    // A failure comes back as an isError result the model can read and react
    // to, rather than as a crashed server.
    async (args) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await tool.run(args ?? {}), null, 2) }] };
      } catch (err) {
        console.error(`[nimble-mcp] ${tool.name} failed: ${err.message}`);
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error(`[nimble-mcp] ready, talking to ${API_URL}`);
