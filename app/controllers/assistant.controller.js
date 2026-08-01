const db = require("../models");
const User = db.user;
const { httpError } = require("../utils/httpUtils");
const { connectAsUser } = require("../assistant/mcpClient");
const {
  runConversation,
  buildSystemPrompt,
  DEFAULT_MODEL,
  DEFAULT_MAX_TURNS,
} = require("../assistant/cohere");

// Only these two roles may be supplied by the client. The system prompt is
// built here, and assistant/tool turns are produced by the loop, so accepting
// them from the request would let a client fabricate tool results.
const CLIENT_ROLES = new Set(["user", "assistant"]);

const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8000;

let cohereClient = null;

/**
 * Built lazily so the app still boots without a key configured — only the
 * assistant route fails, rather than the whole server.
 */
function getCohereClient() {
  if (!cohereClient) {
    if (!process.env.COHERE_API_KEY) {
      throw httpError("The assistant is not configured on this server.", 503);
    }
    const { CohereClientV2 } = require("cohere-ai");
    cohereClient = new CohereClientV2({ token: process.env.COHERE_API_KEY });
  }
  return cohereClient;
}

/**
 * Normalises the client-supplied history, rejecting anything malformed rather
 * than passing it through to the model.
 */
function readMessages(body) {
  const messages = body && body.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw httpError("messages must be a non-empty array.", 400);
  }
  if (messages.length > MAX_MESSAGES) {
    throw httpError(`messages may contain at most ${MAX_MESSAGES} entries.`, 400);
  }

  const clean = messages.map((message, index) => {
    if (!message || !CLIENT_ROLES.has(message.role)) {
      throw httpError(`messages[${index}].role must be "user" or "assistant".`, 400);
    }
    if (typeof message.content !== "string" || message.content.trim() === "") {
      throw httpError(`messages[${index}].content must be a non-empty string.`, 400);
    }
    if (message.content.length > MAX_MESSAGE_LENGTH) {
      throw httpError(
        `messages[${index}].content exceeds ${MAX_MESSAGE_LENGTH} characters.`,
        400,
      );
    }
    return { role: message.role, content: message.content };
  });

  if (clean[clean.length - 1].role !== "user") {
    throw httpError("The last message must come from the user.", 400);
  }

  return clean;
}

/**
 * The caller's own bearer token, forwarded to the MCP child so every tool it
 * runs is scoped to exactly what this user may already reach over the API.
 */
function callerToken(req) {
  const header = req.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw httpError("Authentication required.", 401);
  }
  return header.slice(7);
}

exports.chat = async (req, res) => {
  let mcp = null;

  // a browser that navigates away should not leave a child process behind
  const closeOnDisconnect = () => {
    if (mcp) mcp.close();
  };
  req.on("close", closeOnDisconnect);

  try {
    if (!req.userId) {
      throw httpError("Authentication required.", 401);
    }

    const messages = readMessages(req.body);
    const token = callerToken(req);
    const cohere = getCohereClient();

    const user = await User.findByPk(req.userId, {
      attributes: ["id", "firstName", "lastName"],
    });

    mcp = await connectAsUser(token);

    const result = await runConversation({
      mcp,
      cohere,
      model: process.env.COHERE_MODEL || DEFAULT_MODEL,
      maxTurns: Number(process.env.ASSISTANT_MAX_TURNS) || DEFAULT_MAX_TURNS,
      messages: [
        { role: "system", content: buildSystemPrompt({ user }) },
        ...messages,
      ],
    });

    res.send({
      reply: result.reply,
      turns: result.turns,
      stoppedBecause: result.stoppedBecause,
      // enough for the UI to show what was consulted, without the payloads
      toolCalls: result.toolCalls.map((call) => ({
        name: call.name,
        isError: call.isError,
      })),
    });
  } catch (err) {
    console.error("Assistant chat failed:", err);
    res.status(err.statusCode || 500).send({
      message: err.statusCode ? err.message : "The assistant failed to answer.",
    });
  } finally {
    // every path through this handler has to reach here, or the spawned MCP
    // server is orphaned and the process count climbs until the box runs out
    req.off("close", closeOnDisconnect);
    if (mcp) await mcp.close();
  }
};
