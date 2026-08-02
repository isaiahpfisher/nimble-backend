// A link to the wrong story reads as an answer and lands somewhere unrelated,
// so a target the model was never shown does not ship. And a story it merely
// named is linked from the title the server itself handed it, because asked for
// markdown this model mostly writes the bare title instead.

const {
  collectEntities,
  linkTitles,
  noEntities,
  publishedUrls,
  verifyLinks,
} = require("../../app/assistant/links");

const entitiesIn = (value) => collectEntities(value, noEntities());

describe("collectEntities", () => {
  it("finds in-app urls at any depth", () => {
    const { urls } = entitiesIn({
      stories: [{ url: "/projects/1/stories/7" }, { url: "/projects/1/stories/8" }],
      sprint: { url: "/projects/1/sprints/3" },
    });

    expect([...urls]).toEqual([
      "/projects/1/stories/7",
      "/projects/1/stories/8",
      "/projects/1/sprints/3",
    ]);
  });

  it("pairs each url with the title it belongs to", () => {
    const { titles } = entitiesIn({ stories: [{ title: "Add login page", url: "/projects/1/stories/7" }] });

    expect(titles.get("Add login page")).toBe("/projects/1/stories/7");
  });

  it("keeps the outermost url for a title repeated deeper in the payload", () => {
    const { titles } = entitiesIn({
      title: "Add login page",
      url: "/projects/1/stories/7",
      relations: [{ title: "Add login page", url: "/projects/9/stories/99" }],
    });

    expect(titles.get("Add login page")).toBe("/projects/1/stories/7");
  });

  // a story called "Auth" would turn every mention of the word into a link
  it("ignores titles too short to match safely", () => {
    expect(entitiesIn({ title: "API", url: "/projects/1" }).titles.size).toBe(0);
  });

  it("ignores absolute urls and non-strings", () => {
    expect([...entitiesIn({ url: "https://github.com/x" }).urls]).toEqual([]);
    expect([...entitiesIn({ url: 7 }).urls]).toEqual([]);
    expect([...entitiesIn(null).urls]).toEqual([]);
  });

  it("accumulates across tool calls in a turn", () => {
    const entities = noEntities();
    collectEntities({ title: "Add login page", url: "/projects/1/stories/7" }, entities);
    collectEntities({ title: "Fix the footer", url: "/projects/1/stories/8" }, entities);

    expect(entities.titles.size).toBe(2);
    expect(entities.urls.size).toBe(2);
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

describe("verifyLinks", () => {
  const allowed = new Set(["/projects/1/stories/7"]);

  it("keeps a link whose target came from a tool result", () => {
    expect(verifyLinks("See [Login](/projects/1/stories/7).", allowed)).toBe(
      "See [Login](/projects/1/stories/7).",
    );
  });

  it("demotes an invented link to plain text", () => {
    expect(verifyLinks("See [Login](/projects/9/stories/99).", allowed)).toBe("See Login.");
  });

  it("leaves external links alone", () => {
    expect(verifyLinks("[repo](https://github.com/x)", allowed)).toBe("[repo](https://github.com/x)");
  });

  // the model writes the full address often enough, and the panel would open
  // that in a new tab against the wrong origin
  it("repairs an absolute url whose path it does recognise", () => {
    expect(verifyLinks("[Login](http://localhost:8081/projects/1/stories/7)", allowed)).toBe(
      "[Login](/projects/1/stories/7)",
    );
  });

  it("ignores a trailing slash on either side", () => {
    expect(verifyLinks("[Login](/projects/1/stories/7/)", allowed)).toBe("[Login](/projects/1/stories/7/)");
  });

  it("checks every link in a list independently", () => {
    const reply = "- [A](/projects/1/stories/7)\n- [B](/projects/1/stories/8)";
    expect(verifyLinks(reply, allowed)).toBe("- [A](/projects/1/stories/7)\n- B");
  });
});

describe("linkTitles", () => {
  const titles = new Map([["CSV export mangles UTF-8", "/projects/1/stories/60"]]);

  // the answer the user actually gets: a list of bare story names
  it("links a story the model named but did not link", () => {
    expect(linkTitles("- CSV export mangles UTF-8\n- Something else", titles)).toBe(
      "- [CSV export mangles UTF-8](/projects/1/stories/60)\n- Something else",
    );
  });

  it("links a title the model wrapped in bold or a sentence", () => {
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

  // the model writes a bare "[Title]" often enough; linking inside it would
  // leave "[[Title](/url)]" on screen
  it("absorbs brackets the model put round the title itself", () => {
    expect(linkTitles("- [CSV export mangles UTF-8]", titles)).toBe(
      "- [CSV export mangles UTF-8](/projects/1/stories/60)",
    );
  });

  it("handles a title containing regex metacharacters", () => {
    const tricky = new Map([["Fix (a+b) [beta]", "/projects/1/stories/7"]]);
    expect(linkTitles("Fix (a+b) [beta] is next.", tricky)).toBe(
      "[Fix (a+b) [beta]](/projects/1/stories/7) is next.",
    );
  });

  it("links several stories in one list", () => {
    const many = new Map([
      ["Sprint velocity report", "/projects/1/stories/1"],
      ["Document environment variables", "/projects/2/stories/2"],
    ]);

    expect(linkTitles("- Sprint velocity report\n- Document environment variables", many)).toBe(
      "- [Sprint velocity report](/projects/1/stories/1)\n- [Document environment variables](/projects/2/stories/2)",
    );
  });

  // one title containing another must not be half-matched into nested brackets
  it("prefers the longest title when one contains another", () => {
    const overlapping = new Map([
      ["Sprint dates", "/projects/1/stories/1"],
      ["Sprint dates off by one day (2)", "/projects/1/stories/2"],
    ]);

    expect(linkTitles("Sprint dates off by one day (2) is open.", overlapping)).toBe(
      "[Sprint dates off by one day (2)](/projects/1/stories/2) is open.",
    );
  });

  it("leaves a title that was never mentioned alone", () => {
    expect(linkTitles("Nothing to report.", titles)).toBe("Nothing to report.");
  });
});
