const db = require("../models");
const User = db.user;
const { httpError } = require("../utils/httpUtils");
const { connectAsUser } = require("../assistant/mcpClient");
const { runConversation, DEFAULT_MODEL, DEFAULT_MAX_TURNS } = require("../assistant/chat");

const MAX_MESSAGE_LENGTH = 8000;
const MAX_MESSAGES = 40;

let cohereClient = null;

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

function readMessages(body) {
  const messages = body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw httpError("messages must be a non-empty array.", 400);
  }
  if (messages.length > MAX_MESSAGES) {
    throw httpError(`messages may contain at most ${MAX_MESSAGES} entries.`, 400);
  }

  const clean = messages.map((message, index) => {
    if (message?.role !== "user" && message?.role !== "assistant") {
      throw httpError(`Invalid role.`, 400);
    }
    if (typeof message.content !== "string" || message.content.trim() === "") {
      throw httpError(`Invalid content`, 400);
    }
    if (message.content.length > MAX_MESSAGE_LENGTH) {
      throw httpError(`Content is too long.`, 400);
    }

    return { role: message.role, content: message.content };
  });

  if (clean[clean.length - 1].role !== "user") {
    throw httpError("The last message must come from the user.", 400);
  }

  return clean;
}

// get the caller's auth token, so we know who the user is
function callerToken(req) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw httpError("Authentication required.", 401);
  }
  return header.slice(7);
}

exports.chat = async (req, res) => {
  let mcp = null;

  // close the mcp process when the client disconnects
  const closeOnDisconnect = () => mcp?.close();
  req.on("close", closeOnDisconnect);

  try {
    if (!req.userId) throw httpError("Authentication required.", 401);

    const messages = readMessages(req.body);
    const token = callerToken(req);
    const cohere = getCohereClient();

    const user = await User.findByPk(req.userId, { attributes: ["id", "firstName", "lastName"] });

    mcp = await connectAsUser(token, req.userId);

    const result = await runConversation({
      mcp,
      cohere,
      user,
      messages,
      model: process.env.COHERE_MODEL || DEFAULT_MODEL,
      maxTurns: Number(process.env.ASSISTANT_MAX_TURNS) || DEFAULT_MAX_TURNS,
    });

    res.send({
      reply: result.reply,
      turns: result.turns,
      stoppedBecause: result.stoppedBecause,
      toolCalls: result.toolCalls,
    });
  } catch (err) {
    console.error("Assistant chat failed:", err);
    res.status(err.statusCode || 500).send({
      message: err.statusCode ? err.message : "The assistant failed to answer.",
    });
  } finally {
    req.off("close", closeOnDisconnect);
    if (mcp) await mcp.close();
  }
};
