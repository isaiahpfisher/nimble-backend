#!/usr/bin/env node
//
// Nimble MCP server.
//
// Exposes Nimble as MCP tools. It owns no database access of its own — every
// tool is an HTTP call back to the Nimble REST API, carrying a bearer token
// supplied through the environment. That means the API's authorization rules
// apply unchanged: the server can only reach what the token's owner can reach.
//
// Run it directly for development:
//   NIMBLE_TOKEN=<token> npm run mcp
//
// In production the Express app spawns one of these per chat request with the
// calling user's own token, so tools inherit that user's project memberships.
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

if (!TOKEN) {
  console.error("NIMBLE_TOKEN is required. Pass the bearer token of the user this server acts as.");
  process.exit(1);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Calls the Nimble REST API as the token's owner.
 * Throws ApiError on any non-2xx so tool handlers can stay linear.
 */
async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = (payload && payload.message) || `Request failed with ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return payload;
}

/**
 * Wraps a tool implementation so it returns MCP content blocks, and so a
 * refusal from the API comes back as a readable tool error rather than a
 * crashed server. The model can see `isError` results and react to them.
 */
function handler(fn) {
  return async (args) => {
    try {
      const data = await fn(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      const detail = err instanceof ApiError ? `${err.message} (HTTP ${err.status})` : err.message;
      console.error(`[nimble-mcp] tool failed: ${detail}`);
      return {
        content: [{ type: "text", text: detail }],
        isError: true,
      };
    }
  };
}

const server = new McpServer({
  name: "nimble",
  version: "0.1.0",
});

// --- shaping ---------------------------------------------------------------
// The REST API eager-loads generously — a story list carries every comment and
// acceptance criterion of every story. That is fine for a web page, which
// renders what it needs and drops the rest, but tool output is context the
// model re-reads on every subsequent turn, so the list tools trim down to a
// summary and let `get_story` fetch depth on demand.

const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

/**
 * One row of a story list. Ids are always present; the human-readable name is
 * added only when the endpoint eager-loaded it, so the model is never shown a
 * name that is really an id.
 */
function storySummary(story) {
  const summary = {
    id: story.id,
    title: story.title,
    stateId: story.stateId ?? null,
    typeId: story.typeId ?? null,
    priority: story.priority ?? null,
    estimate: story.estimate ?? null,
    sprintId: story.sprintId ?? null,
    assigneeId: story.assigneeId ?? null,
  };

  if (story.state) summary.state = story.state.name;
  if (story.type) summary.type = story.type.name;
  if (story.assignee) summary.assignee = fullName(story.assignee);
  if (Array.isArray(story.acceptanceCriteria)) {
    summary.acceptanceCriteriaCount = story.acceptanceCriteria.length;
  }
  if (Array.isArray(story.comment)) summary.commentCount = story.comment.length;

  return summary;
}

function sprintSummary(sprint) {
  return {
    id: sprint.id,
    title: sprint.title,
    goal: sprint.goal ?? null,
    status: sprint.status,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    isRecurring: sprint.isRecurring,
  };
}

// --- tools -----------------------------------------------------------------
// Descriptions matter more than you'd expect — they are the only thing the
// model uses to pick a tool, so say when to reach for it, not just what it
// returns.

server.registerTool(
  "list_my_projects",
  {
    title: "List my projects",
    description:
      "List every project the current user belongs to, with id and title. " +
      "Call this first whenever the user names a project in words rather than " +
      "by id, so you can resolve it to a project id for the other tools.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  handler(() => api("/users/me/projects")),
);

server.registerTool(
  "get_story",
  {
    title: "Get a story",
    description:
      "Fetch one story in full: its state, type, sprint, repository, " +
      "reporter, assignee, reviewer, acceptance criteria, comments and " +
      "relations to other stories. Use this when the user asks about a " +
      "specific story and you already know its id.",
    inputSchema: {
      projectId: z.number().int().describe("Id of the project the story belongs to."),
      storyId: z.number().int().describe("Id of the story to fetch."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(({ projectId, storyId }) => api(`/projects/${projectId}/stories/${storyId}`)),
);

server.registerTool(
  "list_stories",
  {
    title: "List stories in a project",
    description:
      "List a project's stories as short summaries: id, title, state, type, " +
      "priority, estimate, assignee, sprint, and how many acceptance criteria " +
      "and comments each has. Use this to survey a project, find stories " +
      "matching a description, or answer questions spanning several stories. " +
      "Every filter is optional and they combine with AND. Prefer filtering " +
      "here over listing everything and sifting through it yourself. " +
      "Summaries omit description text, comment bodies and relations — call " +
      "get_story for those once you know which story matters. The result " +
      "reports `matched`, the total number of stories that passed the " +
      "filters, which is the number to quote when asked how many; `stories` " +
      "may be shorter than that if you passed a limit.",
    inputSchema: {
      projectId: z.number().int().describe("Id of the project to list stories for."),
      stateId: z
        .number()
        .int()
        .optional()
        .describe(
          "Only stories in this workflow state. State ids are per-project — " +
            "read them from get_project rather than assuming.",
        ),
      typeId: z
        .number()
        .int()
        .optional()
        .describe(
          "Only stories of this type. Type ids are per-project — read them " +
            "from get_project rather than assuming.",
        ),
      assigneeId: z
        .number()
        .int()
        .optional()
        .describe("Only stories assigned to this user. User ids come from get_project's members."),
      unassigned: z
        .boolean()
        .optional()
        .describe("Only stories with nobody assigned. Cannot be combined with assigneeId."),
      sprintId: z
        .number()
        .int()
        .optional()
        .describe("Only stories in this sprint. For stories in no sprint at all, use get_backlog."),
      search: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on the story title."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Return at most this many stories. `matched` still reports the full count."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(async ({
    projectId,
    stateId,
    typeId,
    assigneeId,
    unassigned,
    sprintId,
    search,
    limit,
  }) => {
    // these two would silently cancel out, so say so rather than return []
    if (unassigned && assigneeId !== undefined) {
      throw new Error(
        "Pass either assigneeId or unassigned, not both — they contradict each other.",
      );
    }

    // the REST API has no query parameters, so filtering happens here; the
    // saving is in what goes back to the model, not in what is fetched
    const stories = await api(`/projects/${projectId}/stories`);
    const needle = search === undefined ? null : search.trim().toLowerCase();

    const matches = stories.filter((story) => {
      if (stateId !== undefined && Number(story.stateId) !== stateId) return false;
      if (typeId !== undefined && Number(story.typeId) !== typeId) return false;
      if (sprintId !== undefined && Number(story.sprintId) !== sprintId) return false;
      if (assigneeId !== undefined && Number(story.assigneeId) !== assigneeId) return false;
      if (unassigned && story.assigneeId !== null && story.assigneeId !== undefined) return false;
      if (needle && !String(story.title ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });

    return {
      matched: matches.length,
      stories: (limit === undefined ? matches : matches.slice(0, limit)).map(storySummary),
    };
  }),
);

server.registerTool(
  "get_project",
  {
    title: "Get a project",
    description:
      "Fetch a project's setup: its workflow states, story types, members, " +
      "repositories and sprints. Call this before creating or filtering " +
      "stories — it is where you learn which state and type ids a project " +
      "actually has, and which users are on it, since those are per-project " +
      "and cannot be guessed.",
    inputSchema: {
      projectId: z.number().int().describe("Id of the project to fetch."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(async ({ projectId }) => {
    const project = await api(`/projects/${projectId}`);
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      deadline: project.deadline,
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
      sprints: (project.sprint ?? []).map(sprintSummary),
    };
  }),
);

server.registerTool(
  "get_backlog",
  {
    title: "Get a project's backlog",
    description:
      "List the stories in a project that are not assigned to any sprint, as " +
      "summaries. Use this for backlog grooming questions, for sprint " +
      "planning, or when the user asks what work is unscheduled. Note this " +
      "is not filtered by state — a project's states are user-defined, so " +
      "'not in a sprint' is the only thing backlog means here.",
    inputSchema: {
      projectId: z.number().int().describe("Id of the project whose backlog to read."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(async ({ projectId }) => {
    const stories = await api(`/projects/${projectId}/backlog`);
    return stories.map(storySummary);
  }),
);

server.registerTool(
  "list_sprints",
  {
    title: "List a project's sprints",
    description:
      "List a project's sprints in date order, with title, goal, status " +
      "(Planned, Active or Completed) and dates. Use this to find the " +
      "current sprint, or to resolve a sprint the user names in words into " +
      "an id. It does not include the stories in each sprint — use " +
      "get_sprint for that.",
    inputSchema: {
      projectId: z.number().int().describe("Id of the project whose sprints to list."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(async ({ projectId }) => {
    const sprints = await api(`/projects/${projectId}/sprints`);
    return sprints.map(sprintSummary);
  }),
);

server.registerTool(
  "get_sprint",
  {
    title: "Get a sprint with its stories",
    description:
      "Fetch one sprint together with summaries of the stories in it. Use " +
      "this to answer questions about sprint scope, progress or workload. " +
      "The story rows here carry state and type ids but not their names — " +
      "call get_project once if you need to translate those into names.",
    inputSchema: {
      sprintId: z.number().int().describe("Id of the sprint to fetch."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(async ({ sprintId }) => {
    const sprint = await api(`/sprints/${sprintId}`);
    return {
      ...sprintSummary(sprint),
      projectId: sprint.projectId,
      stories: (sprint.story ?? []).map(storySummary),
    };
  }),
);

server.registerTool(
  "get_story_activity",
  {
    title: "Get a story's history",
    description:
      "Read the change history of one story, newest first: who changed what, " +
      "when, and the before and after values. Covers edits to the story " +
      "itself plus its acceptance criteria, comments and relations. Use this " +
      "for questions about what happened, when something moved, or who has " +
      "been working on a story.",
    inputSchema: {
      projectId: z.number().int().describe("Id of the project the story belongs to."),
      storyId: z.number().int().describe("Id of the story whose history to read."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(30)
        .describe("How many of the most recent entries to return."),
    },
    annotations: { readOnlyHint: true },
  },
  handler(async ({ projectId, storyId, limit = 30 }) => {
    const entries = await api(
      `/projects/${projectId}/stories/${storyId}/activity`,
    );

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
  }),
);

// --- start -----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[nimble-mcp] ready, talking to ${API_URL}`);
