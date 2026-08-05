const { z } = require("zod");
const { httpError } = require("../utils/httpUtils");
const { apiClient, CRITERION_DESCRIPTION, PRIORITIES, STORY_DESCRIPTION } = require("./tools");
const { DEFAULT_MODEL, ask, cohereClient, readText, unfence } = require("./chat");

const SYSTEM = `
You write for Nimble, an agile project-management tool, on behalf of a software team and
into their own backlog.

Write plainly and concretely. No preamble, no restating the request, no marketing tone.
Prefer the team's own vocabulary from the material you are given over inventing new terms.

You are drafting, not deciding: a person reviews everything you write before it is saved.
Never invent facts about the product that the material you were given does not support — if
something is genuinely unknown, write it so the gap is visible rather than papering over it.

Answer with JSON in the requested shape and nothing else.
`.trim();

// deal with HTML from rich text editor for story descriptions
const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

const stripHtml = (html) =>
  String(html ?? "")
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (match) => ENTITIES[match])
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// truncate story descriptions so they don't waste
// usage and don't get too long for the model
const MAX_SOURCE = 4000;

const clamp = (text) => {
  const clean = stripHtml(text);
  return clean.length > MAX_SOURCE ? `${clean.slice(0, MAX_SOURCE)}\n[truncated]` : clean;
};

// tell the model what the shape of the criteria is
const criterionSchema = {
  type: "object",
  properties: { title: { type: "string" }, description: { type: "string" } },
  required: ["title", "description"],
};

const CRITERIA_BRIEF =
  `Each criterion is ONE condition written as "${CRITERION_DESCRIPTION}" — a single Given, a ` +
  'single When, a single Then. Do not fold several conditions into one with "and". The title is ' +
  "a short label for it, not the sentence repeated.\n\n" +
  "Cover the ordinary path first, then the ways it can realistically fail — empty input, no " +
  "permission, nothing found, the thing already done. Criteria must be checkable by someone " +
  "looking at the running product.";

// summarize a stort for the model
const storyBrief = (story) =>
  [
    `Title: ${story.title}`,
    `Type: ${story.type?.name ?? "unspecified"}`,
    `Description:\n${clamp(story.description) || "(none written yet)"}`,
  ].join("\n");

// clean up the crieria that the model wrote
const cleanCriteria = (criteria) =>
  (criteria ?? []).map((criterion) => ({
    title: String(criterion.title ?? "").trim(),
    description: String(criterion.description ?? "").trim(),
  }));

const GENERATORS = {
  acceptance_criteria: {
    input: z.object({ projectId: z.number().int(), storyId: z.number().int() }),

    async run({ projectId, storyId }, { api, generate }) {
      const story = await api(`/projects/${projectId}/stories/${storyId}`);
      const existing = (story.acceptanceCriteria ?? []).map((criterion) => criterion.title);

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
            ? "The story ALREADY has these criteria — do not restate or rephrase any of them:\n" +
              existing.map((title) => `- ${title}`).join("\n")
            : "",
          "",
          CRITERIA_BRIEF,
          "",
          existing.length
            ? "Add between 2 and 4 that are genuinely missing. If the story is already fully " +
              "covered, return an empty list rather than padding it."
            : "Write between 3 and 6.",
        ]
          .filter(Boolean)
          .join("\n"),
      });

      return {
        storyId,
        story: { id: story.id, title: story.title },
        existingCount: existing.length,
        criteria: cleanCriteria(criteria),
      };
    },
  },

  story_description: {
    input: z
      .object({
        projectId: z.number().int(),
        storyId: z.number().int().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      })
      // allow story id to be null as long as title is not empty
      // (for new story creation)
      .refine((value) => Boolean(value.storyId) || Boolean(value.title?.trim()), {
        message: "Give a storyId, or a title for a story that does not exist yet.",
      }),

    async run({ projectId, storyId, title, description }, { api, generate }) {
      let source = { title, description, type: null };

      if (!!storyId) {
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
          "Keep every fact from the original — who it is for, what they are trying to do, why it " +
            "matters. You are changing the shape of the sentence, not its content. Where the " +
            "original does not say who the user is or why they want it, infer the most plausible " +
            "answer from the title rather than leaving a placeholder in the text.",
          "",
          original
            ? "Return the rewritten description as one sentence in that format."
            : "There is no description yet, so write one from the title alone.",
        ].join("\n"),
      });

      return { storyId: storyId ?? null, original, description: String(rewritten ?? "").trim() };
    },
  },

  story_draft: {
    input: z.object({ projectId: z.number().int(), prompt: z.string().min(3).max(500) }),

    async run({ projectId, prompt }, { api, generate }) {
      const project = await api(`/projects/${projectId}`);
      const typeNames = (project.storyType ?? []).map((type) => type.name);

      const properties = {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: PRIORITIES },
        criteria: { type: "array", items: criterionSchema },
      };
      const required = ["title", "description", "priority", "criteria"];

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
          "The title is a short imperative phrase — what the change is, not a restatement of the " + "sentence above.",
          "",
          typeNames.length ? `Pick the type from exactly: ${typeNames.join(", ")}.` : "",
          `Pick the priority from exactly: ${PRIORITIES.join(", ")}. Choose Blocker only for ` +
            "something that stops other work.",
          "",
          "Then write 3 to 5 acceptance criteria.",
          CRITERIA_BRIEF,
        ]
          .filter(Boolean)
          .join("\n"),
      });

      // try to get the type's id from its name
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
        criteria: cleanCriteria(draft.criteria),
      };
    },
  },
};

const KINDS = Object.keys(GENERATORS);

function generator(cohere, model) {
  return async function generate({ instruction, schema }) {
    const message = await ask(cohere, {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: instruction },
      ],
      responseFormat: { type: "json_object", jsonSchema: schema },
      temperature: 0.3, // introduce a little randomness for variety
    });

    const text = readText(message);

    if (!text) throw httpError("The assistant returned nothing to work with.", 502);

    try {
      return JSON.parse(unfence(text));
    } catch {
      throw httpError("The assistant's answer was not in the expected format.", 502);
    }
  };
}

async function runGeneration({ token, kind, args = {}, context = {} }) {
  const generatorFor = Object.hasOwn(GENERATORS, kind) ? GENERATORS[kind] : null;

  if (!generatorFor) {
    return { ok: false, reason: "unknown", error: `There is nothing called "${kind}" to generate.` };
  }

  // build context
  // overwrite context with args if not null
  // delete null values from context to avoid confusion
  const filled = { ...context, ...args };
  for (const key of Object.keys(filled)) {
    if (filled[key] == null) delete filled[key];
  }

  const parsed = generatorFor.input.safeParse(filled); // safeParse is a Zod schema method
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
    // if there's a status code, it came from Cohere, so throw it
    // else, catch it and return a helpful error message to user
    if (err?.statusCode) throw err;
    return { ok: false, reason: "failed", error: err.message };
  }
}

module.exports = { GENERATORS, KINDS, runGeneration, stripHtml, SYSTEM };
