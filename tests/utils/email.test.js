// The email util constructs a Resend client at load time and calls
// resend.emails.send(); mock the SDK so nothing hits the network.
// Prefixed with `mock` so jest.mock's hoisted factory may reference it.
const mockSend = jest
  .fn()
  .mockResolvedValue({ data: { id: "email_1" }, error: null });
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

// storyUrl reads BASE_FRONTEND_URL, captured when the module first loads.
process.env.BASE_FRONTEND_URL = "https://app.nimble.test";

const {
  storyUrl,
  commentToPlainText,
  sendEmail,
  notifyMentionedUser,
  notifyAssignedUser,
  notifyReviewerUser,
} = require("../../app/utils/email");

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ data: { id: "email_1" }, error: null });
});

describe("storyUrl", () => {
  it("builds a project/story path from the frontend base url", () => {
    expect(storyUrl({ id: 9, projectId: 3 })).toBe(
      "https://app.nimble.test/projects/3/stories/9",
    );
  });

  it("appends an acceptance-criteria query param when given one", () => {
    expect(storyUrl({ id: 9, projectId: 3 }, { acId: 5 })).toBe(
      "https://app.nimble.test/projects/3/stories/9?ac=5",
    );
  });
});

describe("commentToPlainText", () => {
  it("turns <br> tags into newlines", () => {
    expect(commentToPlainText("line one<br>line two")).toBe("line one\nline two");
  });

  it("adds a newline after block elements and strips remaining tags", () => {
    expect(commentToPlainText("<p>hello</p><div>world</div>")).toBe("hello\nworld");
  });

  it("decodes non-breaking spaces and trims", () => {
    expect(commentToPlainText("&nbsp;padded&nbsp;")).toBe("padded");
  });

  it("collapses three or more newlines into a single blank line", () => {
    expect(commentToPlainText("a<br><br><br><br>b")).toBe("a\n\nb");
  });
});

describe("sendEmail", () => {
  it("sends html to the recipient through Resend", async () => {
    await sendEmail("dev@test.dev", "Hi", "Body text");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toEqual(["dev@test.dev"]);
    expect(payload.subject).toBe("Hi");
    expect(payload.html).toContain("Body text");
  });

  it("renders context items, linking those that carry a url", async () => {
    await sendEmail("dev@test.dev", "Hi", "Body", {
      context: [
        { label: "Story", value: "Login", url: "https://x.test/s/1" },
        { label: "Sprint", value: "Sprint 2" },
      ],
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain('<a href="https://x.test/s/1"');
    expect(html).toContain("Login");
    expect(html).toContain("<strong>Sprint:</strong> Sprint 2");
  });

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: new Error("bad key") });

    await expect(sendEmail("dev@test.dev", "Hi", "Body")).rejects.toThrow("bad key");
  });
});

describe("notifyMentionedUser", () => {
  it("emails the mentioned user a quoted, plain-text comment", async () => {
    await notifyMentionedUser(
      { email: "bob@test.dev" },
      { firstName: "Ada", lastName: "Lovelace" },
      { content: "<p>Take a look</p>" },
      [{ label: "Story", value: "Login" }],
    );

    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toEqual(["bob@test.dev"]);
    expect(payload.subject).toBe("Ada mentioned you");
    expect(payload.html).toContain("Take a look");
    expect(payload.html).not.toContain("<p>Take a look</p>");
  });
});

describe("notifyAssignedUser", () => {
  it("emails the assignee with an escaped story title", async () => {
    await notifyAssignedUser(
      { email: "cara@test.dev" },
      { firstName: "Ada", lastName: "Lovelace" },
      { title: "Fix <script>" },
      [],
    );

    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toEqual(["cara@test.dev"]);
    expect(payload.subject).toBe("Ada assigned you a story");
    expect(payload.html).toContain("Fix &lt;script&gt;");
    expect(payload.html).not.toContain("Fix <script>");
  });
});

describe("notifyReviewerUser", () => {
  it("emails the reviewer a review request", async () => {
    await notifyReviewerUser(
      { email: "dan@test.dev" },
      { firstName: "Ada", lastName: "Lovelace" },
      { title: "Login" },
      [],
    );

    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toEqual(["dan@test.dev"]);
    expect(payload.subject).toBe("Ada requested your review");
    expect(payload.html).toContain("review the story");
  });
});
