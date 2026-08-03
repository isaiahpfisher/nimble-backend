// Writing, rather than looking things up.
//
// The tool registry answers questions about data that already exists. This
// answers a different kind of request: produce text that does not exist yet —
// the acceptance criteria for a story, a description in the house format, a
// whole story from one sentence.
//
// It is deliberately not a tool, and not the agent loop:
//
//   - There is nothing to decide. The button already knows what is being asked
//     for, so paying for a conversation to arrive at it is waste. One request,
//     one answer.
//   - Cohere refuses `responseFormat` alongside `tools`, and structured output
//     is the whole point here — the caller gets fields it can render and write
//     back, not prose it has to parse.
//
// Nothing here writes to Nimble. Every generator returns a draft, and a person
// accepts it before anything is saved. That is what makes it safe to put behind
// a button: the worst case is wasted words on a screen.

const { z } = require("zod");
const { httpError } = require("../utils/httpUtils");
const { apiClient } = require("./api");
const { DEFAULT_MODEL, ask, cohereClient, readText, unfence } = require("./cohere");
const { CRITERION_DESCRIPTION, PRIORITIES, STORY_DESCRIPTION } = require("./rules");

// Descriptions come out of a rich-text editor, so they arrive as HTML. The
// model should see the sentence, not the markup — and should never be handed a
// tag it might helpfully copy into its answer.
const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (match) => ENTITIES[match])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What the model is told it is, on every generation. */
const SYSTEM = `
You write for Nimble, an agile project-management tool. You are writing on behalf of a
software team, into their own backlog.

Write plainly and concretely. No preamble, no restating the request, no marketing tone.
Prefer the team's own vocabulary from the material you are given over inventing new terms.

You are drafting, not deciding: a person reviews everything you write before it is saved.
Never invent facts about the product that the material you were given does not support —
if something is genuinely unknown, write the criterion or sentence so that the gap is
visible rather than papering over it with a guess.

Answer with JSON in the requested shape and nothing else.
`.trim();

// Long enough for a real story, short enough that a pasted document does not
// quietly become the prompt.
const MAX_SOURCE = 4000;

const clamp = (text) => {
  const clean = stripHtml(text);
  return clean.length > MAX_SOURCE ? `${clean.slice(0, MAX_SOURCE)}\n[truncated]` : clean;
};

const criterionSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "description"],
};

const criteriaBrief =
  `Each criterion is ONE condition written as "${CRITERION_DESCRIPTION}" — a single ` +
  "Given, a single When, a single Then. Do not fold several conditions into one with " +
  '"and". The title is a short label for it, not the sentence repeated.\n\n' +
  "Cover the ordinary path first, then the ways it can realistically fail — empty input, " +
  "no permission, nothing found, the thing already done. Criteria must be checkable by " +
  "someone looking at the running product.";

/** How a story reads to the model. */
const storyBrief = (story) =>
  [
    `Title: ${story.title}`,
    `Type: ${story.type?.name ?? "unspecified"}`,
    `Description:\n${clamp(story.description) || "(none written yet)"}`,
  ].join("\n");

const GENERATORS = {
  // --- acceptance criteria -------------------------------------------------

  acceptance_criteria: {
    input: z.object({
      projectId: z.number().int(),
      storyId: z.number().int(),
    }),

    async run({ projectId, storyId }, { api, generate }) {
      const story = await api(`/projects/${projectId}/stories/${storyId}`);
      const existing = (story.acceptanceCriteria ?? []).map((c) => c.title);

      const { criteria } = await generate({
        schema: {
          type: "object",
          properties: { criteria: { type: "array", items: criterionSchema } },
          required: ["criteria"],
        },
        instruction: [
          "Generate JSON containing acceptance criteria for this story.",
          "",
          storyBrief(story),
          "",
          existing.length
            ? `The story ALREADY has these criteria — do not restate or rephrase any of them:\n` +
              existing.map((title) => `- ${title}`).join("\n")
            : "",
          "",
          criteriaBrief,
          "",
          existing.length
            ? "Add between 2 and 4 that are genuinely missing. If the story is already " +
              'fully covered, return an empty list rather than padding it.'
            : "Write between 3 and 6.",
        ]
          .filter(Boolean)
          .join("\n"),
      });

      return {
        storyId,
        story: { id: story.id, title: story.title },
        existingCount: existing.length,
        criteria: (criteria ?? []).map((c) => ({
          title: String(c.title ?? "").trim(),
          description: String(c.description ?? "").trim(),
        })),
      };
    },
  },

  // --- rewriting a description ---------------------------------------------

  story_description: {
    input: z
      .object({
        projectId: z.number().int(),
        storyId: z.number().int().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      })
      // so the create form, where no story exists yet, can use it too
      .refine((value) => value.storyId !== undefined || Boolean(value.title?.trim()), {
        message: "Give a storyId, or a title for a story that does not exist yet.",
      }),

    async run({ projectId, storyId, title, description }, { api, generate }) {
      let source = { title, description, type: null };

      if (storyId !== undefined) {
        const story = await api(`/projects/${projectId}/stories/${storyId}`);
        source = { title: story.title, description: story.description, type: story.type };
      }

      const original = clamp(source.description);

      const { description: rewritten } = await generate({
        schema: {
          type: "object",
          properties: { description: { type: "string" } },
          required: ["description"],
        },
        instruction: [
          "Generate JSON rewriting this story's description in the team's house format.",
          "",
          storyBrief(source),
          "",
          `The format is exactly: "${STORY_DESCRIPTION}"`,
          "",
          "Keep every fact from the original — who it is for, what they are trying to do, " +
            "why it matters. You are changing the shape of the sentence, not its content. " +
            "Where the original does not say who the user is or why they want it, infer the " +
            "most plausible answer from the title and the rest of the description rather " +
            "than leaving a placeholder in the text.",
          "",
          original
            ? "Return the rewritten description as one sentence in that format."
            : "There is no description yet, so write one from the title alone.",
        ].join("\n"),
      });

      return {
        storyId: storyId ?? null,
        original,
        description: String(rewritten ?? "").trim(),
      };
    },
  },

  // --- a whole story from one line -----------------------------------------

  story_draft: {
    input: z.object({
      projectId: z.number().int(),
      prompt: z.string().min(3).max(500),
    }),

    async run({ projectId, prompt }, { api, generate }) {
      const project = await api(`/projects/${projectId}`);
      const typeNames = (project.storyType ?? []).map((t) => t.name);

      const properties = {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: PRIORITIES },
        criteria: { type: "array", items: criterionSchema },
      };
      const required = ["title", "description", "priority", "criteria"];

      // Only offer a type when the project actually defines some, so the model
      // is never asked to pick from an empty list.
      if (typeNames.length) {
        properties.type = { type: "string", enum: typeNames };
        required.push("type");
      }

      const draft = await generate({
        schema: { type: "object", properties, required },
        instruction: [
          "Generate JSON for a complete backlog story from this one-line request:",
          `"${clamp(prompt)}"`,
          "",
          `The description must be written as: "${STORY_DESCRIPTION}"`,
          "",
          "The title is a short imperative phrase — what the change is, not a restatement " +
            "of the sentence above.",
          "",
          typeNames.length ? `Pick the type from exactly: ${typeNames.join(", ")}.` : "",
          `Pick the priority from exactly: ${PRIORITIES.join(", ")}. Choose Blocker only ` +
            "for something that stops other work.",
          "",
          "Then write 3 to 5 acceptance criteria.",
          criteriaBrief,
        ]
          .filter(Boolean)
          .join("\n"),
      });

      // The model picked a type by name; the story endpoint needs its id. A
      // name that is not in the list is dropped rather than guessed at — the
      // form still opens with everything else filled in.
      const type = (project.storyType ?? []).find(
        (row) => row.name.toLowerCase() === String(draft.type ?? "").toLowerCase(),
      );

      return {
        projectId,
        title: String(draft.title ?? "").trim(),
        description: String(draft.description ?? "").trim(),
        typeId: type?.id ?? null,
        type: type?.name ?? null,
        priority: PRIORITIES.includes(draft.priority) ? draft.priority : null,
        criteria: (draft.criteria ?? []).map((c) => ({
          title: String(c.title ?? "").trim(),
          description: String(c.description ?? "").trim(),
        })),
      };
    },
  },
};

const KINDS = Object.keys(GENERATORS);

/**
 * One model call that has to come back as JSON.
 *
 * `responseFormat` does the enforcing, but the fence-stripping fallback stays:
 * structured output is a strong constraint rather than a guarantee, and a
 * ```json wrapper is the one way it slips.
 */
function generator(cohere, model) {
  return async function generate({ instruction, schema }) {
    const message = await ask(cohere, {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: instruction },
      ],
      responseFormat: { type: "json_object", jsonSchema: schema },
      // Low, not zero: these are drafts a person edits, and identical phrasing
      // for every story on the board reads worse than a little variation.
      temperature: 0.3,
    });

    const text = readText(message);

    // Both of these are the provider misbehaving, not the caller asking for
    // something wrong, so they carry a status and surface as a 503 the user is
    // invited to retry — the same way a rate limit does.
    if (!text) throw httpError("The assistant returned nothing to work with.", 502);

    try {
      return JSON.parse(unfence(text));
    } catch {
      throw httpError("The assistant's answer was not in the expected format.", 502);
    }
  };
}

/**
 * Runs one generator and reports the outcome as a value.
 *
 * Mirrors runTool: an unknown kind and arguments that do not fit are both
 * things the caller can correct, so they come back as `{ ok: false, reason }`
 * rather than as exceptions. A provider failure is different — that one is
 * rethrown, so the controller can tell "your request was wrong" from "Cohere
 * is down" and answer 400 or 503 accordingly.
 *
 * @param {string} options.token    the caller's bearer token; reads act as them
 * @param {string} options.kind     which generator
 * @param {object} options.args     its arguments, unvalidated
 * @param {object} options.context  what is on screen ({projectId, storyId, sprintId})
 */
async function runGeneration({ token, kind, args = {}, context = {} }) {
  const generatorFor = GENERATORS[kind];

  if (!generatorFor) {
    return { ok: false, reason: "unknown", error: `There is nothing called "${kind}" to generate.` };
  }

  // the page's ids fill in anything the caller left out, the same way the chat
  // loop's context works — a button on a story page knows which story it is on
  const filled = { ...context, ...args };
  for (const key of Object.keys(filled)) {
    if (filled[key] == null) delete filled[key];
  }

  const parsed = generatorFor.input.safeParse(filled);
  if (!parsed.success) {
    const detail = (parsed.error.issues ?? [])
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
      .join("; ");

    return { ok: false, reason: "invalid", error: `Invalid arguments for ${kind} — ${detail}.` };
  }

  const generate = generator(cohereClient(), process.env.COHERE_MODEL || DEFAULT_MODEL);

  try {
    const result = await generatorFor.run(parsed.data, { api: apiClient(token), generate });
    return { ok: true, result };
  } catch (err) {
    // A status means it came from the provider or from us deciding the provider
    // misbehaved — that is a 503 and not the caller's to fix. Anything else came
    // back from Nimble's own API (no such story, not a member of that project)
    // and is something they can act on.
    if (err?.statusCode) throw err;
    return { ok: false, reason: "failed", error: err.message };
  }
}

module.exports = { GENERATORS, KINDS, runGeneration, stripHtml, SYSTEM };
