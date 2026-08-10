const { httpError } = require("../utils/httpUtils");
const { buildSystemPrompt } = require("./prompt");

const DEFAULT_MODEL = "command-a-plus-05-2026";
const DEFAULT_MAX_TURNS = 6;
const NO_ANSWER = "I don't have an answer for that. Try asking another way.";
const OUT_OF_BUDGET = "Could not find an answer in time. Try narrowing the question.";

let client = null;

function cohereClient() {
  if (!client) {
    if (!process.env.COHERE_API_KEY) {
      throw httpError("Missing API key.", 503);
    }

    // lazy load API key, otherwise missing key crashes even if not used
    const { CohereClientV2 } = require("cohere-ai");
    client = new CohereClientV2({ token: process.env.COHERE_API_KEY });
  }

  return client;
}

// Cohere responds with message.content
// which is either a string or an array of blocks
// normalize to string here to display
function readText(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

// sometimes Cohere returns json surrounded by ```{json}```
// get rid of it
function unfence(text) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : text;
}

// apply uniform formatting to the result
// needed to translate between Cohere and our tool registry
const packResult = (name, outcome) =>
  JSON.stringify(outcome.ok ? { tool: name, result: outcome.result } : { tool: name, error: outcome.error });

// one actual request to the model
// retry a few times if it fails
async function ask(cohere, request, { attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await cohere.chat(request);
      return response?.message ?? {};
    } catch (err) {
      if (attempt === attempts) throw err;
    }
  }
}

// ============================================================================
// the conversation loop
// ============================================================================

// the model writes tool arguments as a JSON string
// we need to validate that and give the model a helpful
// error message if it is invalid JSON
function parseArguments(text) {
  try {
    return { ok: true, args: JSON.parse(text || "{}") };
  } catch {
    return { ok: false, error: `Arguments were not valid JSON: ${text}` };
  }
}

const CONTEXT_FIELDS = ["projectId", "storyId", "sprintId"];

// include helpful context for the model
// the prompt asks the model to pass it as an arg
// but grab it from context if it's missing from args
function applyContext(args, spec, context) {
  const required = new Set(spec?.parameters?.required ?? []);
  const filled = { ...args };

  for (const field of CONTEXT_FIELDS) {
    if (required.has(field) && filled[field] == null && context?.[field] != null) {
      filled[field] = context[field];
    }
  }

  return filled;
}

// cohere = Cohere Client SDK (CohereClientV2)
// tools = tool specs from the tool registry
// callTool = (name, args) => { ok, result } | { ok: false, error }
// messages = the visible exchange, oldest first
// user = the user being helped
// context = what is on screen (project, story, sprint the user is looking at)
async function runConversation({
  cohere,
  tools,
  callTool,
  messages,
  user,
  context = {},
  model = DEFAULT_MODEL,
  maxTurns = DEFAULT_MAX_TURNS,
}) {
  // convert tool registry into format Cohere expects
  const definitions = tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

  // get map of tools, keyed by name
  const specs = new Map(tools.map((tool) => [tool.name, tool]));

  const history = [null, ...messages]; // first slot is reserved for system prompt
  const done = []; // stores completed tool calls
  let lastText = "";

  // THE LOOP - gives the model a few turns to think about the question
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    // system role is only allowed for the prompt
    // this makes sure the model understands the system prompt gets the final say
    // helps to avoid prompt injection
    history[0] = { role: "system", content: buildSystemPrompt({ user, context, done }) };

    let message;
    try {
      message = await ask(cohere, { model, messages: [...history], tools: definitions });
    } catch (err) {
      // pointless to keep asking
      // break here and return whatever we have
      // throw if we have nothing
      if (!lastText) throw err;
      return { reply: lastText, toolCalls: done, turns: turn, stoppedBecause: "model_error" };
    }

    const calls = message.toolCalls ?? [];
    const text = readText(message);
    if (text) lastText = text;

    history.push({
      role: "assistant",
      ...(message.toolPlan && { toolPlan: message.toolPlan }),
      ...(calls.length && { toolCalls: calls }),
      ...(text && { content: text }),
    });

    if (!calls.length) {
      // model didn't provide any tools to call, so it thinks it's done or gave up
      return { reply: text || NO_ANSWER, toolCalls: done, turns: turn, stoppedBecause: "answered" };
    }

    // note that we haven't actually called any tools yet
    // the model just tells us what tools it wants to call
    // this is where we actually invoke the tools
    for (const call of calls) {
      // extract the tool name and args from Cohere's response
      const name = call.function?.name ?? "unknown";
      const parsed = parseArguments(call.function?.arguments);

      // THIS IS WHERE THE ACTUAL TOOL IS INVOKED
      // note that we include context here
      // (this is stuff like what project is active, what story the user is looking at, etc.)
      const outcome = parsed.ok
        ? await callTool(name, applyContext(parsed.args, specs.get(name), context))
        : { ok: false, error: parsed.error };

      done.push({ name, isWrite: Boolean(specs.get(name)?.write), isError: !outcome.ok });
      history.push({
        role: "tool",
        toolCallId: call.id,
        content: [{ type: "text", text: packResult(name, outcome) }],
      });
    }
  }

  // loop is done, so send back whatever we have as the final message
  return { reply: lastText || OUT_OF_BUDGET, toolCalls: done, turns: maxTurns, stoppedBecause: "turn_limit" };
}

module.exports = {
  runConversation,
  cohereClient,
  ask,
  readText,
  unfence,
  packResult,
  applyContext,
  parseArguments,
  DEFAULT_MODEL,
  DEFAULT_MAX_TURNS,
  NO_ANSWER,
  OUT_OF_BUDGET,
};
