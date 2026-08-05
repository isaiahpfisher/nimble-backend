// The agent loop and the Cohere adapter.
//
// No network and no database: `cohere` is a scripted stub and `callTool` is a
// function, which is the whole point of the loop taking both as arguments.

const {
  runConversation,
  ask,
  readText,
  unfence,
  packResult,
  applyContext,
  parseArguments,
  NO_ANSWER,
  OUT_OF_BUDGET,
} = require("../../app/assistant/chat");

const USER = { id: 1, firstName: "Ada", lastName: "Lovelace" };

const TOOLS = [
  {
    name: "get_my_work",
    description: "What I should work on.",
    parameters: { type: "object", properties: {}, required: [] },
    write: false,
  },
  {
    name: "get_sprints",
    description: "Sprints in a project.",
    parameters: {
      type: "object",
      properties: { projectId: { type: "integer" }, sprintId: { type: "integer" } },
      required: ["projectId"],
    },
    write: false,
  },
  {
    name: "create_story",
    description: "Create a story.",
    parameters: {
      type: "object",
      properties: { projectId: { type: "integer" }, title: { type: "string" } },
      required: ["projectId", "title"],
    },
    write: true,
  },
];

/** A cohere stub that replies with the scripted messages, in order. */
const scripted = (...messages) => {
  const queue = [...messages];
  const requests = [];

  return {
    requests,
    chat: async (request) => {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error("the stub ran out of scripted replies");
      if (next instanceof Error) throw next;
      return { message: next };
    },
  };
};

const call = (name, args = {}, id = "c1") => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const says = (content) => ({ role: "assistant", content });
const asks = (...calls) => ({ role: "assistant", toolCalls: calls });

const ask1 = [{ role: "user", content: "what should I work on?" }];

describe("runConversation", () => {
  it("answers straight away when the model needs no tool", async () => {
    const cohere = scripted(says("Nimble measures sprints in points."));

    const result = await runConversation({
      cohere,
      tools: TOOLS,
      callTool: jest.fn(),
      user: USER,
      messages: [{ role: "user", content: "how are sprints measured?" }],
    });

    expect(result.reply).toBe("Nimble measures sprints in points.");
    expect(result.toolCalls).toEqual([]);
    expect(result.turns).toBe(1);
    expect(result.stoppedBecause).toBe("answered");
  });

  it("runs a tool, feeds the result back, and answers from it", async () => {
    const cohere = scripted(asks(call("get_my_work")), says("You have three stories."));
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: { assigned: { matched: 3 } } });

    const result = await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(callTool).toHaveBeenCalledWith("get_my_work", {});
    expect(result.reply).toBe("You have three stories.");
    expect(result.toolCalls).toEqual([{ name: "get_my_work", isWrite: false, isError: false }]);
    expect(result.turns).toBe(2);

    // the result reached the model as a tool message
    const second = cohere.requests[1].messages;
    expect(second.at(-1)).toMatchObject({ role: "tool", toolCallId: "c1" });
    expect(second.at(-1).content[0].text).toContain('"matched":3');
  });

  it("hands a tool failure back for the model to correct, rather than throwing", async () => {
    const cohere = scripted(asks(call("get_sprints", { projectId: 99 })), says("You are not in project 99."));
    const callTool = jest.fn().mockResolvedValue({ ok: false, error: "not a member of project 99" });

    const result = await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(result.toolCalls).toEqual([{ name: "get_sprints", isWrite: false, isError: true }]);
    expect(cohere.requests[1].messages.at(-1).content[0].text).toContain("not a member of project 99");
    expect(result.reply).toBe("You are not in project 99.");
  });

  it("marks a write as a write, so the prompt's ledger can report it", async () => {
    const cohere = scripted(asks(call("create_story", { projectId: 1, title: "X" })), says("Created it."));
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: { id: 901 } });

    const result = await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(result.toolCalls).toEqual([{ name: "create_story", isWrite: true, isError: false }]);
  });

  it("tells the model what it has done so far, every turn", async () => {
    const cohere = scripted(asks(call("create_story", { projectId: 1, title: "X" })), says("Created it."));
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: {} });

    await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(cohere.requests[0].messages[0].content).toContain("have not run any tools yet");
    expect(cohere.requests[1].messages[0].content).toContain("create_story (write) — succeeded");
  });

  it("runs several tool calls from one turn, in order", async () => {
    const cohere = scripted(
      asks(call("get_my_work", {}, "a"), call("get_sprints", { projectId: 1 }, "b")),
      says("Here is both."),
    );
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: {} });

    const result = await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(callTool.mock.calls.map(([name]) => name)).toEqual(["get_my_work", "get_sprints"]);
    expect(result.toolCalls).toHaveLength(2);
  });

  it("turns malformed arguments into a failure the model can read", async () => {
    const cohere = scripted(
      { role: "assistant", toolCalls: [{ id: "c1", function: { name: "get_sprints", arguments: "{oops" } }] },
      says("Let me try again."),
    );
    const callTool = jest.fn();

    const result = await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(callTool).not.toHaveBeenCalled();
    expect(result.toolCalls[0].isError).toBe(true);
    expect(cohere.requests[1].messages.at(-1).content[0].text).toContain("not valid JSON");
  });

  it("stops at the turn cap and says that is what stopped it", async () => {
    const cohere = scripted(...Array.from({ length: 3 }, () => asks(call("get_my_work"))));
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: {} });

    const result = await runConversation({
      cohere,
      tools: TOOLS,
      callTool,
      user: USER,
      messages: ask1,
      maxTurns: 3,
    });

    expect(result.stoppedBecause).toBe("turn_limit");
    expect(result.reply).toBe(OUT_OF_BUDGET);
    expect(result.toolCalls).toHaveLength(3);
  });

  it("does not leave an empty bubble when the model gives up", async () => {
    const cohere = scripted({ role: "assistant" });

    const result = await runConversation({
      cohere,
      tools: TOOLS,
      callTool: jest.fn(),
      user: USER,
      messages: ask1,
    });

    expect(result.reply).toBe(NO_ANSWER);
  });

  it("keeps an earlier answer when the model then falls over", async () => {
    const cohere = scripted(
      { role: "assistant", content: "You have three stories.", toolCalls: [call("get_my_work")] },
      new Error("upstream is down"),
    );
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: {} });

    const result = await runConversation({ cohere, tools: TOOLS, callTool, user: USER, messages: ask1 });

    expect(result.reply).toBe("You have three stories.");
    expect(result.stoppedBecause).toBe("model_error");
  });

  it("rethrows when the model fell over with nothing to show for it", async () => {
    // `ask` retries before giving up, so every attempt has to fail
    const cohere = { chat: jest.fn().mockRejectedValue(new Error("upstream is down")) };

    await expect(
      runConversation({ cohere, tools: TOOLS, callTool: jest.fn(), user: USER, messages: ask1 }),
    ).rejects.toThrow("upstream is down");
  });

  it("carries the visible transcript into the request", async () => {
    const cohere = scripted(says("The first one."));
    const messages = [
      { role: "user", content: "what am I working on?" },
      { role: "assistant", content: "Three things." },
      { role: "user", content: "and the first?" },
    ];

    await runConversation({ cohere, tools: TOOLS, callTool: jest.fn(), user: USER, messages });

    // slot 0 is the system prompt; the rest is the client's own transcript
    expect(cohere.requests[0].messages.slice(1)).toEqual(messages);
  });

  it("advertises the tools in Cohere's function envelope", async () => {
    const cohere = scripted(says("hi"));
    await runConversation({ cohere, tools: TOOLS, callTool: jest.fn(), user: USER, messages: ask1 });

    expect(cohere.requests[0].tools[0]).toEqual({
      type: "function",
      function: {
        name: "get_my_work",
        description: "What I should work on.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
  });
});

describe("applyContext", () => {
  const sprints = TOOLS[1];
  const myWork = TOOLS[0];

  it("fills a required id the model left out", () => {
    expect(applyContext({}, sprints, { projectId: 7 })).toEqual({ projectId: 7 });
  });

  it("never overrides what the model actually sent", () => {
    expect(applyContext({ projectId: 3 }, sprints, { projectId: 7 })).toEqual({ projectId: 3 });
  });

  it("leaves optional fields alone, since omitting one means something", () => {
    expect(applyContext({ projectId: 1 }, sprints, { projectId: 1, sprintId: 9 })).toEqual({ projectId: 1 });
    expect(applyContext({}, myWork, { projectId: 7 })).toEqual({});
  });

  it("treats an explicit null as absent", () => {
    expect(applyContext({ projectId: null }, sprints, { projectId: 7 })).toEqual({ projectId: 7 });
  });

  it("does nothing when the page has no context to give", () => {
    expect(applyContext({}, sprints, {})).toEqual({});
    expect(applyContext({}, undefined, { projectId: 7 })).toEqual({});
  });
});

describe("the loop fills page context on the way to the tool", () => {
  it("passes the project on screen to a tool that requires it", async () => {
    const cohere = scripted(asks(call("get_sprints", {})), says("It ends on the 9th."));
    const callTool = jest.fn().mockResolvedValue({ ok: true, result: {} });

    await runConversation({
      cohere,
      tools: TOOLS,
      callTool,
      user: USER,
      messages: [{ role: "user", content: "when does the sprint end?" }],
      context: { projectId: 4 },
    });

    expect(callTool).toHaveBeenCalledWith("get_sprints", { projectId: 4 });
  });
});

describe("packResult", () => {
  it("nests the payload so Cohere never sees a numeric top-level id", () => {
    const packed = JSON.parse(packResult("get_story", { ok: true, result: { id: 70, title: "X" } }));

    expect(packed).toEqual({ tool: "get_story", result: { id: 70, title: "X" } });
    expect(packed.id).toBeUndefined();
  });

  it("labels a failure with the tool that produced it", () => {
    expect(JSON.parse(packResult("get_story", { ok: false, error: "nope" }))).toEqual({
      tool: "get_story",
      error: "nope",
    });
  });
});

describe("reading what the model said", () => {
  it("accepts content as a string or as blocks", () => {
    expect(readText({ content: "  hello " })).toBe("hello");
    expect(readText({ content: [{ text: "one " }, { text: "two" }] })).toBe("one two");
    expect(readText({})).toBe("");
    expect(readText(null)).toBe("");
  });

  it("strips a json fence", () => {
    expect(unfence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unfence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unfence('{"a":1}')).toBe('{"a":1}');
  });

  it("reports malformed tool arguments rather than throwing", () => {
    expect(parseArguments('{"a":1}')).toEqual({ ok: true, args: { a: 1 } });
    expect(parseArguments("")).toEqual({ ok: true, args: {} });
    expect(parseArguments("{oops").ok).toBe(false);
  });
});

describe("ask", () => {
  const status = (statusCode, message = "boom") => Object.assign(new Error(message), { statusCode });

  it("returns the message on the first success", async () => {
    const cohere = { chat: jest.fn().mockResolvedValue({ message: { content: "hi" } }) };

    expect(await ask(cohere, {})).toEqual({ content: "hi" });
    expect(cohere.chat).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit and succeeds", async () => {
    const cohere = {
      chat: jest.fn().mockRejectedValueOnce(status(429)).mockResolvedValue({ message: { content: "hi" } }),
    };

    expect(await ask(cohere, {})).toEqual({ content: "hi" });
    expect(cohere.chat).toHaveBeenCalledTimes(2);
  });

  it("retries a dropped connection, which carries no status at all", async () => {
    const cohere = {
      chat: jest.fn().mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue({ message: {} }),
    };

    await expect(ask(cohere, {})).resolves.toEqual({});
    expect(cohere.chat).toHaveBeenCalledTimes(2);
  });

  // Cohere's 422 NO_TOOL_CALL_OR_RESPONSE_GENERATED is not deterministic: the
  // same request usually succeeds on a second attempt.
  it("retries an empty generation", async () => {
    const empty = status(422, "NO_TOOL_CALL_OR_RESPONSE_GENERATED");
    const cohere = { chat: jest.fn().mockRejectedValueOnce(empty).mockResolvedValue({ message: {} }) };

    await expect(ask(cohere, {})).resolves.toEqual({});
    expect(cohere.chat).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt, raising what the provider said", async () => {
    const cohere = { chat: jest.fn().mockRejectedValue(status(503)) };

    await expect(ask(cohere, {}, { attempts: 3 })).rejects.toThrow("boom");
    expect(cohere.chat).toHaveBeenCalledTimes(3);
  });

  it("honours a lower attempt count", async () => {
    const cohere = { chat: jest.fn().mockRejectedValue(status(503)) };

    await expect(ask(cohere, {}, { attempts: 1 })).rejects.toThrow("boom");
    expect(cohere.chat).toHaveBeenCalledTimes(1);
  });

  it("answers with an empty message rather than undefined", async () => {
    const cohere = { chat: jest.fn().mockResolvedValue({}) };
    expect(await ask(cohere, {})).toEqual({});
  });
});

// The prompt is what the loop actually sends, so it is tested here rather than
// on its own.
describe("buildSystemPrompt", () => {
  const { buildSystemPrompt, ledger } = require("../../app/assistant/prompt");

  const build = (options = {}) =>
    buildSystemPrompt({ user: USER, now: new Date("2026-08-04T00:00:00Z"), ...options });

  it("names who is being helped, and today", () => {
    const prompt = build();

    expect(prompt).toContain("Ada Lovelace (user id 1)");
    expect(prompt).toContain("Today is 2026-08-04");
  });

  it("carries enough about Nimble to answer an FAQ without a tool", () => {
    const prompt = build();

    expect(prompt).toContain("# About Nimble");
    expect(prompt).toContain("burndown chart");
    expect(prompt).toContain("**backlog**");
    expect(prompt).toContain("Planned, Active or");
    expect(prompt).toContain("permission granted per member");
    expect(prompt).toContain('from "About Nimble"');
  });

  it("makes the project on screen the default", () => {
    const prompt = build({ context: { projectId: 4 } });

    expect(prompt).toContain("looking at project 4");
    expect(prompt).toContain("Pass 4 as `projectId`");
  });

  it("says there is no default when they are not in a project", () => {
    const prompt = build({ context: {} });

    expect(prompt).toContain("not looking at any particular project");
    expect(prompt).not.toContain("Pass  as");
  });

  it("resolves 'this story' to the one that is open", () => {
    const prompt = build({ context: { projectId: 4, storyId: 71 } });
    expect(prompt).toContain("story 71 open");
  });

  it("mentions the open story only when there is a project too", () => {
    expect(build({ context: { storyId: 71 } })).not.toContain("story 71 open");
  });

  it("resolves 'this sprint' to the one on screen", () => {
    expect(build({ context: { projectId: 4, sprintId: 200 } })).toContain("looking at sprint 200");
  });

  it("states the two prose formats it is ever asked to write", () => {
    const prompt = build();

    expect(prompt).toContain("As a <who>, when I <when>, I want to <what>, so that <why>.");
    expect(prompt).toContain("Given <starting state>, when <action>, then <observable result>.");
  });

  it("is clear about the narrow write surface", () => {
    const prompt = build();

    expect(prompt).toContain("create stories and add acceptance criteria");
    expect(prompt).toContain("You cannot edit, move,");
    expect(prompt).toContain("reassign, comment on or delete anything");
  });

  it("hands over the record of what it has done, rather than asking it to remember", () => {
    expect(ledger([])).toContain("have not run any tools yet");
    expect(ledger([{ name: "create_story", isWrite: true, isError: false }])).toContain(
      "create_story (write) — succeeded",
    );
    expect(ledger([{ name: "get_sprints", isWrite: false, isError: true }])).toContain(
      "get_sprints — failed",
    );
  });
});
