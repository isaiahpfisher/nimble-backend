// The assistant, wired together.
//
// This is the only file the rest of the app needs to know about: give it who is
// asking, what they said and what they are looking at, and it answers.
//
//   controller -> runChat -> loop -> MCP -> tool registry -> Nimble's REST API
//
// The MCP hop is in-process and costs well under a millisecond. It is there so
// the assistant reaches its tools the same way an outside client does, over the
// server mcp/server.mjs also serves — see app/assistant/mcp.js.

const { apiClient } = require("./api");
const { cohereClient, DEFAULT_MODEL } = require("./cohere");
const { withPageContext } = require("./context");
const { KINDS, runGeneration } = require("./generate");
const { runConversation, DEFAULT_MAX_TURNS } = require("./loop");
const { openSession } = require("./mcp");
const { recall, remember } = require("./sessions");

/**
 * @param {string} options.token     the caller's bearer token; every tool acts as them
 * @param {object} options.user      { id, firstName, lastName }
 * @param {Array}  options.messages  the visible exchange, oldest first
 * @param {object} options.context   what is on screen ({projectId, storyId, sprintId})
 * @param {string} [options.conversationId]  an earlier exchange to carry on from
 */
async function runChat({ token, user, messages, context, conversationId = null }) {
  const ctx = { api: apiClient(token), userId: user?.id ?? null };

  // bound to this caller, and torn down with the request
  const session = await openSession(ctx);

  try {
    const tools = await session.listTools();

    const { history, ...answer } = await runConversation({
      cohere: cohereClient(),
      tools,
      // the page's ids are filled in rather than merely asked for; see context.js
      callTool: withPageContext(session.callTool, tools, context),
      user,
      messages,
      context,
      // what the model saw last time, tool results and all; see sessions.js
      priorHistory: recall(ctx.userId, conversationId),
      model: process.env.COHERE_MODEL || DEFAULT_MODEL,
      maxTurns: Number(process.env.ASSISTANT_MAX_TURNS) || DEFAULT_MAX_TURNS,
    });

    return { ...answer, conversationId: remember(ctx.userId, conversationId, history) };
  } finally {
    await session.close();
  }
}

/**
 * One tool, run on its own, with no model anywhere in the loop.
 *
 * This is what the buttons built into Nimble's own pages call — "check for
 * duplicates", "what did we estimate work like this at". They know exactly
 * which question they are asking, so paying for a conversation to arrive at it
 * would be waste, and the answer belongs rendered next to the thing it is about
 * rather than as prose in the chat panel.
 *
 * Only read-only tools are reachable. A button that could write is a write
 * nobody confirmed, and the confirming is the part the chat loop does that this
 * path deliberately skips.
 *
 * Reports an outcome rather than throwing: `reason` is what the caller maps to
 * a status code.
 *
 * @param {string} options.token    the caller's bearer token; the tool acts as them
 * @param {number} options.userId
 * @param {string} options.name     which tool to run
 * @param {object} options.args     its arguments, unvalidated
 * @param {object} options.context  what is on screen ({projectId, storyId, sprintId})
 */
async function runSingleTool({ token, userId = null, name, args = {}, context = {} }) {
  const ctx = { api: apiClient(token), userId };
  const session = await openSession(ctx);

  try {
    const tools = await session.listTools();
    const spec = tools.find((tool) => tool.name === name);

    if (!spec) {
      return { ok: false, reason: "unknown", error: `There is no tool called "${name}".` };
    }
    if (spec.write) {
      return {
        ok: false,
        reason: "readonly",
        error: `${name} changes data, so it cannot be called directly. Ask the assistant instead.`,
      };
    }

    // the same page-context filling the chat loop gets, so a button that knows
    // the project it is on does not have to spell it out
    const outcome = await withPageContext(session.callTool, tools, context)(name, args);

    return outcome.ok ? outcome : { ...outcome, reason: "failed" };
  } finally {
    await session.close();
  }
}

module.exports = { runChat, runSingleTool, runGeneration, GENERATION_KINDS: KINDS };
