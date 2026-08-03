const db = require("../models");
const User = db.user;
const { httpError } = require("../utils/httpUtils");
const { runChat, runSingleTool, runGeneration } = require("../assistant");

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

// The id we handed back last time. It only ever selects a conversation of this
// caller's own (sessions.js keys on the user id too), so an unknown or borrowed
// one simply starts a fresh exchange rather than reaching anybody else's.
const CONVERSATION_ID = /^[0-9a-f-]{36}$/i;

function readConversationId(body) {
  const value = body?.conversationId;
  if (value === undefined || value === null) return null;

  if (typeof value !== "string" || !CONVERSATION_ID.test(value)) {
    throw httpError("conversationId is not valid.", 400);
  }

  return value;
}

/**
 * The arguments for a directly-invoked tool.
 *
 * Only the shape is checked here. What the arguments have to *be* is the tool's
 * own Zod schema, which the registry applies and reports on — repeating any of
 * it here would be a second copy to drift.
 */
function readArgs(body) {
  const args = body?.args;

  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw httpError("args must be an object.", 400);
  }

  return args;
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
    const conversationId = readConversationId(req.body);
    const token = callerToken(req);

    const user = await User.findByPk(req.userId, { attributes: ["id", "firstName", "lastName"] });

    const answer = await runChat({ token, user, messages, context, conversationId });

    res.send({
      reply: answer.reply,
      toolCalls: answer.toolCalls,
      // the client hands this back next time so the model keeps what it saw
      conversationId: answer.conversationId,
    });
  } catch (err) {
    console.error("Assistant chat failed:", err);
    const { status, message } = errorResponse(err);
    res.status(status).send({ message });
  }
};

// Tool names are [a-z_] by construction — see the registry's own test. Checked
// before the name reaches the lookup so a path segment of any other shape is
// refused rather than searched for.
const TOOL_NAME = /^[a-z][a-z_]{2,49}$/;

const STATUS_FOR = { unknown: 404, readonly: 403, failed: 400 };

/**
 * Runs one tool and returns its result, with no model involved.
 *
 * This is the door for Nimble's own pages — the duplicate check on the create
 * form, the comparables on an unestimated story, the numbers behind sprint
 * planning. Read-only tools only; runSingleTool enforces that.
 */
exports.tool = async (req, res) => {
  try {
    if (!req.userId) throw httpError("Authentication required.", 401);

    const name = req.params.name;
    if (!TOOL_NAME.test(name ?? "")) throw httpError("That is not a valid tool name.", 400);

    const args = readArgs(req.body);
    const context = readContext(req.body);
    const token = callerToken(req);

    const outcome = await runSingleTool({ token, userId: req.userId, name, args, context });

    if (outcome.ok) return res.send({ tool: name, result: outcome.result });

    // A tool that refused is a 400 the caller can act on, not a server fault:
    // the arguments were wrong, or the thing asked about does not exist.
    res.status(STATUS_FOR[outcome.reason] ?? 400).send({ message: outcome.error });
  } catch (err) {
    console.error(`Assistant tool ${req.params?.name} failed:`, err);
    const { status, message } = errorResponse(err);
    res.status(status).send({ message });
  }
};

/**
 * Writes something that does not exist yet and hands it back as a draft.
 *
 * Nothing is saved here. Every generator returns text for a person to accept,
 * edit or throw away, and the saving goes through the ordinary story and
 * criteria endpoints afterwards — so nothing the model writes reaches the
 * database without somebody agreeing to it.
 */
exports.generate = async (req, res) => {
  try {
    if (!req.userId) throw httpError("Authentication required.", 401);

    const kind = req.params.kind;
    if (!TOOL_NAME.test(kind ?? "")) throw httpError("That is not a valid thing to generate.", 400);

    const args = readArgs(req.body);
    const context = readContext(req.body);
    const token = callerToken(req);

    const outcome = await runGeneration({ token, kind, args, context });

    if (outcome.ok) return res.send({ kind, result: outcome.result });

    res.status(outcome.reason === "unknown" ? 404 : 400).send({ message: outcome.error });
  } catch (err) {
    console.error(`Assistant generate ${req.params?.kind} failed:`, err);
    const { status, message } = errorResponse(err);
    res.status(status).send({ message });
  }
};
