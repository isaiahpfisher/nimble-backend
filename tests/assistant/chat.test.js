const {
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
} = require("../../app/assistant/chat");

const TOOLS = [
  { name: "get_story", description: "Fetch one story.", inputSchema: { type: "object", properties: {} } },
];

/** An MCP facade whose callTool answers from a name -> result map. */
function mockMcp(results = {}, tools = TOOLS) {
  return {
    listTools: jest.fn(async () => tools),
    callTool: jest.fn(async (name) => {
      const result = results[name];
      if (result === undefined) throw new Error(`Unknown tool: ${name}`);
      if (typeof result === "function") return result();
      return result;
    }),
    close: jest.fn(async () => {}),
  };
}

/** A Cohere stub that plays back one canned response per turn. */
const mockCohere = (...turns) => ({
  chat: jest.fn(async () => ({ message: turns.shift() ?? { content: "..." } })),
});

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const toolCall = (id, name, args = {}) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const run = (options) =>
  runConversation({ user: { id: 1, firstName: "Ada", lastName: "Lovelace" }, messages: [], ...options });

describe("toCohereTools", () => {
  it("wraps MCP tools in Cohere's function envelope", () => {
    expect(toCohereTools(TOOLS)).toEqual([
      {
        type: "function",
        function: {
          name: "get_story",
          description: "Fetch one story.",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("falls back to an empty schema for a tool that advertises none", () => {
    const [tool] = toCohereTools([{ name: "ping", title: "Ping" }]);
    expect(tool.function.description).toBe("Ping");
    expect(tool.function.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("assistantText", () => {
  it("reads content whether it is a string or a list of blocks", () => {
    expect(assistantText({ content: " hello " })).toBe("hello");
    expect(assistantText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
  });

  it("is empty for a message that carries only tool calls", () => {
    expect(assistantText({ toolCalls: [toolCall("1", "get_story")] })).toBe("");
    expect(assistantText(undefined)).toBe("");
  });
});

describe("toolContent", () => {
  // Cohere reads a tool result as a Document and rejects a non-string
  // top-level id with a 400 before the model ever sees the payload
  it("nests the payload so a numeric top-level id never reaches Cohere", () => {
    const packed = JSON.parse(toolContent("get_story", JSON.stringify({ id: 7, title: "Login" }), false));

    expect(packed.id).toBeUndefined();
    expect(packed).toEqual({ tool: "get_story", result: { id: 7, title: "Login" } });
  });

  it("keeps non-JSON output as the string it is", () => {
    expect(JSON.parse(toolContent("get_story", "nothing here", false))).toEqual({
      tool: "get_story",
      result: "nothing here",
    });
  });

  it("labels a failure so the model can correct itself", () => {
    expect(JSON.parse(toolContent("get_story", "Not found (HTTP 404)", true))).toEqual({
      tool: "get_story",
      error: "Not found (HTTP 404)",
    });
  });
});

describe("collectUrls", () => {
  it("finds in-app urls at any depth", () => {
    const { urls } = collectUrls({
      stories: [{ url: "/projects/1/stories/7" }, { url: "/projects/1/stories/8" }],
      sprint: { url: "/projects/1/sprints/3" },
    });

    expect([...urls]).toEqual(["/projects/1/stories/7", "/projects/1/stories/8", "/projects/1/sprints/3"]);
  });

  it("pairs each url with its title", () => {
    const { titles } = collectUrls({ stories: [{ title: "Add login page", url: "/projects/1/stories/7" }] });

    expect(titles.get("Add login page")).toBe("/projects/1/stories/7");
  });

  it("keeps the outermost url for a title repeated deeper in the payload", () => {
    const { titles } = collectUrls({
      title: "Add login page",
      url: "/projects/1/stories/7",
      relations: [{ title: "Add login page", url: "/projects/9/stories/99" }],
    });

    expect(titles.get("Add login page")).toBe("/projects/1/stories/7");
  });

  it("ignores absolute urls, non-strings and titles too short to match safely", () => {
    expect([...collectUrls({ url: "https://github.com/x" }).urls]).toEqual([]);
    expect([...collectUrls({ url: 7 }).urls]).toEqual([]);
    expect([...collectUrls(null).urls]).toEqual([]);
    expect(collectUrls({ title: "API", url: "/projects/1" }).titles.size).toBe(0);
  });
});

describe("publishedUrls", () => {
  // the transcript carries only prose, so a follow-up turn would otherwise
  // start with an empty allow-list and lose every link it repeats
  it("trusts links the assistant already published", () => {
    const urls = publishedUrls([
      { role: "user", content: "what am I working on?" },
      { role: "assistant", content: "- [Login](/projects/1/stories/7)" },
      { role: "user", content: "tell me about that one" },
    ]);

    expect([...urls]).toEqual(["/projects/1/stories/7"]);
  });

  it("ignores links in the user's own messages", () => {
    expect([...publishedUrls([{ role: "user", content: "[x](/projects/9/stories/99)" }])]).toEqual([]);
  });
});

describe("linkTitles", () => {
  const titles = new Map([["CSV export mangles UTF-8", "/projects/1/stories/60"]]);

  it("links a story the model named but did not link", () => {
    expect(linkTitles("**CSV export mangles UTF-8**\n\nIt is a bug.", titles)).toBe(
      "**[CSV export mangles UTF-8](/projects/1/stories/60)**\n\nIt is a bug.",
    );
  });

  it("leaves the reply alone when that story is already linked", () => {
    const reply = "See [CSV export mangles UTF-8](/projects/1/stories/60) — CSV export mangles UTF-8 is a bug.";
    expect(linkTitles(reply, titles)).toBe(reply);
  });

  it("links only the first mention", () => {
    expect(linkTitles("CSV export mangles UTF-8 — CSV export mangles UTF-8", titles)).toBe(
      "[CSV export mangles UTF-8](/projects/1/stories/60) — CSV export mangles UTF-8",
    );
  });

  it("never rewrites the inside of an existing link", () => {
    const reply = "[see CSV export mangles UTF-8 here](/projects/2/stories/8)";
    expect(linkTitles(reply, titles)).toBe(reply);
  });

  it("handles a title containing regex metacharacters", () => {
    const tricky = new Map([["Fix (a+b) [beta]", "/projects/1/stories/7"]]);
    expect(linkTitles("Fix (a+b) [beta] is next.", tricky)).toBe("[Fix (a+b) [beta]](/projects/1/stories/7) is next.");
  });
});

describe("flattenHeadings", () => {
  it("turns headings into bold lines", () => {
    expect(flattenHeadings("# Story\n## Detail\ntext")).toBe("**Story**\n**Detail**\ntext");
  });

  it("leaves a hash inside fenced code alone", () => {
    expect(flattenHeadings("```\n# not a heading\n```")).toBe("```\n# not a heading\n```");
  });

  it("does not touch a hash mid-line", () => {
    expect(flattenHeadings("issue #7 is open")).toBe("issue #7 is open");
  });

  // "****text****" renders as literal asterisks, not bold
  it("does not double up on a heading the model already bolded", () => {
    expect(flattenHeadings("## **Acceptance Criteria**")).toBe("**Acceptance Criteria**");
  });
});

describe("stripFieldNoise", () => {
  it("removes a metadata parenthetical trailing a link", () => {
    expect(stripFieldNoise("- [Story templates](/projects/2/stories/96) (project: Atlas)")).toBe(
      "- [Story templates](/projects/2/stories/96)",
    );
  });

  it("removes a bare comma-separated one too", () => {
    expect(stripFieldNoise("[Story templates](/projects/2/stories/96) (Atlas, High, no sprint)")).toBe(
      "[Story templates](/projects/2/stories/96)",
    );
  });

  it("keeps a parenthetical that is real prose", () => {
    const reply = "[Story templates](/projects/2/stories/96) (which Bob raised last week)";
    expect(stripFieldNoise(reply)).toBe(reply);
  });

  it("keeps parentheses that are part of the title", () => {
    const reply = "[Story templates (2)](/projects/2/stories/96) is next.";
    expect(stripFieldNoise(reply)).toBe(reply);
  });
});

describe("verifyLinks", () => {
  const allowed = new Set(["/projects/1/stories/7"]);

  it("keeps a link whose target came from a tool result", () => {
    expect(verifyLinks("See [Login](/projects/1/stories/7).", allowed)).toBe("See [Login](/projects/1/stories/7).");
  });

  it("demotes an invented link to plain text", () => {
    expect(verifyLinks("See [Login](/projects/9/stories/99).", allowed)).toBe("See Login.");
  });

  it("leaves external links alone", () => {
    expect(verifyLinks("[repo](https://github.com/x)", allowed)).toBe("[repo](https://github.com/x)");
  });

  it("checks every link in a list independently", () => {
    const reply = "- [A](/projects/1/stories/7)\n- [B](/projects/1/stories/8)";
    expect(verifyLinks(reply, allowed)).toBe("- [A](/projects/1/stories/7)\n- B");
  });
});

describe("runConversation", () => {
  it("returns the reply when the model answers without tools", async () => {
    const result = await run({ mcp: mockMcp(), cohere: mockCohere({ content: "Hello." }) });

    expect(result).toMatchObject({ reply: "Hello.", turns: 1, toolCalls: [], stoppedBecause: "answered" });
  });

  it("prepends a system prompt naming the user", async () => {
    const cohere = mockCohere({ content: "Hi Ada." });
    await run({ mcp: mockMcp(), cohere });

    const [system] = cohere.chat.mock.calls[0][0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("Ada Lovelace");
  });

  it("runs a tool, feeds the result back, and answers on the next turn", async () => {
    const mcp = mockMcp({ get_story: text({ id: 7, title: "Login", url: "/projects/1/stories/7" }) });
    const cohere = mockCohere(
      { toolPlan: "I will look it up.", toolCalls: [toolCall("call-1", "get_story", { storyId: 7 })] },
      { content: "It is [Login](/projects/1/stories/7)." },
    );

    const result = await run({ mcp, cohere });

    expect(mcp.callTool).toHaveBeenCalledWith("get_story", { storyId: 7 });
    expect(result).toMatchObject({
      reply: "It is [Login](/projects/1/stories/7).",
      turns: 2,
      toolCalls: [{ name: "get_story", isError: false }],
      stoppedBecause: "answered",
    });

    // the second request carries the assistant turn and its tool result
    const replayed = cohere.chat.mock.calls[1][0].messages;
    expect(replayed.at(-2)).toMatchObject({ role: "assistant", toolPlan: "I will look it up." });
    expect(replayed.at(-1)).toMatchObject({ role: "tool", toolCallId: "call-1" });
  });

  it("strips a link the model invented for a story it never fetched", async () => {
    const mcp = mockMcp({ get_story: text({ id: 7, title: "Login", url: "/projects/1/stories/7" }) });
    const cohere = mockCohere(
      { toolCalls: [toolCall("call-1", "get_story", { storyId: 7 })] },
      { content: "[Login](/projects/1/stories/7) blocks [Signup](/projects/1/stories/8)." },
    );

    const { reply } = await run({ mcp, cohere });

    expect(reply).toBe("[Login](/projects/1/stories/7) blocks Signup.");
  });

  it("does not trust urls from a failed tool call", async () => {
    const mcp = mockMcp({ get_story: { ...text({ url: "/projects/1/stories/7" }), isError: true } });
    const cohere = mockCohere(
      { toolCalls: [toolCall("call-1", "get_story", { storyId: 7 })] },
      { content: "[Login](/projects/1/stories/7)" },
    );

    const result = await run({ mcp, cohere });

    expect(result.reply).toBe("Login");
    expect(result.toolCalls).toEqual([{ name: "get_story", isError: true }]);
  });

  it("hands a tool failure back to the model rather than throwing", async () => {
    const mcp = mockMcp({
      get_story: { content: [{ type: "text", text: "Not found (HTTP 404)" }], isError: true },
    });
    const cohere = mockCohere(
      { toolCalls: [toolCall("call-1", "get_story", { storyId: 99 })] },
      { content: "That story does not exist." },
    );

    const result = await run({ mcp, cohere });

    const toolMessage = cohere.chat.mock.calls[1][0].messages.at(-1);
    expect(JSON.parse(toolMessage.content[0].text)).toEqual({ tool: "get_story", error: "Not found (HTTP 404)" });
    expect(result.reply).toBe("That story does not exist.");
  });

  it("survives a tool that throws and one whose arguments are not JSON", async () => {
    const mcp = mockMcp({});
    const cohere = mockCohere(
      {
        toolCalls: [
          toolCall("call-1", "no_such_tool"),
          { id: "call-2", type: "function", function: { name: "get_story", arguments: "{oops" } },
        ],
      },
      { content: "I could not look that up." },
    );

    const result = await run({ mcp, cohere });

    expect(result.toolCalls).toEqual([
      { name: "no_such_tool", isError: true },
      { name: "get_story", isError: true },
    ]);
    expect(result.reply).toBe("I could not look that up.");
  });

  it("stops at the turn cap and says so", async () => {
    const mcp = mockMcp({ get_story: text({ id: 7 }) });
    const cohere = {
      chat: jest.fn(async () => ({
        message: { content: "Still looking.", toolCalls: [toolCall("call-1", "get_story")] },
      })),
    };

    const result = await run({ mcp, cohere, maxTurns: 3 });

    expect(cohere.chat).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ turns: 3, stoppedBecause: "turn_limit", reply: "Still looking." });
  });

  it("explains itself when it hits the cap without ever producing prose", async () => {
    const mcp = mockMcp({ get_story: text({ id: 7 }) });
    const cohere = {
      chat: jest.fn(async () => ({ message: { toolCalls: [toolCall("call-1", "get_story")] } })),
    };

    const { reply } = await run({ mcp, cohere, maxTurns: 2 });

    expect(reply).toMatch(/tool budget/);
  });
});
