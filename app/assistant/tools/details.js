// The things that hang off a story: comments, acceptance criteria, and links
// to other stories.

const { z } = require("zod");
const {
  AC_STATUSES,
  CRITERION_DESCRIPTION,
  RELATION_PHRASES,
  defined,
  listChoices,
  resolveRelation,
} = require("../rules");
const { storyUrl } = require("../shape");

const num = (description) => z.number().int().describe(description);
const str = (description) => z.string().describe(description);

module.exports = [
  {
    name: "add_story_comment",
    title: "Comment on a story",
    write: true,
    description:
      "Post a comment on a story, authored by the current user. Use this when they ask you to leave a " +
      "note, record a decision or reply on a story. Write the comment in their voice, and if they have " +
      "not said what it should say, ask — do not compose one on their behalf and post it.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to comment on."),
      content: str("The comment text."),
    }),
    async run({ projectId, storyId, content }, { api }) {
      const comment = await api(`/projects/${projectId}/stories/${storyId}/comments`, {
        method: "POST",
        body: { content },
      });

      return {
        created: "comment",
        id: comment.id,
        content: comment.content,
        storyId,
        url: storyUrl(projectId, storyId),
      };
    },
  },

  {
    name: "add_acceptance_criteria",
    title: "Add an acceptance criterion",
    write: true,
    description:
      "Add one acceptance criterion to a story. Call it once per criterion, and give each one a single " +
      `Given/When/Then — "${CRITERION_DESCRIPTION}" — rather than folding several conditions into one. ` +
      "You write that description; send the user's own wording only when they spelled the criterion out " +
      "themselves. A new criterion is Pending unless you say otherwise.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story to add the criterion to."),
      title: str("Short name for the criterion."),
      description: str(
        `What has to be true for it to pass, written as "${CRITERION_DESCRIPTION}". Required: write it ` +
          "yourself rather than repeating the title. If the user spelled the criterion out, send theirs " +
          "exactly as they wrote it instead.",
      ),
      status: z.enum(AC_STATUSES).default("Pending").describe("Pending, Passed or Failed. New ones are Pending."),
    }),
    async run({ projectId, storyId, title, description, status }, { api }) {
      const criterion = await api(`/projects/${projectId}/stories/${storyId}/acceptanceCriteria`, {
        method: "POST",
        body: { title, description, status },
      });

      return { created: "acceptanceCriterion", ...criterion, url: storyUrl(projectId, storyId) };
    },
  },

  {
    name: "update_acceptance_criterion",
    title: "Update an acceptance criterion",
    write: true,
    description:
      "Change an acceptance criterion's status, title or description — this is the tool for marking one " +
      "Passed or Failed. Pass only what changes; the current values are read from the story and kept " +
      "for everything else. Get criterion ids from get_story.",
    input: z.object({
      projectId: num("Id of the project the story belongs to."),
      storyId: num("Id of the story the criterion belongs to."),
      criterionId: num("Id of the criterion, from get_story."),
      status: z.enum(AC_STATUSES).optional().describe("Pending, Passed or Failed."),
      title: str("New title.").optional(),
      description: str(
        `New description, written as "${CRITERION_DESCRIPTION}" — unless the user dictated the new ` +
          "wording, in which case send theirs exactly as they wrote it.",
      ).optional(),
    }),
    async run({ projectId, storyId, criterionId, ...input }, { api }) {
      const changes = defined(input);
      if (Object.keys(changes).length === 0) {
        throw new Error("No fields to update — say what should change about the criterion.");
      }

      // Nimble's update endpoint validates title and status on every call and
      // writes all three columns, so a status-only change would blank the rest.
      // Reading the current row and merging is what makes a partial update safe
      // from here.
      const story = await api(`/projects/${projectId}/stories/${storyId}`);
      const current = (story.acceptanceCriteria ?? []).find((c) => Number(c.id) === Number(criterionId));

      if (!current) {
        throw new Error(
          `Story ${storyId} has no acceptance criterion ${criterionId}. Its criteria are: ` +
            `${listChoices(story.acceptanceCriteria ?? [], "title")}.`,
        );
      }

      const criterion = await api(
        `/projects/${projectId}/stories/${storyId}/acceptanceCriteria/${criterionId}`,
        {
          method: "PUT",
          body: {
            title: current.title,
            description: current.description,
            status: current.status,
            ...changes,
          },
        },
      );

      return {
        updated: "acceptanceCriterion",
        changed: Object.keys(changes),
        ...criterion,
        url: storyUrl(projectId, storyId),
      };
    },
  },

  {
    name: "link_stories",
    title: "Link two stories",
    write: true,
    description:
      "Record a relationship between two stories in the same project: one blocks another, duplicates " +
      "it, is its parent, or simply relates to it. Say the relationship as a phrase reading from the " +
      "first story to the second — story `storyId` <relation> story `otherStoryId`. So to record that " +
      '42 is held up by 7, either "42 is blocked by 7" or "7 blocks 42" works; they store the same ' +
      "link.\n\n" +
      "Two stories can only be linked once, in one way, and a story cannot link to itself. Read " +
      "existing links from get_story before adding one.",
    input: z.object({
      projectId: num("Id of the project both stories belong to."),
      storyId: num("The story you are describing."),
      relation: z
        .enum(Object.keys(RELATION_PHRASES))
        .describe("How storyId relates to otherStoryId, read left to right."),
      otherStoryId: num("The story on the other end."),
    }),
    async run({ projectId, storyId, relation, otherStoryId }, { api }) {
      const { type, storyOneId, storyTwoId } = resolveRelation(storyId, relation, otherStoryId);

      const created = await api(`/projects/${projectId}/stories/${storyId}/relations`, {
        method: "POST",
        body: { type, storyOneId, storyTwoId },
      });

      return {
        created: "relation",
        id: created?.id ?? null,
        summary: `story ${storyId} ${relation} story ${otherStoryId}`,
        type,
        url: storyUrl(projectId, storyId),
        otherUrl: storyUrl(projectId, otherStoryId),
      };
    },
  },
];
