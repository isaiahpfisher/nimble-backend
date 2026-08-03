// The tool registry: one list of what the assistant can do.
//
// A tool is a plain object — name, description, a Zod schema for its arguments,
// and an async `run`. That single Zod schema is the only definition of a tool's
// input anywhere: it validates what the model sends, and it converts to the
// JSON Schema the model is shown. There is no second copy to drift.
//
// Nothing in here knows about Cohere or about MCP. Both are adapters over this
// list — `app/assistant/loop.js` calls `runTool` directly, and `mcp/server.mjs`
// serves the same tools over stdio to any MCP client.

const { z } = require("zod");

const projects = require("./projects");
const stories = require("./stories");
const details = require("./details");
const sprints = require("./sprints");
const insights = require("./insights");

const TOOLS = [...projects, ...stories, ...details, ...sprints, ...insights];
const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

// z.number().int() carries the JS safe-integer range into every property it
// touches. True, useless, and repeated in every tool definition the model is
// shown — so it comes back out before the schema is sent anywhere.
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

/** The JSON Schema for one tool's arguments, as the model should see it. */
const parametersOf = (tool) => tidySchema(z.toJSONSchema(tool.input, { io: "input" }));

let specs = null;

/**
 * The tool list in the shape a model needs to choose one. Provider-neutral:
 * `app/assistant/cohere.js` wraps these in Cohere's function envelope.
 *
 * The list never changes at runtime, so it is built once rather than on every
 * chat request.
 */
function toolSpecs() {
  specs ??= TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: parametersOf(tool),
    write: Boolean(tool.write),
  }));

  return specs;
}

/** Zod's complaint, rewritten as something the model can act on. */
const explainIssues = (error) =>
  (error.issues ?? [])
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
    .join("; ");

/**
 * Runs one tool and reports the outcome as a value.
 *
 * This never throws. An unknown name, arguments that do not fit the schema and
 * an API refusal are all things the model can read and correct on its next
 * turn, so they come back as `{ ok: false, error }` rather than as exceptions
 * the loop would have to catch.
 *
 * @param {string} name
 * @param {object} args  whatever the model produced, unvalidated
 * @param {object} ctx   { api, userId } — see app/assistant/api.js
 */
async function runTool(name, args, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { ok: false, error: `There is no tool called "${name}". Available: ${[...BY_NAME.keys()].join(", ")}.` };
  }

  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid arguments for ${name} — ${explainIssues(parsed.error)}.` };
  }

  try {
    return { ok: true, result: await tool.run(parsed.data, ctx) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { TOOLS, toolSpecs, parametersOf, runTool, tidySchema };
