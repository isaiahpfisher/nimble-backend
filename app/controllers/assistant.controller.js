const db = require("../models");
const User = db.user;
const { httpError } = require("../utils/httpUtils");
const { runChat } = require("../assistant");

const MAX_MESSAGE_LENGTH = 8000;
const MAX_MESSAGES = 40;

/**
 * The visible exchange, checked before it goes anywhere near the model.
 *
 * Only `user` and `assistant` turns are allowed: a client that could send a
 * system message could rewrite the standing instructions, so the role is
 * refused outright rather than quietly filtered out.
 */
function readMessages(body) {
  const messages = body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw httpError("messages must be a non-empty array.", 400);
  }
  if (messages.length > MAX_MESSAGES) {
    throw httpError(`messages may contain at most ${MAX_MESSAGES} entries.`, 400);
  }

  const clean = messages.map((message) => {
    if (message?.role !== "user" && message?.role !== "assistant") {
      throw httpError("Invalid role.", 400);
    }
    if (typeof message.content !== "string" || message.content.trim() === "") {
      throw httpError("Invalid content.", 400);
    }
    if (message.content.length > MAX_MESSAGE_LENGTH) {
      throw httpError("Content is too long.", 400);
    }

    return { role: message.role, content: message.content };
  });

  if (clean.at(-1).role !== "user") {
    throw httpError("The last message must come from the user.", 400);
  }

  return clean;
}

function readContext(body) {
  const context = {};

  for (const field of ["projectId", "storyId", "sprintId"]) {
    const value = body?.[field];

    if (value === undefined || value === null) {
      context[field] = null;
    } else if (!Number.isInteger(value) || value <= 0) {
      // expecting ids
      throw httpError(`${field} must be a positive integer.`, 400);
    } else {
      context[field] = value;
    }
  }

  return context;
}

// figure out what user is making the request
function callerToken(req) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw httpError("Authentication required.", 401);
  }
  return header.slice(7);
}

// wrapper around errors so we can show them to the user
function errorResponse(err) {
  if (err?.expose) return { status: err.statusCode ?? 400, message: err.message };

  // a statusCode we did not set means it came from upstream, not from us
  if (err?.statusCode) {
    return {
      status: 503,
      message: "The assistant is having trouble right now. Please try again in a moment.",
    };
  }

  return { status: 500, message: "The assistant failed to answer." };
}

exports.chat = async (req, res) => {
  try {
    if (!req.userId) throw httpError("Authentication required.", 401);

    const messages = readMessages(req.body);
    const context = readContext(req.body);
    const token = callerToken(req);

    const user = await User.findByPk(req.userId, { attributes: ["id", "firstName", "lastName"] });

    const { reply, toolCalls } = await runChat({ token, user, messages, context });

    res.send({ reply, toolCalls });
  } catch (err) {
    console.error("Assistant chat failed:", err);
    const { status, message } = errorResponse(err);
    res.status(status).send({ message });
  }
};
