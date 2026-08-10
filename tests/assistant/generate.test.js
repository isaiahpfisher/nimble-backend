// The generators: one model call in, a draft out, nothing saved.

const { fakeApi } = require("./fixture");

// `mock`-prefixed so jest's hoisting lets the factory below close over it
const mockNimble = fakeApi(1);

jest.mock("../../app/assistant/tools", () => ({
  ...jest.requireActual("../../app/assistant/tools"),
  apiClient: () => mockNimble.api,
}));

jest.mock("../../app/assistant/chat", () => ({
  ...jest.requireActual("../../app/assistant/chat"),
  cohereClient: () => ({ chat: jest.fn() }),
  ask: jest.fn(),
}));

const { ask } = require("../../app/assistant/chat");
const { runGeneration, KINDS, stripHtml } = require("../../app/assistant/generate");

/** The model replies with this JSON, once. */
const replies = (payload) =>
  ask.mockResolvedValueOnce({ content: typeof payload === "string" ? payload : JSON.stringify(payload) });

const lastInstruction = () => ask.mock.calls.at(-1)[1].messages[1].content;

beforeEach(() => {
  ask.mockReset();
});

describe("the catalogue", () => {
  it("offers exactly the three things the UI asks for", () => {
    expect(KINDS.sort()).toEqual(["acceptance_criteria", "story_description", "story_draft"]);
  });

  it("refuses something it cannot generate", async () => {
    const outcome = await runGeneration({ token: "t", kind: "haiku", args: {} });

    expect(outcome).toMatchObject({ ok: false, reason: "unknown" });
    expect(outcome.error).toContain('nothing called "haiku"');
  });

  // these name a property every object inherits, so a truthy lookup finds
  // something with no generator behind it
  it.each(["constructor", "toString", "__proto__"])("refuses %s like any other stranger", async (kind) => {
    const outcome = await runGeneration({ token: "t", kind, args: {} });

    expect(outcome).toMatchObject({ ok: false, reason: "unknown" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("reports arguments that do not fit, without calling the model", async () => {
    const outcome = await runGeneration({ token: "t", kind: "story_draft", args: { projectId: 1 } });

    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.error).toContain("prompt");
    expect(ask).not.toHaveBeenCalled();
  });

  it("fills the ids from the page the button is on", async () => {
    replies({ criteria: [] });

    const outcome = await runGeneration({
      token: "t",
      kind: "acceptance_criteria",
      args: {},
      context: { projectId: 1, storyId: 70 },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.result.storyId).toBe(70);
  });

  it("lets an explicit argument win over the page", async () => {
    replies({ criteria: [] });

    const outcome = await runGeneration({
      token: "t",
      kind: "acceptance_criteria",
      args: { storyId: 71 },
      context: { projectId: 1, storyId: 70 },
    });

    expect(outcome.result.storyId).toBe(71);
  });
});

describe("acceptance_criteria", () => {
  const generated = {
    criteria: [
      { title: "Locked out", description: "Given five failed attempts, when they try again, then it is refused." },
    ],
  };

  it("returns the criteria and what the story already had", async () => {
    replies(generated);

    const outcome = await runGeneration({
      token: "t",
      kind: "acceptance_criteria",
      args: { projectId: 1, storyId: 70 },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({
      storyId: 70,
      existingCount: 2,
      story: { id: 70, title: "There's an issue with the login page" },
    });
    expect(outcome.result.criteria).toEqual(generated.criteria);
  });

  it("tells the model not to restate criteria the story already has", async () => {
    replies(generated);
    await runGeneration({ token: "t", kind: "acceptance_criteria", args: { projectId: 1, storyId: 70 } });

    const instruction = lastInstruction();
    expect(instruction).toContain("ALREADY has these criteria");
    expect(instruction).toContain("Valid password works");
    expect(instruction).toContain("between 2 and 4");
  });

  it("asks for a full set when the story has none", async () => {
    replies(generated);
    await runGeneration({ token: "t", kind: "acceptance_criteria", args: { projectId: 1, storyId: 71 } });

    expect(lastInstruction()).toContain("Write between 3 and 6");
    expect(lastInstruction()).not.toContain("ALREADY has");
  });

  it("asks for the Given/When/Then shape", async () => {
    replies(generated);
    await runGeneration({ token: "t", kind: "acceptance_criteria", args: { projectId: 1, storyId: 70 } });

    expect(lastInstruction()).toContain("Given <starting state>, when <action>, then <observable result>.");
  });

  it("passes a story that does not exist back as something to fix", async () => {
    const outcome = await runGeneration({
      token: "t",
      kind: "acceptance_criteria",
      args: { projectId: 1, storyId: 999 },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(outcome.error).toContain("No story 999");
  });
});

describe("story_description", () => {
  it("rewrites an existing story in the house format", async () => {
    replies({ description: "As an admin, when I sign in, I want access, so that I can work." });

    const outcome = await runGeneration({
      token: "t",
      kind: "story_description",
      args: { projectId: 1, storyId: 70 },
    });

    expect(outcome.result.description).toBe(
      "As an admin, when I sign in, I want access, so that I can work.",
    );
    expect(outcome.result.original).toContain("As a user, when I sign in");
    expect(lastInstruction()).toContain("As a <who>, when I <when>, I want to <what>, so that <why>.");
  });

  it("works from a title alone, for the create form where no story exists yet", async () => {
    replies({ description: "As a user, when I export, I want CSV, so that I can share it." });

    const outcome = await runGeneration({
      token: "t",
      kind: "story_description",
      args: { projectId: 1, title: "Add CSV export" },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.result.storyId).toBeNull();
    expect(lastInstruction()).toContain("no description yet");
  });

  it("needs either a story or a title", async () => {
    const outcome = await runGeneration({ token: "t", kind: "story_description", args: { projectId: 1 } });

    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.error).toContain("storyId");
  });

  it("shows the model the sentence, not the markup", async () => {
    replies({ description: "As a user, when I sign in, I want access, so that I can work." });

    await runGeneration({
      token: "t",
      kind: "story_description",
      args: { projectId: 1, title: "X", description: "<p>Sign&nbsp;in <b>fails</b></p>" },
    });

    expect(lastInstruction()).toContain("Sign in fails");
    expect(lastInstruction()).not.toContain("<b>");
  });
});

describe("story_draft", () => {
  const draft = {
    title: "Fix the password reset email",
    description: "As a user, when I reset my password, I want the email to arrive, so that I can sign in.",
    priority: "High",
    type: "Bug",
    criteria: [{ title: "Email arrives", description: "Given a reset request, when it is sent, then an email arrives." }],
  };

  it("returns a whole story, with the type resolved to an id", async () => {
    replies(draft);

    const outcome = await runGeneration({
      token: "t",
      kind: "story_draft",
      args: { projectId: 1, prompt: "password reset emails never arrive" },
    });

    expect(outcome.result).toMatchObject({
      projectId: 1,
      title: draft.title,
      priority: "High",
      type: "Bug",
      typeId: 20,
    });
    expect(outcome.result.criteria).toHaveLength(1);
  });

  it("offers only the types the project actually defines", async () => {
    replies(draft);
    await runGeneration({ token: "t", kind: "story_draft", args: { projectId: 1, prompt: "anything at all" } });

    expect(lastInstruction()).toContain("Bug, Feature, Chore");
    expect(ask.mock.calls.at(-1)[1].responseFormat.jsonSchema.properties.type.enum).toEqual([
      "Bug",
      "Feature",
      "Chore",
    ]);
  });

  it("drops a type the project does not have rather than guessing", async () => {
    replies({ ...draft, type: "Epic" });

    const outcome = await runGeneration({
      token: "t",
      kind: "story_draft",
      args: { projectId: 1, prompt: "something" },
    });

    expect(outcome.result.typeId).toBeNull();
    expect(outcome.result.type).toBeNull();
    // the rest of the draft still comes back, so the form opens filled in
    expect(outcome.result.title).toBe(draft.title);
  });

  it("drops a priority that is not one of ours", async () => {
    replies({ ...draft, priority: "Urgent" });

    const outcome = await runGeneration({
      token: "t",
      kind: "story_draft",
      args: { projectId: 1, prompt: "something" },
    });

    expect(outcome.result.priority).toBeNull();
  });

  it("refuses a prompt long enough to be a pasted document", async () => {
    const outcome = await runGeneration({
      token: "t",
      kind: "story_draft",
      args: { projectId: 1, prompt: "x".repeat(501) },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("when the model misbehaves", () => {
  it("still reads JSON the model wrapped in a fence", async () => {
    replies('```json\n{"description":"As a user, when I sign in, I want in, so that I work."}\n```');

    const outcome = await runGeneration({
      token: "t",
      kind: "story_description",
      args: { projectId: 1, storyId: 70 },
    });

    expect(outcome.result.description).toBe("As a user, when I sign in, I want in, so that I work.");
  });

  it("raises a retryable failure when the answer is not JSON at all", async () => {
    replies("I'd rather not.");

    await expect(
      runGeneration({ token: "t", kind: "story_description", args: { projectId: 1, storyId: 70 } }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it("raises a retryable failure when the model says nothing", async () => {
    ask.mockResolvedValueOnce({ content: "" });

    await expect(
      runGeneration({ token: "t", kind: "story_description", args: { projectId: 1, storyId: 70 } }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("stripHtml", () => {
  it("turns the editor's markup back into a sentence", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(stripHtml("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
    expect(stripHtml("<b>bold</b>&nbsp;text")).toBe("bold text");
    expect(stripHtml(null)).toBe("");
  });
});
