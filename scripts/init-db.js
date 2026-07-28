// =============================================================================
// INIT DATABASE
// - Seeds a large, demo-ready dataset across several projects.
// - Story `completedAt` timestamps are deliberately spread across each sprint's
//   window so the burndown chart shows a steady, realistic decline. See the
//   `spreadOffsets` helper and `seedSprint` below.
// - AI was used to generate this file.
// =============================================================================

require("dotenv").config();

const db = require("../app/models");
const { getSalt, hashPassword } = require("../app/authentication/crypto");
// Pull the vocabulary from the app itself so the seeded history can't drift
// from what the controllers actually write.
const { ACTIVITY_ACTION, SUBJECT_TYPE, RELATION_DIRECTION } = require("../app/utils/activity");

const RELATION_TYPES = ["BLOCKS", "RELATES_TO", "DUPLICATES", "PARENT_OF"];
const PRIORITIES = ["Blocker", "High", "Medium", "Low"];
const ESTIMATES = [1, 2, 3, 5, 8, 13];

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const wipe = args.includes("--wipe") || args.includes("--force") || !args.includes("--no-wipe");

if (help) {
  console.log("Usage: node scripts/init-db.js [--no-wipe] [--help]");
  console.log("  --no-wipe   Preserve existing tables and only sync without dropping them.");
  console.log("  --wipe      Drop and recreate all tables before seeding (default).");
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Date + random helpers — relative dates keep the seed sensible whenever it runs.
// -----------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
// `n` may be fractional so completions can land at any hour within a day.
const days = (n) => new Date(Date.now() + n * DAY_MS);
const hours = (n) => new Date(Date.now() + n * 60 * 60 * 1000);

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sample = (arr, n) => shuffle(arr).slice(0, n);

// Return `count` ascending day-offsets spread across [startOffset, endOffset],
// with mild jitter. Used to scatter story completions so a burndown declines
// steadily rather than dropping all at once.
const spreadOffsets = (count, startOffset, endOffset) => {
  if (count <= 0) return [];
  const span = endOffset - startOffset;
  const out = [];
  for (let i = 0; i < count; i++) {
    const frac = (i + 0.5) / count;
    const jitter = ((Math.random() - 0.5) * span) / (count * 1.5);
    out.push(startOffset + frac * span + jitter);
  }
  return out.sort((a, b) => a - b);
};

// -----------------------------------------------------------------------------
// Activity history
// - Every seeded row that a controller would have logged gets a matching
//   activity, back-dated so the feed reads as a plausible timeline rather than
//   a wall of rows all stamped "now".
// - `storyWindow` remembers when each story was opened and closed so the
//   entries hung off it can be scattered between those two points.
// -----------------------------------------------------------------------------
const storyWindow = new WeakMap();

// A random day-offset inside [a, b]; used to place an entry somewhere in a
// story's lifetime.
const between = (a, b) => a + Math.random() * (b - a);

const fullName = (user) => (user ? `${user.firstName} ${user.lastName}` : null);

// Mirrors app/utils/activity.recordActivity, but back-dates the rows. Sequelize
// keeps an explicit createdAt and, with `silent`, an explicit updatedAt too.
const logActivity = async ({ storyId, subjectType, subjectId, action, metadata, user, at, changes }) => {
  const timestamp = days(at);
  const activity = await db.activity.create(
    {
      storyId,
      subjectType,
      subjectId,
      action,
      metadata: metadata ?? {},
      userId: user ? user.id : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { silent: true },
  );

  if (changes?.length) {
    await db.activityChange.bulkCreate(
      changes.map((c) => ({
        activityId: activity.id,
        attribute: c.attribute,
        operation: c.operation ?? null,
        oldValue: c.oldValue ?? null,
        newValue: c.newValue ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      { silent: true },
    );
  }

  return activity;
};

// A title dispenser that draws unique titles from a pool, appending a round
// number once the pool is exhausted so bulk generation never collides.
const makeDispenser = (pool) => {
  let bag = [];
  let round = 0;
  return () => {
    if (!bag.length) {
      bag = shuffle(pool);
      round += 1;
    }
    const title = bag.pop();
    return round > 1 ? `${title} (${round})` : title;
  };
};

// -----------------------------------------------------------------------------
// Content pools
// -----------------------------------------------------------------------------
const FEATURE_TITLES = [
  "Implement user login",
  "Password reset flow",
  "Kanban board drag-and-drop",
  "Email notifications on assignment",
  "Dark mode support",
  "Sprint burndown chart",
  "Story search and filtering",
  "Bulk edit stories",
  "Markdown support in comments",
  "@mentions in comments",
  "Keyboard shortcuts for the board",
  "CSV export of stories",
  "Saved board filters",
  "Project activity feed",
  "Role-based access control",
  "Custom story states",
  "Sprint velocity report",
  "Inline story estimation",
  "Attachment uploads on stories",
  "Slack integration for standups",
  "Recurring sprint scheduling",
  "Story templates",
  "Multi-assignee support",
  "Board swimlanes by assignee",
  "Retrospective action items",
  "Cumulative flow diagram",
];
const BUG_TITLES = [
  "Fix session expiration bug",
  "Board columns misalign on Safari",
  "Comment timestamps show wrong timezone",
  "Drag-and-drop drops card in wrong column",
  "Email notifications sent twice",
  "Estimate field accepts negative numbers",
  "Search ignores archived stories",
  "CSV export mangles UTF-8 characters",
  "Sprint dates off by one day",
  "Avatar images fail to load intermittently",
  "Filter reset does not clear the query",
  "Pagination skips the last page",
  "Story count badge is stale after delete",
  "Login redirect loops on expired token",
];
const CHORE_TITLES = [
  "Upgrade Sequelize to latest",
  "Add ESLint and Prettier config",
  "Set up CI pipeline",
  "Bump Node to the LTS release",
  "Add database indexes for story queries",
  "Write API integration tests",
  "Document environment variables",
  "Refactor auth middleware",
  "Add request logging",
  "Containerize the backend",
  "Enable dependency vulnerability scanning",
];
const SPIKE_TITLES = [
  "Spike: evaluate WebSocket vs polling",
  "Spike: assess GraphQL adoption",
  "Spike: benchmark board rendering performance",
  "Spike: research SSO providers",
  "Spike: evaluate feature-flag services",
  "Spike: prototype offline support",
];

const DESCRIPTIONS = {
  Feature: (t) => `As a user, I want ${t.toLowerCase()} so the product feels complete.`,
  Bug: (t) => `Investigate and resolve: ${t.toLowerCase()}. Include a regression test.`,
  Chore: (t) => `Engineering task: ${t.toLowerCase()}. No user-facing behavior change expected.`,
  Spike: (t) => `Time-boxed investigation. ${t.replace(/^Spike:\s*/, "")} and report findings.`,
};

const COMMENT_SNIPPETS = [
  "Starting on this today.",
  "Pushed a branch, ready for a first look.",
  "Blocked on the API contract — flagged in the channel.",
  "Reproduced locally, digging into the root cause.",
  "Rebased and resolved conflicts.",
  "Left a couple review notes, nothing major.",
  "Good to merge once CI is green.",
  "Split this out from the parent story to keep it small.",
  "Added tests for the edge cases we missed.",
  "Design signed off on the latest mock.",
  "Bumped priority after the demo feedback.",
  "Nice work — this is a lot cleaner than the old flow.",
];

const AC_TEMPLATES = [
  { title: "Happy path succeeds", description: "The primary flow completes without errors." },
  { title: "Validation errors are shown", description: "Invalid input surfaces a clear message." },
  { title: "Unauthorized access is rejected", description: "Requests without a valid session return 401." },
  { title: "State persists across reloads", description: "Changes survive a full page refresh." },
  { title: "Works on mobile widths", description: "Layout is usable down to 375px." },
  { title: "Empty state is handled", description: "No data renders a helpful placeholder, not a crash." },
  { title: "Loads within budget", description: "Initial render completes under two seconds." },
];

const AC_STATUSES = ["Pending", "Passed", "Failed"];

// -----------------------------------------------------------------------------
// Story generation helpers (project-scoped via a `ctx` object)
// -----------------------------------------------------------------------------
const pickTypeName = () => {
  const r = Math.random();
  if (r < 0.55) return "Feature";
  if (r < 0.8) return "Bug";
  if (r < 0.92) return "Chore";
  return "Spike";
};

const dispensers = {
  Feature: makeDispenser(FEATURE_TITLES),
  Bug: makeDispenser(BUG_TITLES),
  Chore: makeDispenser(CHORE_TITLES),
  Spike: makeDispenser(SPIKE_TITLES),
};

// Create a single story, filling in sensible random values for anything the
// caller doesn't pin down explicitly.
const createStory = async (ctx, o = {}) => {
  const typeName = o.typeName || pickTypeName();
  const type = ctx.typeByName[typeName] || rand(Object.values(ctx.typeByName));
  const title = o.title || dispensers[typeName]();

  let repositoryId = null;
  if (o.repositoryId !== undefined) repositoryId = o.repositoryId;
  else if (ctx.repos.length && chance(0.6)) repositoryId = rand(ctx.repos).id;

  let assigneeId;
  if (o.assignee === null) assigneeId = null;
  else if (o.assignee) assigneeId = o.assignee.id;
  else assigneeId = chance(0.85) ? rand(ctx.members).id : null;

  let reviewerId;
  if (o.reviewer === null) reviewerId = null;
  else if (o.reviewer) reviewerId = o.reviewer.id;
  else reviewerId = chance(0.65) ? rand(ctx.members).id : null;

  // When the story was opened. Everything hung off it — the activity feed,
  // comments, criteria — is placed relative to this, so it always sits in the
  // past even for a sprint that hasn't started yet.
  const createdOffset = o.createdOffset ?? -randInt(5, 40);
  const completedOffset = o.completedOffset ?? null;

  const story = await db.story.create(
    {
      title,
      description: o.description || DESCRIPTIONS[typeName](title),
      priority: o.priority || rand(PRIORITIES),
      estimate: o.estimate ?? rand(ESTIMATES),
      projectId: ctx.project.id,
      sprintId: o.sprintId ?? null,
      stateId: o.stateId,
      typeId: type.id,
      repositoryId,
      reporterId: (o.reporter || rand(ctx.members)).id,
      assigneeId,
      reviewerId,
      completedAt: o.completedAt ?? null,
      createdAt: days(createdOffset),
      updatedAt: days(completedOffset ?? createdOffset),
    },
    { silent: true },
  );

  storyWindow.set(story, {
    opened: createdOffset,
    // Open stories keep accruing history right up to now.
    closed: completedOffset ?? 0,
    completed: completedOffset != null,
  });

  return story;
};

// Seed a sprint's worth of stories.
//   completedCount stories land in the done state with `completedAt` spread
//   across [startOffset, completionEnd], producing a clean burndown; the rest
//   are left open in a random non-done state.
const seedSprint = async (ctx, opts) => {
  const {
    sprint,
    startOffset,
    endOffset,
    total,
    completedCount,
    completionEnd = endOffset, // active sprints cut this off at "now"
  } = opts;

  const stories = [];
  const offsets = spreadOffsets(completedCount, startOffset + 0.5, completionEnd - 0.3);

  // Stories are written up shortly before the sprint opens. A planned sprint
  // starts in the future, so clamp the write-up to the recent past.
  const plannedAt = Math.min(startOffset, -0.5);
  const openedAt = () => plannedAt - Math.random() * 2;

  for (let i = 0; i < completedCount; i++) {
    stories.push(
      await createStory(ctx, {
        sprintId: sprint.id,
        stateId: ctx.doneState.id,
        completedAt: days(offsets[i]),
        createdOffset: openedAt(),
        completedOffset: offsets[i],
      }),
    );
  }
  for (let i = 0; i < total - completedCount; i++) {
    stories.push(
      await createStory(ctx, {
        sprintId: sprint.id,
        stateId: rand(ctx.openStates).id,
        createdOffset: openedAt(),
      }),
    );
  }
  return stories;
};

// Attach acceptance criteria, comments, and activities to a batch of stories so
// the demo has plenty of nested data to browse.
const enrichStories = async (ctx, stories) => {
  const memberById = new Map(ctx.members.map((m) => [m.id, m]));
  const stateById = new Map(ctx.states.map((s) => [s.id, s]));

  for (const story of stories) {
    const isDone = story.completedAt != null;
    const { opened, closed } = storyWindow.get(story);
    const reporter = memberById.get(story.reporterId) || rand(ctx.members);
    const assignee = memberById.get(story.assigneeId) || null;
    // The state the story was filed in; the transitions below walk from here to
    // whatever state it sits in now.
    const firstState = ctx.openStates[0] || ctx.doneState;

    // --- The story itself ----------------------------------------------------
    await logActivity({
      storyId: story.id,
      subjectType: SUBJECT_TYPE.STORY,
      subjectId: story.id,
      action: ACTIVITY_ACTION.CREATED,
      user: reporter,
      at: opened,
      metadata: {
        title: story.title,
        state: firstState.name,
        assignee: fullName(assignee),
      },
    });

    // The assignment is its own edit a little after filing, the way it happens
    // in the app: file the story, then hand it to someone.
    if (assignee) {
      await logActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.STORY,
        subjectId: story.id,
        action: ACTIVITY_ACTION.UPDATED,
        user: reporter,
        at: between(opened, opened + (closed - opened) * 0.25),
        metadata: { user: fullName(reporter) },
        changes: [
          {
            attribute: "assignee",
            oldValue: null,
            newValue: { id: assignee.id, label: fullName(assignee) },
          },
        ],
      });
    }

    // A re-estimate part way through, on some stories.
    if (chance(0.35)) {
      const previous = rand(ESTIMATES.filter((e) => e !== story.estimate));
      await logActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.STORY,
        subjectId: story.id,
        action: ACTIVITY_ACTION.UPDATED,
        user: assignee || reporter,
        at: between(opened, closed),
        metadata: { user: fullName(assignee || reporter) },
        changes: [{ attribute: "estimate", oldValue: previous, newValue: story.estimate }],
      });
    }

    // A re-prioritisation, on fewer still.
    if (chance(0.2)) {
      const previous = rand(PRIORITIES.filter((p) => p !== story.priority));
      await logActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.STORY,
        subjectId: story.id,
        action: ACTIVITY_ACTION.UPDATED,
        user: rand(ctx.members),
        at: between(opened, closed),
        metadata: { user: fullName(rand(ctx.members)) },
        changes: [{ attribute: "priority", oldValue: previous, newValue: story.priority }],
      });
    }

    // --- State transitions ---------------------------------------------------
    // Walk the board one column at a time, ending on the story's current state.
    // A completed story lands in the done column exactly at its completedAt so
    // the feed and the burndown agree.
    const currentState = stateById.get(story.stateId) || firstState;
    const path = ctx.states.slice(0, ctx.states.findIndex((s) => s.id === currentState.id) + 1);
    const moveTimes = spreadOffsets(path.length - 1, opened + 0.2, closed);
    for (let i = 1; i < path.length; i++) {
      const landing = isDone && i === path.length - 1 ? closed : moveTimes[i - 1];
      const mover = assignee || rand(ctx.members);
      await logActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.STORY,
        subjectId: story.id,
        action: ACTIVITY_ACTION.UPDATED,
        user: mover,
        at: landing,
        metadata: { user: fullName(mover) },
        changes: [
          {
            attribute: "state",
            oldValue: { id: path[i - 1].id, label: path[i - 1].name },
            newValue: { id: path[i].id, label: path[i].name },
          },
        ],
      });
    }

    // --- Acceptance criteria (~65% of stories get 1-3) -----------------------
    if (chance(0.65)) {
      for (const template of sample(AC_TEMPLATES, randInt(1, 3))) {
        const status = isDone ? (chance(0.85) ? "Passed" : "Failed") : rand(AC_STATUSES);
        const writtenAt = between(opened, opened + (closed - opened) * 0.4);
        const author = rand(ctx.members);

        const ac = await db.acceptanceCriteria.create(
          {
            title: template.title,
            description: template.description,
            status,
            storyId: story.id,
            createdAt: days(writtenAt),
            updatedAt: days(writtenAt),
          },
          { silent: true },
        );

        // Criteria start unverified, so that is what the feed shows first.
        await logActivity({
          storyId: story.id,
          subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
          subjectId: ac.id,
          action: ACTIVITY_ACTION.CREATED,
          user: author,
          at: writtenAt,
          metadata: {
            title: ac.title,
            status: "Pending",
            user: fullName(author),
          },
        });

        // ...and the verification that moved it is a second entry.
        if (status !== "Pending") {
          const verifier = rand(ctx.members);
          await logActivity({
            storyId: story.id,
            subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
            subjectId: ac.id,
            action: ACTIVITY_ACTION.UPDATED,
            user: verifier,
            at: between(writtenAt, closed),
            metadata: {
              user: fullName(verifier),
              title: ac.title,
              status,
            },
            changes: [{ attribute: "status", oldValue: "Pending", newValue: status }],
          });
        }

        // Occasional comment on the criteria itself.
        if (chance(0.3)) {
          const commentedAt = between(writtenAt, closed);
          const commenter = rand(ctx.members);
          const comment = await db.comment.create(
            {
              content: rand(COMMENT_SNIPPETS),
              acceptanceCriteriaId: ac.id,
              userId: commenter.id,
              createdAt: days(commentedAt),
              updatedAt: days(commentedAt),
            },
            { silent: true },
          );
          await logActivity({
            storyId: story.id,
            subjectType: SUBJECT_TYPE.COMMENT,
            subjectId: comment.id,
            action: ACTIVITY_ACTION.CREATED,
            user: commenter,
            at: commentedAt,
            metadata: {
              content: comment.content.slice(0, 100),
              subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
              subjectLabel: ac.title,
              user: fullName(commenter),
            },
          });
        }
      }
    }

    // A criterion that was written and then thought better of. The row is gone
    // but the history still renders, which is the whole point of the metadata
    // snapshot on the activity.
    if (chance(0.08)) {
      const template = rand(AC_TEMPLATES);
      const author = rand(ctx.members);
      const writtenAt = between(opened, closed);
      const scrapped = await db.acceptanceCriteria.create(
        {
          title: template.title,
          description: template.description,
          status: "Pending",
          storyId: story.id,
          createdAt: days(writtenAt),
          updatedAt: days(writtenAt),
        },
        { silent: true },
      );
      const acMeta = {
        title: scrapped.title,
        status: "Pending",
        user: fullName(author),
      };
      await logActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
        subjectId: scrapped.id,
        action: ACTIVITY_ACTION.CREATED,
        user: author,
        at: writtenAt,
        metadata: acMeta,
      });
      await logActivity({
        storyId: story.id,
        subjectType: SUBJECT_TYPE.ACCEPTANCE_CRITERIA,
        subjectId: scrapped.id,
        action: ACTIVITY_ACTION.DELETED,
        user: author,
        at: between(writtenAt, closed),
        metadata: acMeta,
      });
      await scrapped.destroy();
    }

    // --- Story comments (~55% get 1-2) ---------------------------------------
    if (chance(0.55)) {
      for (let i = 0; i < randInt(1, 2); i++) {
        const commentedAt = between(opened, closed);
        const commenter = rand(ctx.members);
        const comment = await db.comment.create(
          {
            content: rand(COMMENT_SNIPPETS),
            storyId: story.id,
            userId: commenter.id,
            createdAt: days(commentedAt),
            updatedAt: days(commentedAt),
          },
          { silent: true },
        );
        await logActivity({
          storyId: story.id,
          subjectType: SUBJECT_TYPE.COMMENT,
          subjectId: comment.id,
          action: ACTIVITY_ACTION.CREATED,
          user: commenter,
          at: commentedAt,
          metadata: {
            content: comment.content.slice(0, 100),
            subjectType: SUBJECT_TYPE.STORY,
            subjectLabel: story.title,
            user: fullName(commenter),
          },
        });
      }
    }
  }
};

// Create random relations among a pool of stories, avoiding self-links and
// duplicate pairs.
const seedRelations = async (ctx, stories, count) => {
  const seen = new Set();
  let made = 0;
  let guard = 0;
  while (made < count && guard < count * 10) {
    guard += 1;
    const a = rand(stories);
    const b = rand(stories);
    if (a.id === b.id) continue;
    const key = [a.id, b.id].sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);

    const type = rand(RELATION_TYPES);
    // The link can only be drawn once both stories exist, and only while the
    // first of them is still being worked.
    const windows = [storyWindow.get(a), storyWindow.get(b)];
    const linkedAt = between(
      Math.max(windows[0].opened, windows[1].opened),
      Math.max(windows[0].closed, windows[1].closed),
    );
    const linker = rand(ctx.members);

    const relation = await db.relation.create(
      {
        type,
        storyOneId: a.id,
        storyTwoId: b.id,
        createdAt: days(linkedAt),
        updatedAt: days(linkedAt),
      },
      { silent: true },
    );

    // One entry per side, mirrored, so each story's feed reads from its own
    // point of view.
    for (const [self, other, direction] of [
      [a, b, RELATION_DIRECTION.OUTGOING],
      [b, a, RELATION_DIRECTION.INCOMING],
    ]) {
      await logActivity({
        storyId: self.id,
        subjectType: SUBJECT_TYPE.RELATION,
        subjectId: relation.id,
        action: ACTIVITY_ACTION.CREATED,
        user: linker,
        at: linkedAt,
        metadata: {
          type,
          self: { id: self.id, title: self.title },
          other: { id: other.id, title: other.title },
          user: fullName(linker),
          direction,
        },
      });
    }

    made += 1;
  }
};

const run = async () => {
  try {
    console.log(`Syncing database${wipe ? " (force=true)" : ""}...`);
    if (wipe) {
      const dialect = db.sequelize.getDialect();

      if (dialect === "postgres") {
        // Don't use sync({force:true}) here. Sequelize's drop() first reads every
        // FK constraint out of information_schema and removes them with
        // Promise.all before dropping any table. If that listing disagrees with
        // reality — a name reported twice, or one already gone — the parallel
        // ALTER TABLE ... DROP CONSTRAINT calls race and the loser fails with
        // 42704 "constraint ... does not exist", aborting the whole wipe. A
        // schema that has accumulated churn from repeated sync({alter:true})
        // (which server.js runs on every boot) is where this shows up.
        //
        // Dropping the schema outright skips that path entirely and is a
        // stricter wipe anyway: it clears tables, sequences, enums, and
        // constraints regardless of what state they were left in.
        await db.sequelize.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
        await db.sequelize.sync();
      } else if (dialect === "mysql") {
        // MySQL: disable FK checks so the drops can run regardless of
        // referential order (users is referenced by stories, sessions, etc.).
        //
        // FOREIGN_KEY_CHECKS is a per-connection setting, and Sequelize runs on
        // a connection pool — a single SET only affects one pooled connection,
        // but force:true may issue its DROP TABLEs on others. Use an
        // afterConnect hook so every connection the pool opens during sync has
        // checks disabled.
        const disableFkChecks = async (connection) => {
          await connection.promise().query("SET FOREIGN_KEY_CHECKS = 0");
        };
        db.sequelize.addHook("afterConnect", "disableFkChecks", disableFkChecks);
        try {
          await db.sequelize.sync({ force: true });
        } finally {
          db.sequelize.removeHook("afterConnect", "disableFkChecks");
        }
      } else {
        await db.sequelize.sync({ force: true });
      }
    } else {
      await db.sequelize.sync();
    }
    console.log("Database synced.");

    const salt = await getSalt();
    const passwordHash = await hashPassword("password", salt);

    // -------------------------------------------------------------------------
    // Users
    // -------------------------------------------------------------------------
    const userDefs = [
      { firstName: "Test", lastName: "User", email: "admin@example.com", isAdmin: true },
      { firstName: "Bob", lastName: "Builder", email: "bob@example.com" },
      { firstName: "Carol", lastName: "Coder", email: "carol@example.com" },
      { firstName: "Dave", lastName: "Designer", email: "dave@example.com" },
      { firstName: "Erin", lastName: "Engineer", email: "erin@example.com" },
      { firstName: "Frank", lastName: "Manager", email: "frank@example.com" },
      { firstName: "Grace", lastName: "QA", email: "grace@example.com" },
      { firstName: "Heidi", lastName: "Hacker", email: "heidi@example.com" },
      { firstName: "Ivan", lastName: "Infra", email: "ivan@example.com" },
      { firstName: "Judy", lastName: "Product", email: "judy@example.com" },
      { firstName: "Mallory", lastName: "Mobile", email: "mallory@example.com" },
      { firstName: "Oscar", lastName: "Ops", email: "oscar@example.com" },
      { firstName: "Isaiah", lastName: "Fisher", email: "isaiah.fisher@eagles.oc.edu", isAdmin: true },
    ];

    const users = {};
    for (const def of userDefs) {
      users[def.email] = await db.user.create({
        firstName: def.firstName,
        lastName: def.lastName,
        isAdmin: def.isAdmin || false,
        email: def.email,
        password: passwordHash,
        salt,
      });
    }
    const admin = users["admin@example.com"];
    const bob = users["bob@example.com"];
    const carol = users["carol@example.com"];
    const dave = users["dave@example.com"];
    const erin = users["erin@example.com"];
    const frank = users["frank@example.com"];
    const grace = users["grace@example.com"];
    const isaiah = users["isaiah.fisher@eagles.oc.edu"];
    const allUsers = Object.values(users);

    await db.session.create({
      email: admin.email,
      userId: admin.id,
      expirationDate: days(1),
    });

    // -------------------------------------------------------------------------
    // Helper: build the standard set of states/types for a project and return a
    // ready-to-use ctx.
    // -------------------------------------------------------------------------
    const buildStates = async (project, stateNames) => {
      const states = [];
      for (let i = 0; i < stateNames.length; i++) {
        states.push(
          await db.storyState.create({
            name: stateNames[i],
            order: i + 1,
            projectId: project.id,
          }),
        );
      }
      const doneState = states[states.length - 1];
      await project.update({ completedStateId: doneState.id });
      return { states, doneState, openStates: states.slice(0, -1) };
    };

    const buildTypes = async (project, typeNames) => {
      const typeByName = {};
      for (const name of typeNames) {
        typeByName[name] = await db.storyType.create({
          name,
          projectId: project.id,
        });
      }
      return typeByName;
    };

    const addMembers = async (project, entries) => {
      const members = [];
      for (const [user, isManager] of entries) {
        await db.projectMember.create({
          // Stored as a varchar "1"/"0" — a raw boolean stringifies to "true"
          // on Postgres but coerces to "1" on MySQL, so normalize it here.
          isManager: isManager ? "1" : "0",
          userId: user.id,
          projectId: project.id,
        });
        members.push(user);
      }
      return members;
    };

    // =========================================================================
    // Project 1: Nimble — the demo centerpiece with multiple sprints and a rich
    // burndown history.
    // =========================================================================
    const nimble = await db.project.create({
      title: "Nimble",
      description: "Agile project management, reimagined.",
      deadline: days(60),
    });

    const nimbleMembers = await addMembers(nimble, [
      [admin, true],
      [frank, true],
      [bob, false],
      [carol, false],
      [dave, false],
      [erin, false],
      [grace, false],
      [isaiah, false],
      [users["heidi@example.com"], false],
      [users["ivan@example.com"], false],
      [users["judy@example.com"], false],
    ]);

    const nimbleRepos = [];
    nimbleRepos.push(
      await db.repository.create({
        githubId: "123456789",
        name: "nimble-backend",
        projectId: nimble.id,
      }),
    );
    nimbleRepos.push(
      await db.repository.create({
        githubId: "987654321",
        name: "nimble-frontend",
        projectId: nimble.id,
      }),
    );

    const nimbleStateInfo = await buildStates(nimble, ["Not Started", "Ready", "In Progress", "In Review", "Done"]);
    const nimbleTypes = await buildTypes(nimble, ["Feature", "Bug", "Chore", "Spike"]);

    const nimbleCtx = {
      project: nimble,
      members: nimbleMembers,
      repos: nimbleRepos,
      typeByName: nimbleTypes,
      states: nimbleStateInfo.states,
      openStates: nimbleStateInfo.openStates,
      doneState: nimbleStateInfo.doneState,
    };

    // --- Sprints (14-day cadence) ---
    // Three completed sprints (fully burned down), one active (partway through),
    // one planned.
    const nimbleSprintDefs = [
      { title: "Sprint 1", start: -52, end: -38, status: "Completed", total: 11, completed: 11 },
      { title: "Sprint 2", start: -38, end: -24, status: "Completed", total: 13, completed: 13 },
      { title: "Sprint 3", start: -24, end: -10, status: "Completed", total: 12, completed: 12 },
      { title: "Sprint 4", start: -8, end: 6, status: "Active", total: 15, completed: 9, completionEnd: 0 },
      { title: "Sprint 5 (planned)", start: 7, end: 21, status: "Planned", total: 9, completed: 0 },
    ];

    const nimbleSprints = [];
    const nimbleStories = [];
    for (const def of nimbleSprintDefs) {
      const sprint = await db.sprint.create({
        title: def.title,
        goal: `Deliver committed scope for ${def.title}.`,
        startDate: days(def.start),
        endDate: days(def.end),
        status: def.status,
        projectId: nimble.id,
      });
      nimbleSprints.push(sprint);

      const stories = await seedSprint(nimbleCtx, {
        sprint,
        startOffset: def.start,
        endOffset: def.end,
        total: def.total,
        completedCount: def.completed,
        completionEnd: def.completionEnd ?? def.end,
      });
      nimbleStories.push(...stories);
    }

    // --- Backlog stories (no sprint assigned) ---
    for (let i = 0; i < 12; i++) {
      nimbleStories.push(
        await createStory(nimbleCtx, {
          sprintId: null,
          stateId: rand([nimbleStateInfo.states[0], nimbleStateInfo.states[1]]).id,
        }),
      );
    }

    await enrichStories(nimbleCtx, nimbleStories);
    await seedRelations(nimbleCtx, nimbleStories, 14);

    // --- Retrospectives (one per completed sprint) ---
    const retroSummaries = [
      "Solid velocity; onboarding docs still thin.",
      "Hit the sprint goal early — pulled in a stretch story.",
      "CI flakiness slowed reviews; added retries as a follow-up.",
    ];
    for (let i = 0; i < 3; i++) {
      await db.retrospective.create({
        agenda: `Review ${nimbleSprintDefs[i].title} outcomes and blockers.`,
        summary: retroSummaries[i],
        sprintId: nimbleSprints[i].id,
      });
    }

    // --- Standups across the active sprint's elapsed days ---
    const activeSprint = nimbleSprints[3];
    const standupNotes = [
      "Auth flow in progress; DB scaffolding merged.",
      "Repository integration underway; no blockers.",
      "Login endpoint in review; bug repro confirmed.",
      "Board drag-and-drop merged; polishing edge cases.",
      "Notifications spike wrapped; recommending WebSockets.",
      "Burndown on track; wrapping up review items.",
    ];
    for (let d = -7; d <= 0; d++) {
      if (chance(0.75)) {
        await db.standup.create({
          agenda: chance(0.5) ? "Daily sync" : null,
          notes: rand(standupNotes),
          date: days(d),
          sprintId: activeSprint.id,
        });
      }
    }

    // =========================================================================
    // Project 2: Atlas — Test User is a manager. Smaller, but still with a
    // completed burndown and an in-progress sprint.
    // =========================================================================
    const atlas = await db.project.create({
      title: "Atlas",
      description: "Internal analytics and reporting platform.",
      deadline: days(90),
    });
    const atlasMembers = await addMembers(atlas, [
      [admin, true],
      [bob, false],
      [erin, false],
      [isaiah, false],
      [users["ivan@example.com"], false],
      [users["oscar@example.com"], false],
    ]);
    const atlasRepos = [
      await db.repository.create({
        githubId: "555001",
        name: "atlas-api",
        projectId: atlas.id,
      }),
    ];
    const atlasStateInfo = await buildStates(atlas, ["To Do", "Doing", "Done"]);
    const atlasTypes = await buildTypes(atlas, ["Feature", "Bug", "Chore"]);
    const atlasCtx = {
      project: atlas,
      members: atlasMembers,
      repos: atlasRepos,
      typeByName: atlasTypes,
      states: atlasStateInfo.states,
      openStates: atlasStateInfo.openStates,
      doneState: atlasStateInfo.doneState,
    };

    const atlasSprintDefs = [
      { title: "Atlas Sprint 1", start: -30, end: -16, status: "Completed", total: 9, completed: 9 },
      { title: "Atlas Sprint 2", start: -6, end: 8, status: "Active", total: 10, completed: 5, completionEnd: 0 },
    ];
    const atlasStories = [];
    for (const def of atlasSprintDefs) {
      const sprint = await db.sprint.create({
        title: def.title,
        goal: `Deliver committed scope for ${def.title}.`,
        startDate: days(def.start),
        endDate: days(def.end),
        status: def.status,
        projectId: atlas.id,
      });
      const stories = await seedSprint(atlasCtx, {
        sprint,
        startOffset: def.start,
        endOffset: def.end,
        total: def.total,
        completedCount: def.completed,
        completionEnd: def.completionEnd ?? def.end,
      });
      atlasStories.push(...stories);
    }
    for (let i = 0; i < 6; i++) {
      atlasStories.push(
        await createStory(atlasCtx, {
          sprintId: null,
          stateId: atlasStateInfo.states[0].id,
        }),
      );
    }
    await enrichStories(atlasCtx, atlasStories);
    await seedRelations(atlasCtx, atlasStories, 5);

    // =========================================================================
    // Project 3: Beacon — Test User is NOT a member (access-control demo).
    // =========================================================================
    const beacon = await db.project.create({
      title: "Beacon",
      description: "Customer-facing notifications service.",
      deadline: days(45),
    });
    const beaconMembers = await addMembers(beacon, [
      [bob, true],
      [carol, false],
      [grace, false],
      [isaiah, false],
      [users["mallory@example.com"], false],
    ]);
    const beaconStateInfo = await buildStates(beacon, ["Not Started", "Building", "Shipped"]);
    const beaconTypes = await buildTypes(beacon, ["Feature", "Bug"]);
    const beaconCtx = {
      project: beacon,
      members: beaconMembers,
      repos: [],
      typeByName: beaconTypes,
      states: beaconStateInfo.states,
      openStates: beaconStateInfo.openStates,
      doneState: beaconStateInfo.doneState,
    };

    const beaconSprintDefs = [
      { title: "Beacon Sprint 1", start: -20, end: -6, status: "Completed", total: 8, completed: 8 },
      { title: "Beacon Sprint 2", start: -3, end: 11, status: "Active", total: 8, completed: 2, completionEnd: 0 },
    ];
    const beaconStories = [];
    for (const def of beaconSprintDefs) {
      const sprint = await db.sprint.create({
        title: def.title,
        goal: `Deliver committed scope for ${def.title}.`,
        startDate: days(def.start),
        endDate: days(def.end),
        status: def.status,
        projectId: beacon.id,
      });
      const stories = await seedSprint(beaconCtx, {
        sprint,
        startOffset: def.start,
        endOffset: def.end,
        total: def.total,
        completedCount: def.completed,
        completionEnd: def.completionEnd ?? def.end,
      });
      beaconStories.push(...stories);
    }
    for (let i = 0; i < 5; i++) {
      beaconStories.push(
        await createStory(beaconCtx, {
          sprintId: null,
          stateId: beaconStateInfo.states[0].id,
        }),
      );
    }
    await enrichStories(beaconCtx, beaconStories);
    await seedRelations(beaconCtx, beaconStories, 4);

    const totalStories = nimbleStories.length + atlasStories.length + beaconStories.length;
    console.log(`Seeded ${allUsers.length} users, 3 projects, and ${totalStories} stories.`);
    console.log("Init complete.");
    process.exit(0);
  } catch (error) {
    console.error("Init/verify failed:", error);
    process.exit(1);
  }
};

run();
