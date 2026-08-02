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
const { runConversation, DEFAULT_MAX_TURNS } = require("./loop");
const { openSession } = require("./mcp");

/**
 * @param {string} options.token     the caller's bearer token; every tool acts as them
 * @param {object} options.user      { id, firstName, lastName }
 * @param {Array}  options.messages  the visible exchange, oldest first
 * @param {object} options.context   what is on screen ({projectId, storyId, sprintId})
 */
async function runChat({ token, user, messages, context }) {
  const ctx = { api: apiClient(token), userId: user?.id ?? null };

  // bound to this caller, and torn down with the request
  const session = await openSession(ctx);

  try {
    return await runConversation({
      cohere: cohereClient(),
      tools: await session.listTools(),
      callTool: session.callTool,
      user,
      messages,
      context,
      model: process.env.COHERE_MODEL || DEFAULT_MODEL,
      maxTurns: Number(process.env.ASSISTANT_MAX_TURNS) || DEFAULT_MAX_TURNS,
    });
  } finally {
    await session.close();
  }
}

module.exports = { runChat };
