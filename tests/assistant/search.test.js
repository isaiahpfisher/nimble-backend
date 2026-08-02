// People do not quote titles. They say "the login bug" for "There's an issue
// with the login page", and a substring match finds nothing.

const { rankStories, scoreStory, searchTerms } = require("../../app/assistant/search");

describe("searchTerms", () => {
  it("keeps only the words that carry signal", () => {
    expect(searchTerms("find the story about the login page")).toEqual(["login", "page"]);
  });

  it("folds plurals together", () => {
    expect(searchTerms("notifications")).toEqual(["notification"]);
  });

  // "the one" is all they said; matching nothing would be worse than matching
  // a stopword
  it("falls back to every word when they are all stopwords", () => {
    expect(searchTerms("the one")).toEqual(["the", "one"]);
  });
});

describe("scoreStory", () => {
  const story = { id: 7, title: "Fix the login page", description: "Users cannot sign in", type: { name: "Bug" } };

  it("scores a title hit above a description hit", () => {
    expect(scoreStory(story, ["login"])).toBeGreaterThan(scoreStory(story, ["users"]));
  });

  it("rewards matching every word", () => {
    const both = scoreStory(story, ["login", "page"]);
    const one = scoreStory(story, ["login", "unrelated"]);

    expect(both).toBeGreaterThan(one * 2);
  });

  it("is zero when nothing matches", () => {
    expect(scoreStory(story, ["migration"])).toBe(0);
    expect(scoreStory(story, [])).toBe(0);
  });

  it("matches across punctuation, so utf8 finds UTF-8", () => {
    expect(scoreStory({ id: 1, title: "CSV export mangles UTF-8" }, ["utf8"])).toBeGreaterThan(0);
  });

  it("lets a story id typed outright win outright", () => {
    expect(scoreStory(story, ["anything"], { idHint: 7 })).toBe(1000);
  });
});

describe("rankStories", () => {
  const rows = [
    { story: { id: 1, title: "Fix the login page" }, project: { id: 1 } },
    { story: { id: 2, title: "Login rate limiting" }, project: { id: 1 } },
    { story: { id: 3, title: "Export to CSV" }, project: { id: 1 } },
  ];

  it("drops what does not match and puts the best first", () => {
    const { scored } = rankStories(rows, "login page");

    expect(scored.map((entry) => entry.row.story.id)).toEqual([1, 2]);
  });

  // a clear winner lets the assistant act instead of reading a list back
  it("is confident only when one result stands clearly above the rest", () => {
    expect(rankStories(rows, "login page").confident).toBe(true);
    expect(rankStories(rows, "login").confident).toBe(false);
  });

  it("is not confident about nothing", () => {
    expect(rankStories(rows, "migration").confident).toBe(false);
  });
});
