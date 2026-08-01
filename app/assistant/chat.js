// Runs the assistant's tool-calling loop against Cohere's v2 chat API.
//
// Cohere is not an MCP client, so this module does the translation: MCP
// advertises tools as JSON Schema, Cohere wants that schema inside a function
// envelope, and results go back as `tool` messages keyed by the call id.
//
// Nothing here touches the database or checks permissions. The MCP child
// process carries the caller's own token and the REST API enforces access, so
// an out-of-bounds tool call simply comes back as a refusal the model reads.

const { buildSystemPrompt } = require("./prompt");

const DEFAULT_MODEL = "command-a-03-2025";

// Each turn is another paid round trip, and a model that misreads a tool result
// can ping-pong indefinitely. Cap it, and say when the cap is what stopped us.
const DEFAULT_MAX_TURNS = 8;

/** MCP's `inputSchema` is already JSON Schema, so this is mostly re-nesting. */
const toCohereTools = (tools) =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || tool.title || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  }));

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Assistant content arrives as either a string or a list of blocks. */
function assistantText(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

/** The text of an MCP tool result, whatever mix of blocks it came back as. */
const resultText = (result) =>
  (Array.isArray(result?.content) ? result.content : [])
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("\n")
    .trim();

/**
 * Packs a tool result into the string Cohere carries as tool content.
 *
 * The wrapper is not decoration. Cohere reads a tool result that parses as a
 * JSON object as a Document, and requires `Document.id` to be a string — a
 * payload with a top-level numeric `id`, which is exactly what get_story and
 * get_project return, is rejected with a 400 before the model ever sees it.
 * Nesting the payload under `result` means the outer object never has an `id`,
 * so the coercion has nothing to trip over. It also labels which tool spoke,
 * which the model gets wrong less often than you would hope.
 */
function toolContent(name, text, isError) {
  let result = text;
  try {
    result = JSON.parse(text);
  } catch {
    /* prose or an error message; send it as the string it is */
  }
  return JSON.stringify(isError ? { tool: name, error: result } : { tool: name, result });
}

/**
 * Every in-app url the model was actually shown, collected from tool results,
 * mapped from the title it belongs to. The MCP server puts a `url` on every
 * story, project and sprint precisely so the model never has to build one.
 *
 * The titles are what lets us link a story the model only named — see
 * linkTitles. A title with no url, or a url with no title, is still recorded on
 * the url side, since verification only needs the target.
 */
function collectUrls(value, urls = new Set(), titles = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls, titles);
  } else if (value && typeof value === "object") {
    if (typeof value.url === "string" && value.url.startsWith("/")) {
      urls.add(value.url.replace(/\/+$/, ""));
      // first url wins: an outer story outranks one nested in its relations
      if (typeof value.title === "string" && value.title.trim().length >= 4 && !titles.has(value.title)) {
        titles.set(value.title, value.url);
      }
    }
    for (const item of Object.values(value)) collectUrls(item, urls, titles);
  }
  return { urls, titles };
}

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]*)\)/g;

/**
 * Links the assistant already published in this conversation.
 *
 * The transcript we get back holds only prose, so a follow-up turn starts with
 * no tool results and every link the model repeats would be stripped as
 * invented. But a link in an earlier assistant message is one this same
 * function already vouched for, so it is trustworthy on sight. A client could
 * forge one — and mislead nobody but itself, since the target only ever points
 * inside that user's own app.
 */
function publishedUrls(messages, into = new Set()) {
  for (const { role, content } of messages) {
    if (role !== "assistant" || typeof content !== "string") continue;
    for (const [, , target] of content.matchAll(MARKDOWN_LINK)) {
      if (target.startsWith("/")) into.add(target.replace(/\/+$/, ""));
    }
  }
  return into;
}

/**
 * Repairs or removes in-app links the model did not copy faithfully.
 *
 * A link to the wrong story is worse than no link: it reads as an answer and
 * lands somewhere unrelated. So a target that appeared in no tool result and no
 * earlier answer loses its link and keeps its title.
 *
 * An absolute url whose path we do recognise is repaired rather than dropped.
 * The model writes "http://localhost:8081/projects/1/stories/7" often enough,
 * and the panel would open that in a new tab against the wrong origin — losing
 * the deployment's base path — when it is plainly a link we can honour.
 *
 * Genuinely external links (a repository, say) are left exactly as they are.
 */
const verifyLinks = (reply, allowed) =>
  reply.replace(MARKDOWN_LINK, (whole, text, target) => {
    const path = target.replace(/\/+$/, "");
    if (allowed.has(path)) return whole;

    if (/^https?:\/\//i.test(target)) {
      const inApp = safePathname(target);
      return inApp && allowed.has(inApp) ? `[${text}](${inApp})` : whole;
    }
    // relative but unrecognised: the title survives, the bad link does not
    return target.startsWith("/") ? text : whole;
  });

function safePathname(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Strips a trailing "(project: Atlas, High)" from after a link.
 *
 * The model keeps appending the project and other fields in parentheses no
 * matter how the prompt is worded, and in a 300px panel it is what pushes each
 * row onto three lines. Only a parenthetical sitting directly after a link and
 * made entirely of known field names or values is removed, so ordinary prose
 * parentheses — and a title's own "(3)", which sits inside the brackets — are
 * untouched.
 */
const FIELD_NOISE =
  /^(?:project|sprint|state|status|type|priority|estimate|assignee|reviewer|points?)\b|^(?:no sprint|unassigned|backlog|blocker|high|medium|low|done|to ?do)$/i;

/** Runs `fn` over the parts of a reply that are not already inside a link. */
function outsideLinks(reply, fn) {
  // splitting on a pattern with two capture groups yields a flat
  // [text, linkText, target, text, ...], so the links are rebuilt on the way out
  const parts = reply.split(/\[([^\]\n]+)\]\(([^)\s]*)\)/);
  let out = "";

  for (let i = 0; i < parts.length; i += 3) {
    out += fn(parts[i] ?? "");
    if (i + 2 < parts.length) out += `[${parts[i + 1]}](${parts[i + 2]})`;
  }
  return out;
}

/**
 * Links a story the model named but did not link.
 *
 * The model links reliably when it is listing things and stubbornly refuses
 * when it is describing one story in depth — exactly the answer where the link
 * is most wanted. Rather than keep rewording the prompt, the titles we handed
 * it are matched back: the first plain-text occurrence of a title we have a url
 * for becomes a link.
 *
 * Only the first, and only if that url is not already linked somewhere in the
 * reply, so a list the model linked properly is never touched twice.
 */
function linkTitles(reply, titles) {
  let out = reply;

  for (const [title, url] of titles) {
    if (out.includes(`](${url})`)) continue;

    let done = false;
    out = outsideLinks(out, (text) => {
      if (done) return text;
      const index = text.indexOf(title);
      if (index === -1) return text;
      done = true;
      return `${text.slice(0, index)}[${title}](${url})${text.slice(index + title.length)}`;
    });
  }

  return out;
}

/**
 * Rewrites `# Heading` as a bold line.
 *
 * The panel styles headings at roughly body size anyway, so a heading costs a
 * line and buys nothing, and the model emits them however firmly the prompt
 * says not to. Fenced code is skipped so a comment quoting a shell prompt or a
 * markdown sample survives intact.
 */
function flattenHeadings(reply) {
  let inFence = false;

  return reply
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, (whole, heading) => {
        // the model often bolds its headings too; "****text****" is not bold
        const inner = heading.replace(/^\*\*([\s\S]*)\*\*$/, "$1").trim();
        return inner ? `**${inner}**` : whole;
      });
    })
    .join("\n");
}

const stripFieldNoise = (reply) =>
  reply.replace(/(\]\([^)\s]*\))[ \t]*\(([^()\n]{1,80})\)/g, (whole, link, inside) => {
    const parts = inside
      .split(/\s*[,;·|]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

    // Every part has to be terse enough to be a field rather than a clause,
    // and at least one has to name a field we recognise. That catches a bare
    // project name in "(Atlas, High)" while sparing real prose, which runs
    // longer and matches nothing.
    const terse = parts.length > 0 && parts.every((part) => part.split(/\s+/).length <= 2);
    return terse && parts.some((part) => FIELD_NOISE.test(part)) ? link : whole;
  });

/**
 * Runs the loop until the model answers in prose or the turn cap is reached.
 *
 * Dependencies are injected so this can run without a network or a child
 * process.
 *
 * @param {object} options.mcp       facade from mcpClient.connectAsUser
 * @param {object} options.cohere    a CohereClientV2 (or a stub)
 * @param {Array}  options.messages  the visible exchange, oldest first
 * @param {object} options.user      the user being helped
 */
async function runConversation({ mcp, cohere, messages, user, model = DEFAULT_MODEL, maxTurns = DEFAULT_MAX_TURNS }) {
  const mcpTools = await mcp.listTools();
  const tools = toCohereTools(mcpTools);

  // rebuilt every request rather than replayed, so the date it carries stays
  // correct and a client can never supply one of its own
  const history = [{ role: "system", content: buildSystemPrompt({ user, tools: mcpTools }) }, ...messages];

  const used = [];
  // seeded with links from earlier answers, so a follow-up that repeats one
  // keeps it even when this turn ran no tool
  const urls = publishedUrls(messages);
  const titles = new Map();
  let lastText = "";

  // verify first, so linkTitles cannot resurrect a target we just rejected
  const finish = (reply) =>
    stripFieldNoise(linkTitles(flattenHeadings(verifyLinks(reply, urls)), titles));

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    // a copy: history keeps growing, and the SDK should not see it change
    const { message = {} } = (await cohere.chat({ model, messages: [...history], tools })) ?? {};
    const calls = message.toolCalls ?? [];
    const text = assistantText(message);
    if (text) lastText = text;

    // echoed back exactly as produced, or the next call loses the thread of
    // its own tool plan
    history.push({
      role: "assistant",
      ...(message.toolPlan && { toolPlan: message.toolPlan }),
      ...(calls.length && { toolCalls: calls }),
      ...(text && { content: text }),
    });

    if (!calls.length) {
      // a turn with neither prose nor a tool call is the model giving up; an
      // empty bubble in the panel would look like a bug rather than an answer
      const reply = text || "I don't have an answer for that. Try asking another way.";
      return { reply: finish(reply), turns: turn, toolCalls: used, stoppedBecause: "answered" };
    }

    for (const call of calls) {
      const name = call.function?.name ?? "unknown";
      let output;
      let isError = true;

      try {
        const result = await mcp.callTool(name, JSON.parse(call.function?.arguments || "{}"));
        output = resultText(result) || "The tool returned nothing.";
        isError = Boolean(result?.isError);
        if (!isError) collectUrls(safeParse(output), urls, titles);
      } catch (err) {
        // bad JSON arguments, an unknown tool name, or the child dying mid-call
        output = err.message;
      }

      used.push({ name, isError });
      history.push({
        role: "tool",
        toolCallId: call.id,
        content: [{ type: "text", text: toolContent(name, output, isError) }],
      });
    }
  }

  return {
    reply: finish(lastText || "I ran out of tool budget before I got to an answer. Try narrowing the question."),
    turns: maxTurns,
    toolCalls: used,
    stoppedBecause: "turn_limit",
  };
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_MAX_TURNS,
  toCohereTools,
  assistantText,
  toolContent,
  collectUrls,
  publishedUrls,
  verifyLinks,
  linkTitles,
  flattenHeadings,
  stripFieldNoise,
  runConversation,
};
