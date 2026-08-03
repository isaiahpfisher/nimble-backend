// Finding a story from how someone actually referred to it.
//
// People do not quote titles. They say "the login bug" for "There's an issue
// with the login page", or "notification emails" for "Email notifications sent
// twice". A substring match finds neither, so terms are scored separately and
// the results ranked rather than filtered all-or-nothing.

// Words that carry no signal in a story search. "story" and "one" are here
// because "find the story about X" and "the UTF-8 one" are how people talk.
const STOPWORDS = new Set(
  ("a an and the that this these those it its one ones story stories issue ticket about for from " +
    "with of in on to is are was were be please find show me my our all any some what which who")
    .split(" "),
);

const squash = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const tokenize = (text) =>
  String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** "notifications" and "notification" should be the same word to a searcher. */
const singular = (word) => (word.length > 3 && word.endsWith("s") ? word.replace(/e?s$/, "") : word);

/** The meaningful words in what the user typed, or all of them if that is all there is. */
function searchTerms(query) {
  const words = tokenize(query);
  const meaningful = words.filter((word) => !STOPWORDS.has(word));
  return (meaningful.length ? meaningful : words).map(singular);
}

/** Whether one term appears in a piece of text, allowing for plurals and punctuation. */
function termMatches(term, text) {
  if (!term) return false;

  // "utf8" against "UTF-8", and any straightforward substring
  if (term.length >= 3 && squash(text).includes(squash(term))) return true;

  return tokenize(text)
    .map(singular)
    .some(
      (word) =>
        word === term ||
        (term.length >= 4 && word.startsWith(term)) ||
        (word.length >= 4 && term.startsWith(word)),
    );
}

// A title hit is worth far more than a description hit: people name stories by
// their titles, and descriptions are long enough to collide by accident.
const FIELD_WEIGHTS = { title: 5, type: 2, description: 1 };

/** The best field weight each term reaches in one story, in query order. */
function termScores(story, terms) {
  const fields = {
    title: story.title ?? "",
    type: story.type?.name ?? "",
    description: story.description ?? "",
  };

  return terms.map((term) => {
    let best = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      if (termMatches(term, fields[field])) best = Math.max(best, weight);
    }
    return best;
  });
}

/**
 * How well one story answers a search, as a number. Zero means "not a match".
 *
 * Every term is scored independently and summed, so "login bug" ranks a Bug
 * titled "...login page" above a Feature that merely mentions logins. A story
 * whose id was typed outright wins regardless.
 */
function scoreStory(story, terms, { idHint = null } = {}) {
  if (idHint != null && Number(story.id) === Number(idHint)) return 1000;
  if (!terms.length) return 0;

  const scores = termScores(story, terms);
  const hits = scores.filter(Boolean).length;

  if (hits === 0) return 0;

  const score = scores.reduce((total, value) => total + value, 0);
  // matching every word is a much stronger signal than matching one of four
  return hits === terms.length ? score * 2 : score;
}

/** A bare number in the query is probably a story id. */
const idHintFrom = (query) => {
  const match = String(query ?? "").match(/(?:^|\D)(\d{1,7})(?:\D|$)/);
  return match ? Number(match[1]) : null;
};

/**
 * Ranks stories against a query. `confident` is the whole point: a clear winner
 * lets the assistant act instead of reading a list back, and anything closer
 * than double the runner-up is a tie as far as the user is concerned.
 */
function rankStories(rows, query) {
  const terms = searchTerms(query);
  const idHint = idHintFrom(query);

  const scored = rows
    .map((row) => ({ row, score: scoreStory(row.story, terms, { idHint }) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.row.story.id - b.row.story.id);

  const [best, second] = scored;

  return {
    terms,
    scored,
    confident: Boolean(best) && (!second || best.score >= second.score * 2),
  };
}

module.exports = {
  STOPWORDS,
  searchTerms,
  termMatches,
  scoreStory,
  idHintFrom,
  rankStories,
};
