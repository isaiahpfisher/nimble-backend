// The agent loop: ask, run whatever tools were asked for, ask again, until the
// model answers in prose or the turn cap is reached.
//
// It knows nothing about how tools are implemented or where the data comes
// from. `callTool` is a function that takes a name and arguments and reports an
// outcome, so this runs identically against the real registry and against a
// stub, with no network and no database.

const { buildSystemPrompt } = require("./prompt");
const { collectEntities, linkTitles, noEntities, publishedUrls, verifyLinks } = require("./links");
const {
  DEFAULT_MODEL,
  ask,
  packResult,
  readText,
  readToolResult,
  toolDefinitions,
} = require("./cohere");

// Each turn is another paid round trip, and a model that misreads a tool result
// can ping-pong indefinitely. Cap it, and say when the cap is what stopped us.
const DEFAULT_MAX_TURNS = 8;

const NO_ANSWER = "I don't have an answer for that. Try asking another way.";
const OUT_OF_BUDGET = "I ran out of tool budget before I got to an answer. Try narrowing the question.";

/**
 * The model writes tool arguments as a JSON string. Malformed JSON is its own
 * mistake to correct, so it becomes a tool failure it can read rather than an
 * exception that ends the turn.
 */
function parseArguments(text) {
  try {
    return { ok: true, args: JSON.parse(text || "{}") };
  } catch {
    return { ok: false, error: `Arguments were not valid JSON: ${text}` };
  }
}

/**
 * @param {object}   options.cohere    a CohereClientV2, or any object with .chat
 * @param {Array}    options.tools     specs from the tool registry
 * @param {Function} options.callTool  (name, args) => { ok, result } | { ok: false, error }
 * @param {Array}    options.messages  the visible exchange, oldest first
 * @param {object}   options.user      the user being helped
 * @param {object}  [options.context]  what is on screen ({projectId, storyId, sprintId})
 * @param {Array}   [options.priorHistory]  the stored exchange, tool results and
 *                                   all, from app/assistant/sessions.js. When
 *                                   present it replaces `messages`, which the
 *                                   client sends stripped of everything but prose.
 */
async function runConversation({
  cohere,
  tools,
  callTool,
  messages,
  user,
  context = {},
  priorHistory = null,
  model = DEFAULT_MODEL,
  maxTurns = DEFAULT_MAX_TURNS,
}) {
  const definitions = toolDefinitions(tools);
  const writes = new Set(tools.filter((tool) => tool.write).map((tool) => tool.name));

  // A remembered conversation already holds every earlier turn, so only the
  // newest question is added to it. Without one, the client's prose is all
  // there is.
  const opening = priorHistory ? [...priorHistory, messages.at(-1)] : [...messages];

  // slot 0 is the system prompt, rewritten every turn so the record of what has
  // been done so far is always current
  const history = [null, ...opening];

  const done = [];
  // Every story, project and sprint this turn has been shown. Seeded from what
  // earlier turns produced — the links already published, and, when the
  // conversation was remembered, the tool results those links came from — so a
  // follow-up that names one keeps it clickable without running a tool again.
  const entities = noEntities();
  publishedUrls(opening, entities.urls);
  for (const message of opening) {
    if (message.role === "tool") collectEntities(readToolResult(message), entities);
  }
  let lastText = "";

  // Verify before linking, so a target just rejected cannot be reintroduced by
  // its title.
  const answer = (reply, stoppedBecause, turns) => {
    const finished = linkTitles(verifyLinks(reply, entities.urls), entities.titles);

    // What to store for next time: everything but the system prompt, which is
    // rebuilt each turn. The reply is recorded as the user actually saw it —
    // links repaired — so a follow-up refers to the same text they read.
    const stored = history.slice(1);
    const last = stored.at(-1);

    if (last?.role === "assistant" && last.content) {
      // the model's own closing turn, already in the history
      stored[stored.length - 1] = { ...last, content: finished };
    } else {
      // it ran out of turns or fell over, so nothing said this yet
      stored.push({ role: "assistant", content: finished });
    }

    return { reply: finished, toolCalls: done, turns, stoppedBecause, history: stored };
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    history[0] = { role: "system", content: buildSystemPrompt({ user, tools, context, done }) };

    let message;
    try {
      // a copy: history keeps growing, and the SDK should not see it change
      message = await ask(cohere, { model, messages: [...history], tools: definitions });
    } catch (err) {
      // Nothing more is coming from the model. If an earlier turn already
      // produced something worth reading, that beats an error page — the tool
      // work is done and paid for either way.
      if (!lastText) throw err;
      return answer(lastText, "model_error", turn);
    }

    const calls = message.toolCalls ?? [];
    const text = readText(message);
    if (text) lastText = text;

    // echoed back exactly as produced, or the next call loses the thread of its
    // own tool plan
    history.push({
      role: "assistant",
      ...(message.toolPlan && { toolPlan: message.toolPlan }),
      ...(calls.length && { toolCalls: calls }),
      ...(text && { content: text }),
    });

    if (!calls.length) {
      // a turn with neither prose nor a tool call is the model giving up; an
      // empty bubble in the panel would look like a bug rather than an answer
      return answer(text || NO_ANSWER, "answered", turn);
    }

    for (const call of calls) {
      const name = call.function?.name ?? "unknown";
      const parsed = parseArguments(call.function?.arguments);
      const outcome = parsed.ok ? await callTool(name, parsed.args) : { ok: false, error: parsed.error };

      if (outcome.ok) collectEntities(outcome.result, entities);

      done.push({ name, isWrite: writes.has(name), isError: !outcome.ok });
      history.push({
        role: "tool",
        toolCallId: call.id,
        content: [{ type: "text", text: packResult(name, outcome) }],
      });
    }
  }

  return answer(lastText || OUT_OF_BUDGET, "turn_limit", maxTurns);
}

module.exports = { runConversation, parseArguments, DEFAULT_MAX_TURNS, NO_ANSWER, OUT_OF_BUDGET };
