const { runConversation, NO_ANSWER, OUT_OF_BUDGET } = require("../../app/assistant/loop");

const READ = { name: "get_story", description: "Fetch one story.", parameters: {}, write: false };
const WRITE = { name: "update_story", description: "Change a story.", parameters: {}, write: true };

/** A Cohere stub that plays back one canned message per turn. */
const mockCohere = (...turns) => ({
  chat: jest.fn(async () => ({ message: turns.shift() ?? { content: "..." } })),
});

const toolCall = (id, name, args = {}) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

/** A callTool that answers from a name -> result map; anything else fails. */
const mockTools = (results = {}) =>
  jest.fn(async (name) =>
    name in results ? { ok: true, result: results[name] } : { ok: false, error: `No tool called ${name}.` },
  );

const run = (options) =>
  runConversation({
    user: { id: 1, firstName: "Ada", lastName: "Lovelace" },
    messages: [{ role: "user", content: "what am I working on?" }],
    tools: [READ],
    callTool: mockTools(),
    ...options,
  });

/** The system prompt sent on a given turn. */
const promptOn = (cohere, turn = 0) => cohere.chat.mock.calls[turn][0].messages[0].content;

describe("answering", () => {
  it("returns the reply when the model answers without tools", async () => {
    const result = await run({ cohere: mockCohere({ content: "Hello." }) });

    expect(result).toMatchObject({ reply: "Hello.", turns: 1, toolCalls: [], stoppedBecause: "answered" });
  });

  it("says something rather than nothing when the model produces neither prose nor a call", async () => {
    const { reply } = await run({ cohere: mockCohere({}) });

    expect(reply).toBe(NO_ANSWER);
  });

  it("runs a tool, feeds the result back, and answers on the next turn", async () => {
    const callTool = mockTools({ get_story: { id: 7, title: "Login", url: "/projects/1/stories/7" } });
    const cohere = mockCohere(
      { toolPlan: "I will look it up.", toolCalls: [toolCall("call-1", "get_story", { storyId: 7 })] },
      { content: "It is [Login](/projects/1/stories/7)." },
    );

    const result = await run({ cohere, callTool });

    expect(callTool).toHaveBeenCalledWith("get_story", { storyId: 7 });
    expect(result).toMatchObject({
      reply: "It is [Login](/projects/1/stories/7).",
      turns: 2,
      toolCalls: [{ name: "get_story", isWrite: false, isError: false }],
      stoppedBecause: "answered",
    });

    // the second request carries the assistant turn and its tool result
    const replayed = cohere.chat.mock.calls[1][0].messages;
    expect(replayed.at(-2)).toMatchObject({ role: "assistant", toolPlan: "I will look it up." });
    expect(replayed.at(-1)).toMatchObject({ role: "tool", toolCallId: "call-1" });
    expect(JSON.parse(replayed.at(-1).content[0].text)).toEqual({
      tool: "get_story",
      result: { id: 7, title: "Login", url: "/projects/1/stories/7" },
    });
  });

  // reported from the panel: the model wrote its tool call as prose, the loop
  // read "no calls" as "this is the answer", and the user was shown raw JSON
  it("runs a tool the model wrote as text instead of returning the JSON", async () => {
    const callTool = mockTools({ list_sprints: [{ title: "Atlas Sprint 2", endDate: "2026-08-10" }] });
    const cohere = mockCohere(
      { content: '[\n{"tool_call_id": "0", "tool_name": "list_sprints", "parameters": {"projectId": 2}}\n]' },
      { content: "Atlas Sprint 2 ends on 2026-08-10." },
    );

    const result = await run({
      cohere,
      callTool,
      tools: [{ name: "list_sprints", description: "List sprints.", parameters: {}, write: false }],
    });

    expect(callTool).toHaveBeenCalledWith("list_sprints", { projectId: 2 });
    expect(result.reply).toBe("Atlas Sprint 2 ends on 2026-08-10.");
    expect(result.toolCalls).toEqual([{ name: "list_sprints", isWrite: false, isError: false }]);
  });

  it("stops at the turn cap and says so", async () => {
    const cohere = {
      chat: jest.fn(async () => ({
        message: { content: "Still looking.", toolCalls: [toolCall("call-1", "get_story")] },
      })),
    };

    const result = await run({ cohere, callTool: mockTools({ get_story: { id: 7 } }), maxTurns: 3 });

    expect(cohere.chat).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ turns: 3, stoppedBecause: "turn_limit", reply: "Still looking." });
  });

  it("explains itself when it hits the cap without ever producing prose", async () => {
    const cohere = {
      chat: jest.fn(async () => ({ message: { toolCalls: [toolCall("call-1", "get_story")] } })),
    };

    const { reply } = await run({ cohere, callTool: mockTools({ get_story: {} }), maxTurns: 2 });

    expect(reply).toBe(OUT_OF_BUDGET);
  });
});

describe("tool failures", () => {
  it("hands a refusal back to the model rather than throwing", async () => {
    const callTool = jest.fn(async () => ({ ok: false, error: "Not found (HTTP 404)" }));
    const cohere = mockCohere(
      { toolCalls: [toolCall("call-1", "get_story", { storyId: 99 })] },
      { content: "That story does not exist." },
    );

    const result = await run({ cohere, callTool });

    const toolMessage = cohere.chat.mock.calls[1][0].messages.at(-1);
    expect(JSON.parse(toolMessage.content[0].text)).toEqual({
      tool: "get_story",
      error: "Not found (HTTP 404)",
    });
    expect(result.reply).toBe("That story does not exist.");
    expect(result.toolCalls).toEqual([{ name: "get_story", isWrite: false, isError: true }]);
  });

  // the model writes the arguments itself, so malformed JSON is its mistake to
  // correct rather than something that should end the turn
  it("turns unparseable arguments into a failure it can read", async () => {
    const callTool = mockTools({ get_story: {} });
    const cohere = mockCohere(
      { toolCalls: [{ id: "c1", type: "function", function: { name: "get_story", arguments: "{oops" } }] },
      { content: "I could not look that up." },
    );

    const result = await run({ cohere, callTool });

    expect(callTool).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([{ name: "get_story", isWrite: false, isError: true }]);
    expect(cohere.chat.mock.calls[1][0].messages.at(-1).content[0].text).toMatch(/not valid JSON/);
  });

  it("keeps an answer it already had when the model then collapses", async () => {
    const cohere = {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          message: { content: "Found [Login](/projects/1/stories/7).", toolCalls: [toolCall("c1", "get_story")] },
        })
        .mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 })),
    };

    const result = await run({
      cohere,
      callTool: mockTools({ get_story: { url: "/projects/1/stories/7" } }),
    });

    expect(result.stoppedBecause).toBe("model_error");
    expect(result.reply).toBe("Found [Login](/projects/1/stories/7).");
  });

  it("still throws when it collapsed before saying anything", async () => {
    const cohere = { chat: jest.fn().mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 400 })) };

    await expect(run({ cohere })).rejects.toThrow("boom");
  });
});

describe("links in the reply", () => {
  it("strips a link the model invented for a story it never fetched", async () => {
    const callTool = mockTools({ get_story: { id: 7, title: "Login", url: "/projects/1/stories/7" } });
    const cohere = mockCohere(
      { toolCalls: [toolCall("call-1", "get_story", { storyId: 7 })] },
      { content: "[Login](/projects/1/stories/7) blocks [Signup](/projects/1/stories/8)." },
    );

    const { reply } = await run({ cohere, callTool });

    expect(reply).toBe("[Login](/projects/1/stories/7) blocks Signup.");
  });

  it("does not trust urls from a failed tool call", async () => {
    const callTool = jest.fn(async () => ({ ok: false, error: '{"url": "/projects/1/stories/7"}' }));
    const cohere = mockCohere(
      { toolCalls: [toolCall("call-1", "get_story")] },
      { content: "[Login](/projects/1/stories/7)" },
    );

    const { reply } = await run({ cohere, callTool });

    expect(reply).toBe("Login");
  });

  // what the panel actually showed: the model listed its answer as bare story
  // names, having been asked for markdown links and ignored it
  it("links stories the model named but did not link", async () => {
    const callTool = mockTools({
      get_my_work: {
        assigned: {
          stories: [
            { title: "Sprint velocity report", url: "/projects/1/stories/41" },
            { title: "Document environment variables", url: "/projects/2/stories/12" },
          ],
        },
      },
    });
    const cohere = mockCohere(
      { toolCalls: [toolCall("c1", "get_my_work")] },
      { content: "**Assigned to you**\n- Sprint velocity report\n- Document environment variables" },
    );

    const { reply } = await run({ cohere, callTool });

    expect(reply).toBe(
      "**Assigned to you**\n" +
        "- [Sprint velocity report](/projects/1/stories/41)\n" +
        "- [Document environment variables](/projects/2/stories/12)",
    );
  });

  it("does not link a title it was never shown", async () => {
    const callTool = mockTools({
      get_my_work: { stories: [{ title: "Sprint velocity report", url: "/projects/1/stories/41" }] },
    });
    const cohere = mockCohere(
      { toolCalls: [toolCall("c1", "get_my_work")] },
      { content: "- Sprint velocity report\n- Some story I invented" },
    );

    const { reply } = await run({ cohere, callTool });

    expect(reply).toBe("- [Sprint velocity report](/projects/1/stories/41)\n- Some story I invented");
  });

  // a follow-up turn starts with no tool results, so a link it already
  // published has to survive on its own
  it("keeps a link it vouched for earlier in the conversation", async () => {
    const messages = [
      { role: "user", content: "what am I working on?" },
      { role: "assistant", content: "- [Login](/projects/1/stories/7)" },
      { role: "user", content: "remind me of that one" },
    ];

    const { reply } = await run({ cohere: mockCohere({ content: "[Login](/projects/1/stories/7)" }), messages });

    expect(reply).toBe("[Login](/projects/1/stories/7)");
  });
});

describe("the system prompt", () => {
  it("names the user and is rebuilt rather than replayed", async () => {
    const cohere = mockCohere({ content: "Hi Ada." });
    await run({ cohere });

    const [system] = cohere.chat.mock.calls[0][0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("Ada Lovelace");
  });

  it.each([
    ["the project on screen", { projectId: 7 }, /project id 7/],
    ["the story on screen", { projectId: 2, storyId: 47 }, /They have story 47 open/],
    ["the sprint on screen", { projectId: 2, sprintId: 9 }, /looking at sprint 9/],
    ["no project at all", {}, /not looking at any particular project/],
  ])("describes %s", async (_label, context, expected) => {
    const cohere = mockCohere({ content: "ok" });
    await run({ cohere, context });

    expect(promptOn(cohere)).toMatch(expected);
  });

  it("says nothing about a story when none is open", async () => {
    const cohere = mockCohere({ content: "ok" });
    await run({ cohere, context: { projectId: 2 } });

    expect(promptOn(cohere)).not.toMatch(/They have story \d/);
  });

  it("gives the house style for the prose it composes, but only when it can write", async () => {
    const writable = mockCohere({ content: "ok" });
    await run({ cohere: writable, tools: [READ, WRITE] });

    expect(promptOn(writable)).toContain("As a <who>, when I <when>, I want to <what>, so that <why>.");
    expect(promptOn(writable)).toContain("Given <starting state>, when <action>, then <observable result>.");

    const readOnly = mockCohere({ content: "ok" });
    await run({ cohere: readOnly, tools: [READ] });
    expect(promptOn(readOnly)).not.toMatch(/How to write a description/);
  });

  it("claims write access only when a write tool exists", async () => {
    const readOnly = mockCohere({ content: "ok" });
    await run({ cohere: readOnly, tools: [READ] });
    expect(promptOn(readOnly)).toMatch(/read-only access/);

    const writable = mockCohere({ content: "ok" });
    await run({ cohere: writable, tools: [READ, WRITE] });
    expect(promptOn(writable)).toMatch(/never delete anything/i);
    expect(promptOn(writable)).not.toMatch(/read-only access/);
  });

  // the model cannot check whether it really wrote something, so it is handed
  // the record instead of being asked to remember — this is what stops it
  // reporting a change it never made
  describe("the record of what this turn has done", () => {
    it("starts empty", async () => {
      const cohere = mockCohere({ content: "ok" });
      await run({ cohere });

      expect(promptOn(cohere)).toMatch(/You have not run any tools yet this turn/);
    });

    it("lists each call, with writes marked and failures named", async () => {
      const callTool = jest.fn(async (name) =>
        name === "update_story" ? { ok: true, result: {} } : { ok: false, error: "nope" },
      );
      const cohere = mockCohere(
        { toolCalls: [toolCall("c1", "get_story"), toolCall("c2", "update_story")] },
        { content: "Done." },
      );

      await run({ cohere, callTool, tools: [READ, WRITE] });

      const prompt = promptOn(cohere, 1);
      expect(prompt).toContain("- get_story — failed");
      expect(prompt).toContain("- update_story (write) — succeeded");
      expect(prompt).toMatch(/Report a change as done only if it appears above/);
    });
  });
});

describe("which calls changed data", () => {
  // the panel badges a write differently from a lookup, so the flag comes from
  // the tool's own spec rather than from its name
  it("marks writes from the registry, not from the model", async () => {
    const callTool = mockTools({ get_story: { id: 7 }, update_story: { updated: "story" } });
    const cohere = mockCohere(
      { toolCalls: [toolCall("c1", "get_story"), toolCall("c2", "update_story")] },
      { content: "Done." },
    );

    const { toolCalls } = await run({ cohere, callTool, tools: [READ, WRITE] });

    expect(toolCalls).toEqual([
      { name: "get_story", isWrite: false, isError: false },
      { name: "update_story", isWrite: true, isError: false },
    ]);
  });
});
