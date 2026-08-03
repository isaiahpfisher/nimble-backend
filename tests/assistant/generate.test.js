// Generation is the other half of the assistant: not looking something up, but
// writing something that was not there. It answers in JSON so the page can
// render fields and write them back, and it saves nothing — a person accepts
// every draft before it becomes a record.

const mockAsk = jest.fn();
const mockNimbleApi = jest.fn();

jest.mock("../../app/assistant/cohere", () => ({
  ...jest.requireActual("../../app/assistant/cohere"),
  ask: mockAsk,
  cohereClient: jest.fn(() => ({})),
}));

jest.mock("../../app/assistant/api", () => ({ apiClient: jest.fn(() => mockNimbleApi) }));

const { KINDS, runGeneration, stripHtml } = require("../../app/assistant/generate");
const { CRITERION_DESCRIPTION, STORY_DESCRIPTION } = require("../../app/assistant/rules");

const project = {
  id: 1,
  title: "Atlas",
  storyType: [
    { id: 20, name: "Bug" },
    { id: 21, name: "Feature" },
  ],
};

const story = {
  id: 7,
  title: "Password reset never arrives",
  description: "<p>Users report the reset email &amp; link never turn up.</p>",
  type: { id: 20, name: "Bug" },
  acceptanceCriteria: [],
};

/** What the model said, in the shape readText expects. */
const answers = (payload) =>
  mockAsk.mockResolvedValue({ content: typeof payload === "string" ? payload : JSON.stringify(payload) });

const run = (kind, args = {}, context = {}) => runGeneration({ token: "session-token", kind, args, context });

/** The instruction the model was actually given. */
const instruction = () => mockAsk.mock.calls.at(-1)[1].messages.at(-1).content;
const request = () => mockAsk.mock.calls.at(-1)[1];

beforeEach(() => {
  jest.clearAllMocks();

  mockNimbleApi.mockImplementation(async (path) => {
    if (path === "/projects/1") return project;
    if (path === "/projects/1/stories/7") return story;
    throw new Error(`Nothing at ${path} (HTTP 404)`);
  });
});

describe("stripHtml", () => {
  it("leaves the sentence and drops the markup", () => {
    expect(stripHtml("<p>As a <b>user</b>, I want this.</p>")).toBe("As a user, I want this.");
  });

  it("turns block ends into line breaks rather than running words together", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });

  it("decodes the entities a rich-text editor produces", () => {
    expect(stripHtml("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f")).toBe(`a & b <c> "d" 'e' f`);
  });
});

describe("asking for JSON", () => {
  it("constrains the answer with a schema rather than hoping", async () => {
    answers({ criteria: [] });
    await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    expect(request().responseFormat).toMatchObject({ type: "json_object" });
    expect(request().responseFormat.jsonSchema.required).toContain("criteria");
  });

  // structured output is a strong constraint, not a guarantee
  it("still reads an answer the model wrapped in a code fence", async () => {
    answers('```json\n{"criteria":[{"title":"T","description":"D"}]}\n```');

    const { result } = await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    expect(result.criteria).toEqual([{ title: "T", description: "D" }]);
  });

  it("reports an unusable answer as the provider's fault, not the caller's", async () => {
    answers("I'm afraid I can't do that.");

    await expect(run("acceptance_criteria", { projectId: 1, storyId: 7 })).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("reports an empty answer the same way", async () => {
    mockAsk.mockResolvedValue({ content: "" });

    await expect(run("acceptance_criteria", { projectId: 1, storyId: 7 })).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

describe("generating acceptance criteria", () => {
  it("shows the model the story, without its markup", async () => {
    answers({ criteria: [] });
    await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    expect(instruction()).toContain("Password reset never arrives");
    expect(instruction()).toContain("Users report the reset email & link never turn up.");
    expect(instruction()).not.toContain("<p>");
  });

  it("states the Given/When/Then format it wants", async () => {
    answers({ criteria: [] });
    await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    expect(instruction()).toContain(CRITERION_DESCRIPTION);
  });

  it("returns the criteria, trimmed", async () => {
    answers({
      criteria: [
        { title: "  Email arrives  ", description: "  Given a registered user, when they request a reset, then an email arrives.  " },
      ],
    });

    const { result } = await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    expect(result.criteria).toEqual([
      { title: "Email arrives", description: "Given a registered user, when they request a reset, then an email arrives." },
    ]);
    expect(result.story).toEqual({ id: 7, title: "Password reset never arrives" });
  });

  // the failure that would make the button useless on a story anyone has
  // already worked on
  it("tells the model what the story already has, so it does not repeat it", async () => {
    mockNimbleApi.mockImplementation(async (path) => {
      if (path === "/projects/1/stories/7") {
        return { ...story, acceptanceCriteria: [{ id: 1, title: "Email arrives" }] };
      }
      return project;
    });
    answers({ criteria: [] });

    await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    expect(instruction()).toContain("do not restate or rephrase");
    expect(instruction()).toContain("- Email arrives");
  });

  it("saves nothing", async () => {
    answers({ criteria: [{ title: "T", description: "D" }] });
    await run("acceptance_criteria", { projectId: 1, storyId: 7 });

    const writes = mockNimbleApi.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
    expect(writes).toEqual([]);
  });
});

describe("rewriting a description", () => {
  it("asks for the house format and hands back both versions", async () => {
    answers({ description: "As a user, when I request a password reset, I want the email to arrive, so that I can get back in." });

    const { result } = await run("story_description", { projectId: 1, storyId: 7 });

    expect(instruction()).toContain(STORY_DESCRIPTION);
    expect(result.original).toBe("Users report the reset email & link never turn up.");
    expect(result.description).toMatch(/^As a user, when I request/);
  });

  // the create form has no story to read from yet
  it("works from a title alone, with no story saved", async () => {
    answers({ description: "As a user, when I log in, I want to stay signed in, so that I am not asked twice." });

    const { result } = await run("story_description", { projectId: 1, title: "Stay signed in" });

    expect(result.storyId).toBeNull();
    expect(instruction()).toContain("Stay signed in");
    expect(instruction()).toContain("no description yet");
  });

  it("refuses when given neither a story nor a title", async () => {
    const outcome = await run("story_description", { projectId: 1 });

    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(mockAsk).not.toHaveBeenCalled();
  });
});

describe("drafting a story from one line", () => {
  const draft = {
    title: "Send password reset emails reliably",
    description: "As a user, when I request a password reset, I want the email to arrive, so that I can get back in.",
    type: "Bug",
    priority: "High",
    criteria: [{ title: "Email arrives", description: "Given a registered user, when they request a reset, then an email arrives." }],
  };

  it("fills in every field the create form has", async () => {
    answers(draft);

    const { result } = await run("story_draft", { projectId: 1, prompt: "users can't reset passwords" });

    expect(result).toMatchObject({
      title: "Send password reset emails reliably",
      typeId: 20,
      type: "Bug",
      priority: "High",
    });
    expect(result.criteria).toHaveLength(1);
  });

  // the model picks a type by name; the form needs its id
  it("offers only the project's own types, and resolves the one chosen", async () => {
    answers(draft);
    await run("story_draft", { projectId: 1, prompt: "users can't reset passwords" });

    expect(request().responseFormat.jsonSchema.properties.type.enum).toEqual(["Bug", "Feature"]);
  });

  it("drops a type that is not one of the project's rather than guessing", async () => {
    answers({ ...draft, type: "Chore" });

    const { result } = await run("story_draft", { projectId: 1, prompt: "tidy up" });

    expect(result.typeId).toBeNull();
    expect(result.type).toBeNull();
    // everything else still arrives, so the form opens filled in
    expect(result.title).toBe("Send password reset emails reliably");
  });

  it("drops a priority that is not one of the four", async () => {
    answers({ ...draft, priority: "Urgent" });

    const { result } = await run("story_draft", { projectId: 1, prompt: "tidy up" });

    expect(result.priority).toBeNull();
  });

  it("asks for no type at all on a project that defines none", async () => {
    mockNimbleApi.mockResolvedValue({ ...project, storyType: [] });
    answers({ ...draft, type: undefined });

    await run("story_draft", { projectId: 1, prompt: "users can't reset passwords" });

    expect(request().responseFormat.jsonSchema.properties.type).toBeUndefined();
    expect(request().responseFormat.jsonSchema.required).not.toContain("type");
  });

  it("refuses a prompt too short to mean anything", async () => {
    const outcome = await run("story_draft", { projectId: 1, prompt: "x" });

    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(mockAsk).not.toHaveBeenCalled();
  });
});

describe("runGeneration", () => {
  it("names nothing it cannot generate", async () => {
    const outcome = await run("interpretive_dance", { projectId: 1 });

    expect(outcome).toMatchObject({ ok: false, reason: "unknown" });
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("fills ids in from the page the caller is on", async () => {
    answers({ criteria: [] });

    const outcome = await run("acceptance_criteria", {}, { projectId: 1, storyId: 7, sprintId: null });

    expect(outcome.ok).toBe(true);
  });

  it("lets an explicit argument win over the page", async () => {
    answers({ criteria: [] });

    const outcome = await run("acceptance_criteria", { storyId: 999 }, { projectId: 1, storyId: 7 });

    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(outcome.error).toMatch(/stories\/999/);
  });

  // being told a story does not exist is something the caller can fix; the
  // provider falling over is not
  it("separates Nimble's refusals from the provider's", async () => {
    answers({ criteria: [] });
    const notFound = await run("acceptance_criteria", { projectId: 1, storyId: 404 });
    expect(notFound).toMatchObject({ ok: false, reason: "failed" });

    mockAsk.mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }));
    await expect(run("acceptance_criteria", { projectId: 1, storyId: 7 })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("offers exactly the three the pages use", () => {
    expect(KINDS).toEqual(["acceptance_criteria", "story_description", "story_draft"]);
  });
});
