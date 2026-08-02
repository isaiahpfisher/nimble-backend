// What the assistant remembers between requests.
//
// The panel sends prose only, so without this the model was asked follow-up
// questions about tool results it could no longer see.

const {
  forget,
  recall,
  remember,
  reset,
  trimHistory,
  MAX_HISTORY_CHARS,
} = require("../../app/assistant/sessions");

const user = (role, content) => ({ role, content });
const toolResult = (id, text) => ({ role: "tool", toolCallId: id, content: [{ type: "text", text }] });

const exchange = () => [
  user("user", "what am I working on?"),
  { role: "assistant", toolCalls: [{ id: "c1", type: "function", function: { name: "get_my_work" } }] },
  toolResult("c1", '{"tool":"get_my_work","result":{"assigned":[]}}'),
  user("assistant", "Nothing is assigned to you."),
];

beforeEach(reset);

describe("remember and recall", () => {
  it("mints an id for a new conversation", () => {
    const id = remember(1, null, exchange());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives back everything the model saw, tool results included", () => {
    const id = remember(1, null, exchange());
    const history = recall(1, id);

    expect(history).toHaveLength(4);
    expect(history[2]).toMatchObject({ role: "tool", toolCallId: "c1" });
  });

  it("keeps the same id as a conversation goes on", () => {
    const first = remember(1, null, exchange());
    const second = remember(1, first, [...exchange(), user("user", "and the first one?")]);

    expect(second).toBe(first);
    expect(recall(1, first)).toHaveLength(5);
  });

  it("has nothing for a conversation that was never stored", () => {
    expect(recall(1, "11111111-1111-1111-1111-111111111111")).toBeNull();
  });

  it("has nothing when no id is given at all", () => {
    expect(recall(1, null)).toBeNull();
  });

  // the id is only half the key; the user id is the other half
  it("does not hand one user's conversation to another", () => {
    const id = remember(1, null, exchange());

    expect(recall(2, id)).toBeNull();
    expect(recall(1, id)).not.toBeNull();
  });

  it("forgets on request, so a client can start over", () => {
    const id = remember(1, null, exchange());
    forget(1, id);

    expect(recall(1, id)).toBeNull();
  });
});

describe("trimHistory", () => {
  const big = (role, size) => ({ role, content: "x".repeat(size) });

  it("leaves a conversation that fits alone", () => {
    const history = exchange();
    expect(trimHistory(history)).toBe(history);
  });

  it("drops the oldest turns once it is too long", () => {
    const history = [
      user("user", "one"),
      big("assistant", 1000),
      user("user", "two"),
      big("assistant", 1000),
      user("user", "three"),
    ];

    const trimmed = trimHistory(history, 1500);

    expect(trimmed.length).toBeLessThan(history.length);
    expect(trimmed.at(-1)).toEqual(user("user", "three"));
  });

  // Cohere rejects a tool message whose assistant message is missing, so a cut
  // may only land where a user turn starts.
  it("never leaves a tool result without the call it answers", () => {
    const history = [
      user("user", "first"),
      { role: "assistant", toolCalls: [{ id: "c1" }] },
      toolResult("c1", "x".repeat(2000)),
      user("assistant", "done"),
      user("user", "second"),
      { role: "assistant", toolCalls: [{ id: "c2" }] },
      toolResult("c2", "y".repeat(2000)),
    ];

    const trimmed = trimHistory(history, 2500);

    for (const [at, message] of trimmed.entries()) {
      if (message.role !== "tool") continue;
      const before = trimmed.slice(0, at).reverse().find((m) => m.role === "assistant");
      expect(before?.toolCalls).toBeDefined();
    }
  });

  it("keeps the newest turn whole even when it alone is oversized", () => {
    const history = [user("user", "old"), user("user", "x".repeat(5000))];
    const trimmed = trimHistory(history, 100);

    expect(trimmed.at(-1).content).toHaveLength(5000);
  });

  it("trims on the way in, so a long conversation cannot grow without bound", () => {
    const long = [];
    for (let i = 0; i < 200; i += 1) {
      long.push(user("user", `question ${i}`), big("assistant", 2000));
    }

    const id = remember(1, null, long);
    const stored = JSON.stringify(recall(1, id)).length;

    expect(stored).toBeLessThanOrEqual(MAX_HISTORY_CHARS * 1.1);
  });
});
