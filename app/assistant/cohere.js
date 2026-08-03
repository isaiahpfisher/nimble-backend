// Everything that is true of Cohere specifically, and nowhere else.
//
// The loop deals in tool specs and outcomes; this file turns those into what
// Cohere's v2 chat API wants and turns its answers back. Swapping providers
// should mean writing a sibling of this file and nothing more.

const { httpError } = require("../utils/httpUtils");

// Command A+ over Command A, on measured behaviour rather than the spec sheet:
// against the eval fixture the older model dropped a required argument it had
// been given in the prompt (`list_sprints({})` while looking straight at a
// project), then apologised instead of correcting. Overriding with
// COHERE_MODEL still works if a cheaper model is wanted.
const DEFAULT_MODEL = "command-a-plus-05-2026";

// Failures worth one more try rather than an apology: rate limits, gateway
// blips, and the odd turn where the model emits neither a tool call nor a
// sentence (Cohere's 422 NO_TOOL_CALL_OR_RESPONSE_GENERATED, which is not
// deterministic — the same conversation usually succeeds on a second attempt).
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const isEmptyGeneration = (err) =>
  err?.statusCode === 422 && String(err?.message ?? "").includes("NO_TOOL_CALL_OR_RESPONSE_GENERATED");

// A connection that dropped or never opened carries no status at all — Node
// reports it as a bare "fetch failed" — so a status-only test called it fatal
// and gave up on a blip that a second attempt would have sailed through.
const NETWORK_FAILURE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;

const isNetworkFailure = (err) =>
  err?.statusCode === undefined && NETWORK_FAILURE.test(String(err?.message ?? ""));

const worthRetrying = (err) =>
  isEmptyGeneration(err) || isNetworkFailure(err) || RETRYABLE_STATUS.has(err?.statusCode);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The server's own `Retry-After`, in milliseconds, if it sent one.
 *
 * The SDK surfaces headers in more than one place depending on how the failure
 * was raised, so all the plausible ones are checked rather than assuming.
 */
function retryAfterMs(err) {
  const headers = err?.headers ?? err?.rawResponse?.headers ?? err?.response?.headers;
  const value = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];

  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

// A rate limit is counted per minute, so the old 250ms-then-500ms backoff was
// always going to come back to the same closed door — it just burned the
// retries doing it. An empty generation is the opposite: nothing is throttled,
// the same request usually works immediately, and waiting a second is waste.
const EMPTY_GENERATION_BACKOFF = 300;
const RATE_LIMIT_BACKOFF = 5000;
const BACKOFF_CEILING = 30000;

/** How long to wait before attempt number `attempt + 1`. */
function backoffFor(err, attempt) {
  const stated = retryAfterMs(err);
  if (stated) return Math.min(stated, BACKOFF_CEILING);

  if (isEmptyGeneration(err)) return EMPTY_GENERATION_BACKOFF * attempt;

  // exponential, with jitter so a burst of requests does not retry in lockstep
  const base = Math.min(RATE_LIMIT_BACKOFF * 2 ** (attempt - 1), BACKOFF_CEILING);
  return Math.round(base * (0.5 + Math.random() / 2));
}

let client = null;

/** The shared client, built on first use so a missing key is a 503, not a crash at boot. */
function cohereClient() {
  if (!client) {
    if (!process.env.COHERE_API_KEY) {
      throw httpError("The assistant is not configured on this server.", 503);
    }
    const { CohereClientV2 } = require("cohere-ai");
    client = new CohereClientV2({ token: process.env.COHERE_API_KEY });
  }
  return client;
}

/** Tool specs from the registry, in Cohere's function envelope. */
const toolDefinitions = (tools) =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

/** Assistant content arrives as either a string or a list of blocks. */
function readText(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

/** Strips a ```json fence, if the model wrapped its JSON in one. */
function unfence(text) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : text;
}

/**
 * The tool calls hidden inside a text response, or null if it is really prose.
 *
 * Cohere sometimes writes the call it meant to make into the content channel as
 * JSON — its own documented `{tool_name, parameters}` shape — and leaves
 * `toolCalls` empty. Accepted at face value that is not an answer at all: the
 * loop reads "no tool calls" as "this is the reply" and the user is shown a
 * JSON blob where their answer should be.
 *
 * It gets likelier the more tools there are, and there are twenty-five. So the
 * shape is read back out and handed over as though it had arrived properly.
 */
function toolCallsInText(text) {
  const body = unfence(text.trim());
  if (!body.startsWith("[") && !body.startsWith("{")) return null;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length) return null;

  const calls = rows.map((row, index) => {
    const name = row?.tool_name ?? row?.name ?? row?.function?.name;
    if (typeof name !== "string" || !name) return null;

    const args = row?.parameters ?? row?.arguments ?? row?.function?.arguments ?? {};

    return {
      id: String(row?.tool_call_id ?? row?.id ?? index),
      type: "function",
      function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
    };
  });

  // all of them or none: a list where only some rows look like calls is prose
  // that happens to be JSON, and guessing at it would lose the answer
  return calls.every(Boolean) ? calls : null;
}

/** Puts a tool call the model wrote as text back where it belongs. */
function recoverToolCalls(message) {
  if (message?.toolCalls?.length) return message;

  const text = readText(message);
  if (!text) return message;

  const calls = toolCallsInText(text);
  if (!calls) return message;

  const { content, ...rest } = message;
  return { ...rest, toolCalls: calls };
}

/**
 * A tool outcome as the string Cohere carries in a tool message.
 *
 * The `result` nesting is not decoration. Cohere reads a tool result that
 * parses as a JSON object as a Document, and requires `Document.id` to be a
 * string — a payload with a top-level numeric `id`, which is exactly what
 * get_story and get_project return, is rejected with a 400 before the model
 * ever sees it. Nesting means the outer object never has an `id`, so the
 * coercion has nothing to trip over. It also labels which tool spoke, which the
 * model gets wrong less often than you would hope.
 */
const packResult = (name, outcome) =>
  JSON.stringify(outcome.ok ? { tool: name, result: outcome.result } : { tool: name, error: outcome.error });

/**
 * The result inside a stored tool message, or null if it recorded a failure.
 *
 * The inverse of packResult, for reading a remembered conversation back —
 * chiefly so the stories an earlier turn was shown are still linkable now.
 */
function readToolResult(message) {
  const text = (message?.content ?? [])
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("");

  try {
    return JSON.parse(text)?.result ?? null;
  } catch {
    return null;
  }
}

/**
 * One chat request, with the retries that make a transient provider failure
 * invisible instead of fatal. Returns the assistant message.
 *
 * `wait` is injectable so the tests can exercise the retry policy without
 * actually sleeping through a rate limit's backoff.
 */
async function ask(cohere, request, { attempts = 4, wait = sleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await cohere.chat(request);
      return recoverToolCalls(response?.message ?? {});
    } catch (err) {
      if (attempt === attempts || !worthRetrying(err)) throw err;
      await wait(backoffFor(err, attempt));
    }
  }
}

module.exports = {
  DEFAULT_MODEL,
  cohereClient,
  toolDefinitions,
  readText,
  unfence,
  packResult,
  readToolResult,
  ask,
  backoffFor,
  isEmptyGeneration,
  recoverToolCalls,
  toolCallsInText,
};
