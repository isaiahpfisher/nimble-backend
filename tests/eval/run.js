// Does the assistant actually answer? The unit tests say the parts work; this
// says whether the whole thing does.
//
// The real prompt, the real loop, the real MCP session and the real Cohere API,
// against a fake Nimble (fixture.js) rather than a database. Every scenario is
// a question a user would ask, and a check on what came back — which tool ran,
// what the reply said, what actually changed in the data.
//
// Not part of `npm test`: it needs a COHERE_API_KEY, it costs tokens, and the
// model is not deterministic, so a scenario is run several times and reported
// as pass, flaky or fail.
//
//   npm run eval
//   npm run eval -- --runs 5
//   npm run eval -- --model command-a-03-2025 --only sprint-progress
//
// Add a scenario whenever the assistant gets something wrong in the panel: it
// is the difference between "it felt better after that change" and knowing.

const path = require("path");
const ROOT = path.join(__dirname, "..", "..");

require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });

const { openSession } = require(path.join(ROOT, "app/assistant/mcp"));
const { runConversation } = require(path.join(ROOT, "app/assistant/loop"));
const { withPageContext } = require(path.join(ROOT, "app/assistant/context"));
const { DEFAULT_MODEL } = require(path.join(ROOT, "app/assistant/cohere"));
const { fakeApi } = require("./fixture");

const arg = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};
const has = (flag) => process.argv.includes(flag);

const MODEL = arg("--model", process.env.COHERE_MODEL || DEFAULT_MODEL);
const RUNS = Number(arg("--runs", 3));
// Cohere rejects strict_tools when any tool takes no required argument, which
// get_my_work and list_my_projects both deliberately do. Kept as a flag for
// when that changes.
const STRICT = has("--strict");
const ONLY = arg("--only", null);

const USER = { id: 1, firstName: "Ada", lastName: "Lovelace" };

// --- scenarios ---------------------------------------------------------------
// Each check returns null when it passes, or a short reason when it does not.

const said = (reply, ...needles) =>
  needles.every((n) => reply.toLowerCase().includes(String(n).toLowerCase()));
const called = (toolCalls, name) => toolCalls.some((c) => c.name === name && !c.isError);
const linked = (reply, url) => reply.includes(`](${url})`);

const SCENARIOS = [
  {
    id: "my-work",
    turns: ["what am I working on?"],
    context: { projectId: 1 },
    check: ({ reply, toolCalls }) => {
      if (!called(toolCalls, "get_my_work")) return "did not call get_my_work";
      // assigned: 70 (Atlas), 76 (Beacon). reviewing: 71, 74, 77.
      if (!said(reply, "login")) return "missed the login story (assigned)";
      if (!said(reply, "dashboard")) return "missed the Beacon story (cross-project)";
      if (!said(reply, "utf-8") && !said(reply, "utf8")) return "missed a story it reviews";
      return null;
    },
  },
  {
    id: "find-loose",
    turns: ["what's the deal with the login bug?"],
    context: { projectId: 1 },
    check: ({ reply }) => {
      if (!said(reply, "login")) return "did not identify the story";
      if (!linked(reply, "/projects/1/stories/70")) return "did not link story 70";
      return null;
    },
  },
  {
    id: "count",
    turns: ["how many stories are in this project?"],
    context: { projectId: 1 },
    check: ({ reply }) => (said(reply, "6") || said(reply, "six") ? null : "wrong or missing count (want 6)"),
  },
  {
    id: "backlog",
    turns: ["what's in the backlog?"],
    context: { projectId: 1 },
    check: ({ reply, toolCalls }) => {
      if (!called(toolCalls, "get_backlog")) return "did not call get_backlog";
      if (!said(reply, "csv")) return "missed the CSV export story";
      if (!said(reply, "pipeline")) return "missed the pipeline story";
      return null;
    },
  },
  {
    id: "manager",
    turns: ["who is my manager?"],
    context: { projectId: 1 },
    check: ({ reply }) => (said(reply, "erin") ? null : "did not name Erin Engineer"),
  },
  {
    id: "sprint-progress",
    turns: ["how is the sprint going?"],
    context: { projectId: 1 },
    check: ({ reply, toolCalls }) =>
      called(toolCalls, "get_sprint_progress") || called(toolCalls, "get_sprint")
        ? null
        : "did not read sprint progress",
  },
  {
    id: "write-state",
    turns: ["move the login bug to In Review"],
    context: { projectId: 1 },
    check: ({ toolCalls, db }) => {
      if (!called(toolCalls, "set_story_state") && !called(toolCalls, "update_story")) {
        return "no write tool succeeded";
      }
      const story = db.rawStories.find((s) => s.id === 70);
      return Number(story.stateId) === 12 ? null : `story 70 is in state ${story.stateId}, wanted 12`;
    },
  },
  {
    id: "write-assign",
    turns: ["assign the UTF-8 one to Carol"],
    context: { projectId: 1 },
    check: ({ db }) => {
      const story = db.rawStories.find((s) => s.id === 74);
      return Number(story.assigneeId) === 6 ? null : `assignee is ${story.assigneeId}, wanted 6`;
    },
  },
  {
    id: "write-create",
    turns: ["add a story for fixing the password reset email"],
    context: { projectId: 1 },
    check: ({ db, toolCalls }) => {
      if (!called(toolCalls, "create_story")) return "did not call create_story";
      const made = db.rawStories.find((s) => s.id > 900);
      if (!made) return "nothing was created";
      if (!made.description) return "created with no description";
      if (!/as a .*(when|i want)/i.test(made.description)) return "description is not a user story";
      return null;
    },
  },
  {
    id: "this-story",
    turns: ["what is this story about?"],
    context: { projectId: 1, storyId: 71 },
    check: ({ reply }) =>
      said(reply, "email") || said(reply, "notification") ? null : "did not read the open story",
  },
  {
    // The multi-turn case. The second question is answerable only from the
    // first answer's tool results, which is exactly what used to be discarded.
    id: "followup",
    turns: ["what am I working on?", "tell me more about the first one"],
    context: { projectId: 1 },
    check: ({ reply, perTurn }) => {
      if (!said(reply, "login") && !said(reply, "dashboard") && !said(reply, "utf")) {
        return "lost the thread of its own list";
      }
      // it can still look up detail it did not have, but re-running the survey
      // it already has the answer to is the waste the session store removes
      if (perTurn[1].toolCalls.some((c) => c.name === "get_my_work")) {
        return "ran get_my_work again instead of reading what it already had";
      }
      return null;
    },
  },
  {
    // A pronoun with no antecedent in this turn at all.
    id: "followup-write",
    turns: ["what's in the backlog?", "assign the CSV one to Carol"],
    context: { projectId: 1 },
    check: ({ db }) => {
      const story = db.rawStories.find((s) => s.id === 72);
      return Number(story.assigneeId) === 6 ? null : `assignee is ${story.assigneeId}, wanted 6`;
    },
  },
  {
    id: "no-delete",
    turns: ["delete the CSV export story"],
    context: { projectId: 1 },
    check: ({ reply, db }) => {
      if (db.rawStories.some((s) => s.id === 72) === false) return "it actually deleted something";

      const refused = /can'?t|cannot|unable|not able|don'?t allow|doesn'?t allow|no way to|not possible|off-limits/i;
      if (!refused.test(reply)) return "did not refuse plainly";

      // the prompt forbids working around the refusal by moving it out of the way
      if (/archiv|move it to|mark it done|unassign/i.test(reply)) return "offered a workaround it was told not to";
      return null;
    },
  },
];

// --- runner ------------------------------------------------------------------

const { CohereClientV2 } = require("cohere-ai");
const cohere = new CohereClientV2({ token: process.env.COHERE_API_KEY });

// strict_tools is a per-request flag; wrap .chat rather than touching the loop
const client = STRICT
  ? { chat: (request) => cohere.chat({ ...request, strictTools: true }) }
  : cohere;

// Mirrors app/assistant/index.js: same page-context defaulting, same carrying
// of the previous exchange, so the eval exercises what production runs.
async function runScenario(scenario) {
  const { api, db, calls } = fakeApi(USER.id);
  const session = await openSession({ api, userId: USER.id });
  const context = scenario.context ?? {};

  const messages = [];
  const perTurn = [];
  let priorHistory = null;
  let last = null;

  try {
    const tools = await session.listTools();
    const callTool = withPageContext(session.callTool, tools, context);

    for (const turn of scenario.turns) {
      messages.push({ role: "user", content: turn });
      const before = calls.length;

      last = await runConversation({
        cohere: client,
        tools,
        callTool,
        user: USER,
        messages: [...messages],
        context,
        priorHistory,
        model: MODEL,
      });

      priorHistory = last.history;
      perTurn.push({ toolCalls: last.toolCalls, apiCalls: calls.length - before });
      messages.push({ role: "assistant", content: last.reply });
    }
  } finally {
    await session.close();
  }

  const failure = scenario.check({ ...last, db, calls, perTurn });
  return { ...last, failure, apiCalls: calls.length };
}

const pct = (n, d) => (d === 0 ? "0" : ((n / d) * 100).toFixed(0));

(async () => {
  const chosen = ONLY ? SCENARIOS.filter((s) => s.id === ONLY) : SCENARIOS;
  console.log(`model=${MODEL} strict=${STRICT} runs=${RUNS} scenarios=${chosen.length}\n`);

  const summary = [];
  let totalPass = 0;
  let totalRuns = 0;
  let totalTurns = 0;
  let totalApi = 0;

  for (const scenario of chosen) {
    const reasons = [];
    let pass = 0;

    for (let run = 0; run < RUNS; run += 1) {
      try {
        const result = await runScenario(scenario);
        totalTurns += result.turns;
        totalApi += result.apiCalls;
        if (result.failure) reasons.push(result.failure);
        else pass += 1;
      } catch (err) {
        reasons.push(`THREW: ${err.message.slice(0, 90)}`);
      }
      totalRuns += 1;
      await new Promise((r) => setTimeout(r, 400)); // stay under the rate limit
    }

    totalPass += pass;
    const mark = pass === RUNS ? "PASS" : pass === 0 ? "FAIL" : "FLAKY";
    console.log(`${mark.padEnd(6)} ${scenario.id.padEnd(16)} ${pass}/${RUNS}`);
    for (const reason of [...new Set(reasons)]) console.log(`         · ${reason}`);
    summary.push({ id: scenario.id, pass, runs: RUNS });
  }

  console.log(
    `\nOVERALL ${totalPass}/${totalRuns} (${pct(totalPass, totalRuns)}%)  ` +
      `avg turns ${(totalTurns / totalRuns).toFixed(1)}  avg API calls ${(totalApi / totalRuns).toFixed(1)}`,
  );
})();
