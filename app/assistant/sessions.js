// Remembering what the assistant actually saw.
//
// The panel keeps prose and nothing else, so every request used to arrive with
// the tool results stripped out — the prompt had to admit as much ("Tool
// results from earlier in this conversation are gone"). The model was then
// asked follow-up questions about work it could no longer see, and its two ways
// out were both bad: run every tool again, or answer from memory it does not
// have.
//
// So the full exchange is kept here, server-side, for as long as a conversation
// is plausibly still going. The client gets an opaque id back and hands it in
// next time; it never sees or supplies a tool result, which is what stops a
// forged one from becoming something the model treats as fact.
//
// In memory on purpose: Nimble runs as a single backend container, a lost
// conversation costs one re-fetch, and nothing here is worth a database table.

const crypto = require("crypto");

// Long enough to cover stepping away mid-conversation, short enough that a
// day's chatter does not accumulate.
const TTL_MS = 30 * 60 * 1000;

// A hard ceiling on conversations held at once, so a busy day cannot grow the
// heap without bound. Oldest goes first.
const MAX_SESSIONS = 500;

// Roughly 25k tokens of history. Command A+ holds far more, but every stored
// turn is re-sent and re-read on the next one, so the cap is about cost and
// latency rather than what fits.
const MAX_HISTORY_CHARS = 100_000;

const sessions = new Map();

const now = () => Date.now();

/** Conversations nobody is coming back to. */
function evictExpired(at = now()) {
  for (const [key, session] of sessions) {
    if (at - session.touched > TTL_MS) sessions.delete(key);
  }
}

/** The oldest conversations, once there are too many to keep. */
function evictOverflow() {
  if (sessions.size <= MAX_SESSIONS) return;

  const oldest = [...sessions.entries()]
    .sort((a, b) => a[1].touched - b[1].touched)
    .slice(0, sessions.size - MAX_SESSIONS);

  for (const [key] of oldest) sessions.delete(key);
}

/**
 * Drops the oldest turns until the history fits.
 *
 * It cuts only immediately before a `user` message. A `tool` message is only
 * meaningful next to the assistant message whose call it answers — Cohere
 * rejects an orphan outright — so a cut anywhere else can leave a history the
 * provider will not accept.
 */
function trimHistory(history, maxChars = MAX_HISTORY_CHARS) {
  const sizeOf = (message) => JSON.stringify(message).length;

  let total = history.reduce((sum, message) => sum + sizeOf(message), 0);
  if (total <= maxChars) return history;

  let from = 0;
  while (total > maxChars) {
    // the next safe boundary after `from`
    let next = -1;
    for (let at = from + 1; at < history.length; at += 1) {
      if (history[at].role === "user") {
        next = at;
        break;
      }
    }

    // no boundary left: keep the tail whole rather than corrupt it
    if (next === -1) break;

    for (let at = from; at < next; at += 1) total -= sizeOf(history[at]);
    from = next;
  }

  return history.slice(from);
}

/** The key a conversation is stored under; the user id is part of it deliberately. */
const keyFor = (userId, conversationId) => `${userId}:${conversationId}`;

/**
 * The stored history for a conversation, or null.
 *
 * An id belonging to somebody else simply does not match, so it reads as a new
 * conversation rather than as another user's.
 */
function recall(userId, conversationId) {
  if (!conversationId) return null;

  evictExpired();
  const session = sessions.get(keyFor(userId, conversationId));
  if (!session) return null;

  session.touched = now();
  return session.history;
}

/**
 * Stores a conversation and returns the id to hand back to the client.
 *
 * @param {number} userId
 * @param {string|null} conversationId  the existing id, or null to mint one
 * @param {Array} history  the full exchange, without the system message
 */
function remember(userId, conversationId, history) {
  const id = conversationId || crypto.randomUUID();

  evictExpired();
  sessions.set(keyFor(userId, id), { history: trimHistory(history), touched: now() });
  evictOverflow();

  return id;
}

/** Ends a conversation, for a client that wants to start over. */
const forget = (userId, conversationId) => sessions.delete(keyFor(userId, conversationId));

/** Testing seam; there is no reason to call this in the app. */
const reset = () => sessions.clear();

module.exports = {
  recall,
  remember,
  forget,
  trimHistory,
  reset,
  TTL_MS,
  MAX_SESSIONS,
  MAX_HISTORY_CHARS,
};
