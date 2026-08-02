const {
  ask,
  packResult,
  readText,
  recoverToolCalls,
  toolDefinitions,
} = require("../../app/assistant/cohere");

const error = (statusCode, message = "") => Object.assign(new Error(message), { statusCode });
const emptyGeneration = () =>
  error(422, 'UnprocessableEntityError\nBody: {"error_type": "NO_TOOL_CALL_OR_RESPONSE_GENERATED"}');

describe("toolDefinitions", () => {
  it("wraps a registry spec in Cohere's function envelope", () => {
    const specs = [
      { name: "get_story", description: "Fetch one story.", parameters: { type: "object" }, write: false },
    ];

    expect(toolDefinitions(specs)).toEqual([
      {
        type: "function",
        function: { name: "get_story", description: "Fetch one story.", parameters: { type: "object" } },
      },
    ]);
  });
});

describe("readText", () => {
  it("reads content whether it is a string or a list of blocks", () => {
    expect(readText({ content: " hello " })).toBe("hello");
    expect(readText({ content: [{ text: "a" }, { text: "b" }] })).toBe("ab");
  });

  it("is empty for a message that carries only tool calls", () => {
    expect(readText({ toolCalls: [{ id: "1" }] })).toBe("");
    expect(readText(undefined)).toBe("");
  });
});

describe("packResult", () => {
  // Cohere reads a tool result as a Document and rejects a non-string top-level
  // id with a 400 before the model ever sees the payload
  it("nests the payload so a numeric top-level id never reaches Cohere", () => {
    const packed = JSON.parse(packResult("get_story", { ok: true, result: { id: 7, title: "Login" } }));

    expect(packed.id).toBeUndefined();
    expect(packed).toEqual({ tool: "get_story", result: { id: 7, title: "Login" } });
  });

  it("labels a failure so the model can correct itself", () => {
    expect(JSON.parse(packResult("get_story", { ok: false, error: "Not found (HTTP 404)" }))).toEqual({
      tool: "get_story",
      error: "Not found (HTTP 404)",
    });
  });
});

// Cohere sometimes writes the call it meant to make into the content channel
// and leaves toolCalls empty. Taken at face value the loop reads that as the
// final answer, and the user is shown a JSON blob instead of a sprint date.
describe("recoverToolCalls", () => {
  const call = (message) => recoverToolCalls(message).toolCalls;

  it("reads back the shape Cohere actually emitted", () => {
    const message = {
      content: '[\n{"tool_call_id": "0", "tool_name": "list_sprints", "parameters": {"projectId": 2}}\n]',
    };

    expect(call(message)).toEqual([
      { id: "0", type: "function", function: { name: "list_sprints", arguments: '{"projectId":2}' } },
    ]);
  });

  it("drops the text once it has been read as a call", () => {
    const recovered = recoverToolCalls({ content: '{"tool_name": "get_my_work", "parameters": {}}' });

    expect(readText(recovered)).toBe("");
    expect(recovered.toolCalls).toHaveLength(1);
  });

  it("takes a bare object as one call, and several as several", () => {
    expect(call({ content: '{"tool_name": "get_my_work", "parameters": {}}' })).toHaveLength(1);
    expect(
      call({
        content: '[{"tool_name": "a", "parameters": {}}, {"tool_name": "b", "parameters": {}}]',
      }),
    ).toHaveLength(2);
  });

  it("unwraps a fenced code block", () => {
    const message = { content: '```json\n[{"tool_name": "get_my_work", "parameters": {}}]\n```' };

    expect(call(message)[0].function.name).toBe("get_my_work");
  });

  it("numbers the calls when the model gave no ids", () => {
    const message = { content: '[{"tool_name": "a", "parameters": {}}, {"name": "b", "arguments": {}}]' };

    expect(call(message).map((row) => row.id)).toEqual(["0", "1"]);
  });

  it("leaves a real answer alone", () => {
    const prose = { content: "The current sprint, Atlas Sprint 2, ends on 2026-08-10." };

    expect(recoverToolCalls(prose)).toBe(prose);
  });

  // an answer that happens to be JSON is still an answer
  it.each([
    ["a bare list", '["Atlas", "Nimble"]'],
    ["an object with no tool name", '{"sprint": "Atlas Sprint 2", "ends": "2026-08-10"}'],
    ["half a list", '[{"tool_name": "a", "parameters": {}}, {"sprint": "Atlas Sprint 2"}]'],
    ["broken JSON", '[{"tool_name": "list_sprints"'],
    ["an empty list", "[]"],
  ])("does not mistake %s for a tool call", (_label, content) => {
    expect(recoverToolCalls({ content }).toolCalls).toBeUndefined();
  });

  it("never touches a message that already has its calls", () => {
    const proper = { content: "Looking it up.", toolCalls: [{ id: "c1" }] };

    expect(recoverToolCalls(proper)).toBe(proper);
  });
});

describe("ask", () => {
  const request = { model: "m", messages: [], tools: [] };

  it("returns the assistant message", async () => {
    const cohere = { chat: jest.fn(async () => ({ message: { content: "hi" } })) };

    await expect(ask(cohere, request)).resolves.toEqual({ content: "hi" });
    expect(cohere.chat).toHaveBeenCalledTimes(1);
  });

  // Cohere emitted neither a tool call nor prose; it is not deterministic, and
  // the same conversation usually succeeds on a second attempt
  it("retries an empty generation and succeeds", async () => {
    const cohere = {
      chat: jest.fn().mockRejectedValueOnce(emptyGeneration()).mockResolvedValue({ message: { content: "ok" } }),
    };

    await expect(ask(cohere, request)).resolves.toEqual({ content: "ok" });
    expect(cohere.chat).toHaveBeenCalledTimes(2);
  });

  it("retries a rate limit but not a bad request", async () => {
    const limited = { chat: jest.fn().mockRejectedValueOnce(error(429)).mockResolvedValue({ message: {} }) };
    await expect(ask(limited, request)).resolves.toEqual({});
    expect(limited.chat).toHaveBeenCalledTimes(2);

    const bad = { chat: jest.fn().mockRejectedValue(error(400, "malformed")) };
    await expect(ask(bad, request)).rejects.toThrow("malformed");
    expect(bad.chat).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last attempt and throws what it saw", async () => {
    const cohere = { chat: jest.fn().mockRejectedValue(emptyGeneration()) };

    await expect(ask(cohere, request)).rejects.toMatchObject({ statusCode: 422 });
    expect(cohere.chat).toHaveBeenCalledTimes(3);
  });
});
