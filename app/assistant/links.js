// Making the stories in an answer clickable, and keeping them honest.
//
// Two jobs, both working from the same fact: this turn's tool results are the
// only stories the model has seen, and the server put a `url` on every one of
// them.
//
//   - a link the model wrote to something it was not shown is removed
//   - a story it named but did not link is linked from the title we gave it
//
// The second is not a nicety. Asked to copy a url into markdown, this model
// mostly writes the bare title instead, however firmly the prompt puts it, and
// an answer full of unclickable story names is the common case rather than the
// exception. Linking a title the server itself supplied is not guesswork — it
// is resolving a reference in data we own — so it happens here rather than
// being asked for again in the prompt.

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]*)\)/g;

// Short titles collide with ordinary prose — a story called "Auth" would turn
// every mention of the word into a link.
const SHORTEST_TITLE = 4;

const canonical = (url) => url.replace(/\/+$/, "");

/**
 * The in-app urls in a tool result, and the title each one belongs to.
 *
 * shape.js puts a `url` on every story, project and sprint precisely so the
 * model never has to assemble one — which is also what makes this collection
 * complete.
 */
function collectEntities(value, entities) {
  if (Array.isArray(value)) {
    for (const item of value) collectEntities(item, entities);
  } else if (value && typeof value === "object") {
    if (typeof value.url === "string" && value.url.startsWith("/")) {
      entities.urls.add(canonical(value.url));

      // first url wins: an outer story outranks the same title nested in its
      // own relations
      const title = typeof value.title === "string" ? value.title.trim() : "";
      if (title.length >= SHORTEST_TITLE && !entities.titles.has(title)) {
        entities.titles.set(title, value.url);
      }
    }

    for (const item of Object.values(value)) collectEntities(item, entities);
  }

  return entities;
}

/** A fresh, empty set of what this turn has been shown. */
const noEntities = () => ({ urls: new Set(), titles: new Map() });

/**
 * Links the assistant already published in this conversation.
 *
 * The transcript holds only prose, so a follow-up turn starts with no tool
 * results and every link the model repeats would be stripped as invented. But a
 * link in an earlier assistant message is one this same check already vouched
 * for, so it is trustworthy on sight. A client could forge one and mislead
 * nobody but itself, since the target only ever points inside that user's own
 * app.
 */
function publishedUrls(messages, into = new Set()) {
  for (const { role, content } of messages) {
    if (role !== "assistant" || typeof content !== "string") continue;
    for (const [, , target] of content.matchAll(MARKDOWN_LINK)) {
      if (target.startsWith("/")) into.add(canonical(target));
    }
  }
  return into;
}

const pathnameOf = (url) => {
  try {
    return canonical(new URL(url).pathname);
  } catch {
    return null;
  }
};

/**
 * Repairs or removes in-app links the model did not copy faithfully.
 *
 * A link to the wrong story is worse than no link: it reads as an answer and
 * lands somewhere unrelated. So a target that appeared in no tool result and no
 * earlier answer loses its link and keeps its text.
 *
 * An absolute url whose path we do recognise is repaired instead: the model
 * writes "http://localhost:8081/projects/1/stories/7" often enough, and the
 * panel would open that in a new tab against the wrong origin when it is
 * plainly a link we can honour. Genuinely external links — a repository, say —
 * are left exactly as they are.
 */
const verifyLinks = (reply, allowed) =>
  reply.replace(MARKDOWN_LINK, (whole, text, target) => {
    if (allowed.has(canonical(target))) return whole;

    if (/^https?:\/\//i.test(target)) {
      const inApp = pathnameOf(target);
      return inApp && allowed.has(inApp) ? `[${text}](${inApp})` : whole;
    }

    // relative but unrecognised: the text survives, the bad link does not
    return target.startsWith("/") ? text : whole;
  });

/** The character ranges of `reply` that already sit inside a markdown link. */
const linkedRanges = (reply) =>
  [...reply.matchAll(MARKDOWN_LINK)].map((match) => [match.index, match.index + match[0].length]);

/**
 * Links the first mention of `title` that is not already inside a link.
 *
 * Returns the reply unchanged when the title does not appear in prose, so a
 * story the model only listed once and linked properly is never touched twice.
 */
function linkFirstMention(reply, title, url) {
  const ranges = linkedRanges(reply);
  const inLink = (at) => ranges.some(([from, to]) => at >= from && at < to);

  for (let at = reply.indexOf(title); at !== -1; at = reply.indexOf(title, at + 1)) {
    if (inLink(at)) continue;

    // The model often writes a bare "[Title]" — bracketed but with no target,
    // so it is not a link. Swallow those brackets instead of linking inside
    // them, or the result reads "[[Title](/url)]".
    const bracketed = reply[at - 1] === "[" && reply[at + title.length] === "]";
    const from = bracketed ? at - 1 : at;
    const to = at + title.length + (bracketed ? 1 : 0);

    return `${reply.slice(0, from)}[${title}](${url})${reply.slice(to)}`;
  }

  return reply;
}

/**
 * Links every story the model named but did not link.
 *
 * Longest title first, so "Sprint dates off by one day (2)" is linked as itself
 * rather than being half-matched by a shorter title it contains. A story whose
 * url is already linked somewhere in the reply is left alone.
 */
function linkTitles(reply, titles) {
  let out = reply;

  for (const [title, url] of [...titles].sort((a, b) => b[0].length - a[0].length)) {
    if (out.includes(`](${url})`)) continue;
    out = linkFirstMention(out, title, url);
  }

  return out;
}

module.exports = {
  collectEntities,
  noEntities,
  publishedUrls,
  verifyLinks,
  linkTitles,
  linkFirstMention,
};
