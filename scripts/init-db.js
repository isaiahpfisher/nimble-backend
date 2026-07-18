// =============================================================================
// INIT DATABASE
// - AI was used to generate this file
// =============================================================================

require("dotenv").config();

const db = require("../app/models");
const { getSalt, hashPassword } = require("../app/authentication/crypto");

const RELATION_TYPES = ["BLOCKS", "RELATES_TO", "DUPLICATES", "PARENT_OF"];

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const wipe =
  args.includes("--wipe") ||
  args.includes("--force") ||
  !args.includes("--no-wipe");

if (help) {
  console.log("Usage: node scripts/init-db.js [--no-wipe] [--help]");
  console.log(
    "  --no-wipe   Preserve existing tables and only sync without dropping them.",
  );
  console.log(
    "  --wipe      Drop and recreate all tables before seeding (default).",
  );
  process.exit(0);
}

// Helper: relative dates keep the seed data sensible no matter when it runs.
const days = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const hours = (n) => new Date(Date.now() + n * 60 * 60 * 1000);

const run = async () => {
  try {
    console.log(`Syncing database${wipe ? " (force=true)" : ""}...`);
    if (wipe) {
      // Disable FK checks so force:true can drop tables regardless of the
      // referential order (users is referenced by stories, sessions, etc.).
      await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
      try {
        await db.sequelize.sync({ force: true });
      } finally {
        await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
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
    const user = await db.user.create({
      firstName: "Test",
      lastName: "User",
      isAdmin: true,
      email: "admin@example.com",
      password: passwordHash,
      salt: salt,
    });
    const bob = await db.user.create({
      firstName: "Bob",
      lastName: "Builder",
      email: "bob@example.com",
      password: passwordHash,
      salt: salt,
    });
    const carol = await db.user.create({
      firstName: "Carol",
      lastName: "Coder",
      email: "carol@example.com",
      password: passwordHash,
      salt: salt,
    });
    const dave = await db.user.create({
      firstName: "Dave",
      lastName: "Designer",
      email: "dave@example.com",
      password: passwordHash,
      salt: salt,
    });
    const erin = await db.user.create({
      firstName: "Erin",
      lastName: "Engineer",
      email: "erin@example.com",
      password: passwordHash,
      salt: salt,
    });
    const frank = await db.user.create({
      firstName: "Frank",
      lastName: "Manager",
      email: "frank@example.com",
      password: passwordHash,
      salt: salt,
    });
    const grace = await db.user.create({
      firstName: "Grace",
      lastName: "QA",
      email: "grace@example.com",
      password: passwordHash,
      salt: salt,
    });
    const isaiah = await db.user.create({
      firstName: "Isaiah",
      lastName: "Fisher",
      isAdmin: true,
      email: "isaiah.fisher@eagles.oc.edu",
      password: passwordHash,
      salt: salt,
    });

    const session = await db.session.create({
      email: user.email,
      userId: user.id,
      expirationDate: days(1),
    });

    // -------------------------------------------------------------------------
    // Project 1: Nimble (Test User is the manager) — richly populated
    // -------------------------------------------------------------------------
    const project = await db.project.create({
      title: "Nimble",
      description: "Agile project management, reimagined.",
      deadline: days(60),
    });

    const memberOwner = await db.projectMember.create({
      isManager: true,
      userId: user.id,
      projectId: project.id,
    });
    const memberBob = await db.projectMember.create({
      isManager: false,
      userId: bob.id,
      projectId: project.id,
    });
    const memberCarol = await db.projectMember.create({
      isManager: false,
      userId: carol.id,
      projectId: project.id,
    });
    const memberDave = await db.projectMember.create({
      isManager: false,
      userId: dave.id,
      projectId: project.id,
    });
    const memberErin = await db.projectMember.create({
      isManager: false,
      userId: erin.id,
      projectId: project.id,
    });
    const memberGrace = await db.projectMember.create({
      isManager: false,
      userId: grace.id,
      projectId: project.id,
    });
    const memberIsaiah = await db.projectMember.create({
      isManager: false,
      userId: isaiah.id,
      projectId: project.id,
    });

    // --- Repositories ---
    const repository = await db.repository.create({
      githubId: "123456789",
      name: "nimble-backend",
      projectId: project.id,
    });
    const repositoryFrontend = await db.repository.create({
      githubId: "987654321",
      name: "nimble-frontend",
      projectId: project.id,
    });

    // --- Story states (type enum: unstarted | started | finished) ---
    const stateBacklog = await db.storyState.create({
      name: "Backlog",
      type: "unstarted",
      order: 1,
      projectId: project.id,
    });
    const stateReady = await db.storyState.create({
      name: "Ready",
      type: "unstarted",
      order: 2,
      projectId: project.id,
    });
    const stateInProgress = await db.storyState.create({
      name: "In Progress",
      type: "started",
      order: 3,
      projectId: project.id,
    });
    const stateReview = await db.storyState.create({
      name: "In Review",
      type: "started",
      order: 4,
      projectId: project.id,
    });
    const stateDone = await db.storyState.create({
      name: "Done",
      type: "finished",
      order: 5,
      projectId: project.id,
    });

    // --- Story types ---
    const typeFeature = await db.storyType.create({
      name: "Feature",
      projectId: project.id,
    });
    const typeBug = await db.storyType.create({
      name: "Bug",
      projectId: project.id,
    });
    const typeChore = await db.storyType.create({
      name: "Chore",
      projectId: project.id,
    });
    const typeSpike = await db.storyType.create({
      name: "Spike",
      projectId: project.id,
    });

    // --- Sprints ---
    const sprint0 = await db.sprint.create({
      name: "Sprint 0 (completed)",
      start: days(-28),
      end: days(-14),
      projectId: project.id,
    });
    const sprint = await db.sprint.create({
      name: "Sprint 1",
      start: days(-1),
      end: days(13),
      projectId: project.id,
    });
    const sprint2 = await db.sprint.create({
      name: "Sprint 2 (planned)",
      start: days(14),
      end: days(28),
      projectId: project.id,
    });

    // --- Retrospectives (one per sprint) ---
    const retrospective0 = await db.retrospective.create({
      agenda: "Review Sprint 0 kickoff and tooling setup.",
      summary: "Repo scaffolding done; onboarding docs still thin.",
      sprintId: sprint0.id,
    });
    const retrospective = await db.retrospective.create({
      agenda: "Review Sprint 1 outcomes and blockers.",
      summary: "Velocity on track; CI flakiness slowed reviews.",
      sprintId: sprint.id,
    });

    // --- Standups ---
    const standup1 = await db.standup.create({
      agenda: "Daily sync",
      notes: "Auth flow in progress; DB scaffolding merged.",
      date: days(0),
      sprintId: sprint.id,
    });
    const standup2 = await db.standup.create({
      agenda: null,
      notes: "Repository integration underway; no blockers.",
      date: days(1),
      sprintId: sprint.id,
    });
    const standup3 = await db.standup.create({
      agenda: "Mid-sprint check-in",
      notes: "Login endpoint in review; bug repro confirmed.",
      date: days(2),
      sprintId: sprint.id,
    });

    // -------------------------------------------------------------------------
    // Stories (nullable FKs exercised: repository/reporter/assignee/reviewer)
    // -------------------------------------------------------------------------
    const storyLogin = await db.story.create({
      title: "Implement user login",
      description: "Users can authenticate with email and password.",
      priority: "High",
      estimate: 3,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateInProgress.id,
      typeId: typeFeature.id,
      repositoryId: repository.id,
      reporterId: user.id,
      assigneeId: bob.id,
      reviewerId: carol.id,
    });
    const storyBug = await db.story.create({
      title: "Fix session expiration bug",
      description: "Sessions expire earlier than the configured window.",
      priority: "Low",
      estimate: 5,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateBacklog.id,
      typeId: typeBug.id,
      repositoryId: null,
      reporterId: carol.id,
      assigneeId: user.id,
      reviewerId: null,
    });
    const storyChore = await db.story.create({
      title: "Upgrade Sequelize to latest",
      description: "Bump ORM version and adjust breaking changes.",
      priority: "Blocker",
      estimate: 2,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateReview.id,
      typeId: typeChore.id,
      repositoryId: repository.id,
      reporterId: user.id,
      assigneeId: carol.id,
      reviewerId: bob.id,
    });
    const storyDone = await db.story.create({
      title: "Scaffold database models",
      description: "Create all Sequelize models and relationships.",
      priority: "Medium",
      estimate: 8,
      projectId: project.id,
      sprintId: sprint0.id,
      stateId: stateDone.id,
      typeId: typeFeature.id,
      repositoryId: repository.id,
      reporterId: bob.id,
      assigneeId: bob.id,
      reviewerId: user.id,
    });
    const storyPassword = await db.story.create({
      title: "Password reset flow",
      description: "Users can request and complete a password reset by email.",
      priority: "High",
      estimate: 5,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateReady.id,
      typeId: typeFeature.id,
      repositoryId: repository.id,
      reporterId: user.id,
      assigneeId: erin.id,
      reviewerId: carol.id,
    });
    const storyBoard = await db.story.create({
      title: "Kanban board drag-and-drop",
      description: "Drag stories between columns to change their state.",
      priority: "Medium",
      estimate: 8,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateInProgress.id,
      typeId: typeFeature.id,
      repositoryId: repositoryFrontend.id,
      reporterId: dave.id,
      assigneeId: dave.id,
      reviewerId: erin.id,
    });
    const storyNotifications = await db.story.create({
      title: "Email notifications on assignment",
      description: "Notify a user by email when a story is assigned to them.",
      priority: "Low",
      estimate: 3,
      projectId: project.id,
      sprintId: sprint2.id,
      stateId: stateBacklog.id,
      typeId: typeFeature.id,
      repositoryId: repository.id,
      reporterId: frank.id,
      assigneeId: null,
      reviewerId: null,
    });
    const storySpike = await db.story.create({
      title: "Spike: evaluate WebSocket vs polling",
      description: "Research real-time update options for the board.",
      priority: "Medium",
      estimate: 2,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateInProgress.id,
      typeId: typeSpike.id,
      repositoryId: null,
      reporterId: erin.id,
      assigneeId: erin.id,
      reviewerId: null,
    });
    const storyDarkMode = await db.story.create({
      title: "Dark mode support",
      description: "Add a theme toggle with persisted user preference.",
      priority: "Low",
      estimate: 5,
      projectId: project.id,
      sprintId: sprint2.id,
      stateId: stateBacklog.id,
      typeId: typeFeature.id,
      repositoryId: repositoryFrontend.id,
      reporterId: dave.id,
      assigneeId: dave.id,
      reviewerId: null,
    });

    // -------------------------------------------------------------------------
    // Relations between stories
    // -------------------------------------------------------------------------
    const relationBlocks = await db.relation.create({
      type: "BLOCKS",
      storyOneId: storyDone.id,
      storyTwoId: storyLogin.id,
    });
    const relationRelates = await db.relation.create({
      type: "RELATES_TO",
      storyOneId: storyLogin.id,
      storyTwoId: storyBug.id,
    });
    const relationParent = await db.relation.create({
      type: "PARENT_OF",
      storyOneId: storyLogin.id,
      storyTwoId: storyPassword.id,
    });
    const relationDuplicates = await db.relation.create({
      type: "DUPLICATES",
      storyOneId: storyDarkMode.id,
      storyTwoId: storyBoard.id,
    });

    // -------------------------------------------------------------------------
    // Acceptance criteria (status enum: Pending | Passed | Failed)
    // -------------------------------------------------------------------------
    const acLoginSuccess = await db.acceptanceCriteria.create({
      title: "Valid credentials succeed",
      description: "A user with correct email/password receives a session.",
      status: "Passed",
      storyId: storyLogin.id,
    });
    const acLoginFailure = await db.acceptanceCriteria.create({
      title: "Invalid credentials rejected",
      description: "A user with wrong credentials receives a 401.",
      status: "Pending",
      storyId: storyLogin.id,
    });
    const acLoginLockout = await db.acceptanceCriteria.create({
      title: "Account lockout after 5 attempts",
      description: "Repeated failures temporarily lock the account.",
      status: "Pending",
      storyId: storyLogin.id,
    });
    const acBugFixed = await db.acceptanceCriteria.create({
      title: "Sessions honor configured window",
      description: "Sessions no longer expire early.",
      status: "Failed",
      storyId: storyBug.id,
    });
    const acPasswordEmail = await db.acceptanceCriteria.create({
      title: "Reset email is sent",
      description: "Requesting a reset sends an email with a valid token.",
      status: "Pending",
      storyId: storyPassword.id,
    });
    const acPasswordExpiry = await db.acceptanceCriteria.create({
      title: "Reset token expires",
      description: "A reset token is rejected after 30 minutes.",
      status: "Pending",
      storyId: storyPassword.id,
    });
    const acBoardDrag = await db.acceptanceCriteria.create({
      title: "Dragging updates state",
      description: "Dropping a card in a column persists the new state.",
      status: "Passed",
      storyId: storyBoard.id,
    });
    const acBoardOrder = await db.acceptanceCriteria.create({
      title: "Card order is preserved",
      description: "Reordering within a column persists across reloads.",
      status: "Failed",
      storyId: storyBoard.id,
    });
    const acModelsMigrate = await db.acceptanceCriteria.create({
      title: "Schema syncs cleanly",
      description: "All models sync with no foreign-key errors.",
      status: "Passed",
      storyId: storyDone.id,
    });

    // -------------------------------------------------------------------------
    // Comments on STORIES (storyId set, acceptanceCriteriaId null)
    // -------------------------------------------------------------------------
    const commentBob = await db.comment.create({
      content: "Starting on the login endpoint today.",
      storyId: storyLogin.id,
      userId: bob.id,
    });
    const commentOwner = await db.comment.create({
      content: "Make sure to cover the invalid-credentials path.",
      storyId: storyLogin.id,
      userId: user.id,
    });
    const commentCarol = await db.comment.create({
      content: "Reproduced the bug locally, investigating.",
      storyId: storyBug.id,
      userId: carol.id,
    });
    const commentDave = await db.comment.create({
      content: "Drag-and-drop prototype is up on a branch for review.",
      storyId: storyBoard.id,
      userId: dave.id,
    });
    const commentErin = await db.comment.create({
      content: "Leaning toward WebSockets — polling is too chatty at scale.",
      storyId: storySpike.id,
      userId: erin.id,
    });
    const commentFrank = await db.comment.create({
      content: "Let's pull notifications into Sprint 2 once auth lands.",
      storyId: storyNotifications.id,
      userId: frank.id,
    });

    // -------------------------------------------------------------------------
    // Comments on ACCEPTANCE CRITERIA (acceptanceCriteriaId set, storyId null)
    // -------------------------------------------------------------------------
    const acCommentGrace = await db.comment.create({
      content: "Verified with a valid account — session cookie is set. 👍",
      acceptanceCriteriaId: acLoginSuccess.id,
      userId: grace.id,
    });
    const acCommentCarol = await db.comment.create({
      content: "Still returns 500 instead of 401 for a bad password.",
      acceptanceCriteriaId: acLoginFailure.id,
      userId: carol.id,
    });
    const acCommentBob = await db.comment.create({
      content: "Lockout threshold should be configurable, not hard-coded at 5.",
      acceptanceCriteriaId: acLoginLockout.id,
      userId: bob.id,
    });
    const acCommentGrace2 = await db.comment.create({
      content: "Confirmed sessions still expire ~5 min early. Marking failed.",
      acceptanceCriteriaId: acBugFixed.id,
      userId: grace.id,
    });
    const acCommentErin = await db.comment.create({
      content: "Token email lands in spam on Gmail — need SPF/DKIM set up.",
      acceptanceCriteriaId: acPasswordEmail.id,
      userId: erin.id,
    });
    const acCommentDave = await db.comment.create({
      content: "Order isn't preserved after reload — index isn't persisted.",
      acceptanceCriteriaId: acBoardOrder.id,
      userId: dave.id,
    });
    const acCommentUser = await db.comment.create({
      content: "Nice, schema sync is green in CI now.",
      acceptanceCriteriaId: acModelsMigrate.id,
      userId: user.id,
    });

    // -------------------------------------------------------------------------
    // Activities (changes stored as JSON)
    // -------------------------------------------------------------------------
    const activityCreated = await db.activity.create({
      entityType: "story",
      action: "created",
      changes: { title: "Implement user login" },
      userId: user.id,
      storyId: storyLogin.id,
    });
    const activityMoved = await db.activity.create({
      entityType: "story",
      action: "updated",
      changes: { stateId: [stateBacklog.id, stateInProgress.id] },
      userId: bob.id,
      storyId: storyLogin.id,
    });
    const activityAssigned = await db.activity.create({
      entityType: "story",
      action: "updated",
      changes: { assigneeId: [null, dave.id] },
      userId: frank.id,
      storyId: storyBoard.id,
    });
    const activityDone = await db.activity.create({
      entityType: "story",
      action: "updated",
      changes: { stateId: [stateReview.id, stateDone.id] },
      userId: user.id,
      storyId: storyDone.id,
    });

    // -------------------------------------------------------------------------
    // Project 2: Atlas (Test User is a member/manager)
    // -------------------------------------------------------------------------
    const project2 = await db.project.create({
      title: "Atlas",
      description: "Internal analytics and reporting platform.",
      deadline: days(90),
    });
    const member2Owner = await db.projectMember.create({
      isManager: true,
      userId: user.id,
      projectId: project2.id,
    });
    const member2Bob = await db.projectMember.create({
      isManager: false,
      userId: bob.id,
      projectId: project2.id,
    });
    const member2Erin = await db.projectMember.create({
      isManager: false,
      userId: erin.id,
      projectId: project2.id,
    });
    const member2Isaiah = await db.projectMember.create({
      isManager: false,
      userId: isaiah.id,
      projectId: project2.id,
    });

    const p2StateTodo = await db.storyState.create({
      name: "To Do",
      type: "unstarted",
      order: 1,
      projectId: project2.id,
    });
    const p2StateDoing = await db.storyState.create({
      name: "Doing",
      type: "started",
      order: 2,
      projectId: project2.id,
    });
    const p2StateDone = await db.storyState.create({
      name: "Done",
      type: "finished",
      order: 3,
      projectId: project2.id,
    });
    const p2TypeFeature = await db.storyType.create({
      name: "Feature",
      projectId: project2.id,
    });
    const p2TypeBug = await db.storyType.create({
      name: "Bug",
      projectId: project2.id,
    });
    const p2Sprint = await db.sprint.create({
      name: "Atlas Sprint 1",
      start: days(0),
      end: days(14),
      projectId: project2.id,
    });

    const p2Story1 = await db.story.create({
      title: "Build reporting dashboard",
      description: "Aggregate metrics into a single dashboard view.",
      priority: "High",
      estimate: 8,
      projectId: project2.id,
      sprintId: p2Sprint.id,
      stateId: p2StateDoing.id,
      typeId: p2TypeFeature.id,
      repositoryId: null,
      reporterId: user.id,
      assigneeId: erin.id,
      reviewerId: bob.id,
    });
    const p2Story2 = await db.story.create({
      title: "Fix CSV export encoding",
      description: "Exports mangle UTF-8 characters in some locales.",
      priority: "Medium",
      estimate: 3,
      projectId: project2.id,
      sprintId: p2Sprint.id,
      stateId: p2StateTodo.id,
      typeId: p2TypeBug.id,
      repositoryId: null,
      reporterId: bob.id,
      assigneeId: null,
      reviewerId: null,
    });

    const p2Ac1 = await db.acceptanceCriteria.create({
      title: "Dashboard loads under 2s",
      description: "Initial dashboard render completes within 2 seconds.",
      status: "Pending",
      storyId: p2Story1.id,
    });
    const p2AcComment = await db.comment.create({
      content: "Currently ~4s with real data — need to add caching.",
      acceptanceCriteriaId: p2Ac1.id,
      userId: erin.id,
    });
    const p2StoryComment = await db.comment.create({
      content: "Blocked on the metrics rollup job landing first.",
      storyId: p2Story1.id,
      userId: user.id,
    });

    // -------------------------------------------------------------------------
    // Project 3: Beacon (Test User is NOT a member)
    // -------------------------------------------------------------------------
    const project3 = await db.project.create({
      title: "Beacon",
      description: "Customer-facing notifications service.",
      deadline: days(45),
    });
    const member3Bob = await db.projectMember.create({
      isManager: true,
      userId: bob.id,
      projectId: project3.id,
    });
    const member3Carol = await db.projectMember.create({
      isManager: false,
      userId: carol.id,
      projectId: project3.id,
    });
    const member3Grace = await db.projectMember.create({
      isManager: false,
      userId: grace.id,
      projectId: project3.id,
    });
    const member3Isaiah = await db.projectMember.create({
      isManager: false,
      userId: isaiah.id,
      projectId: project3.id,
    });

    const p3StateBacklog = await db.storyState.create({
      name: "Backlog",
      type: "unstarted",
      order: 1,
      projectId: project3.id,
    });
    const p3StateDone = await db.storyState.create({
      name: "Shipped",
      type: "finished",
      order: 2,
      projectId: project3.id,
    });
    const p3Type = await db.storyType.create({
      name: "Feature",
      projectId: project3.id,
    });
    const p3Story = await db.story.create({
      title: "SMS delivery provider integration",
      description: "Integrate a third-party SMS gateway for notifications.",
      priority: "High",
      estimate: 5,
      projectId: project3.id,
      sprintId: null,
      stateId: p3StateBacklog.id,
      typeId: p3Type.id,
      repositoryId: null,
      reporterId: bob.id,
      assigneeId: carol.id,
      reviewerId: grace.id,
    });
    const p3Ac = await db.acceptanceCriteria.create({
      title: "Failed sends are retried",
      description: "A failed SMS is retried up to 3 times with backoff.",
      status: "Pending",
      storyId: p3Story.id,
    });
    const p3AcComment = await db.comment.create({
      content: "Provider webhook only reports final status, not each retry.",
      acceptanceCriteriaId: p3Ac.id,
      userId: grace.id,
    });

    console.log("Nimble seed data created:", {
      userIds: [
        user.id,
        bob.id,
        carol.id,
        dave.id,
        erin.id,
        frank.id,
        grace.id,
        isaiah.id,
      ],
      projectIds: [project.id, project2.id, project3.id],
      repositoryIds: [repository.id, repositoryFrontend.id],
      storyStateIds: [
        stateBacklog.id,
        stateReady.id,
        stateInProgress.id,
        stateReview.id,
        stateDone.id,
      ],
      storyTypeIds: [
        typeFeature.id,
        typeBug.id,
        typeChore.id,
        typeSpike.id,
      ],
      sprintIds: [sprint0.id, sprint.id, sprint2.id],
      storyIds: [
        storyLogin.id,
        storyBug.id,
        storyChore.id,
        storyDone.id,
        storyPassword.id,
        storyBoard.id,
        storyNotifications.id,
        storySpike.id,
        storyDarkMode.id,
      ],
      relationIds: [
        relationBlocks.id,
        relationRelates.id,
        relationParent.id,
        relationDuplicates.id,
      ],
      acceptanceCriteriaIds: [
        acLoginSuccess.id,
        acLoginFailure.id,
        acLoginLockout.id,
        acBugFixed.id,
        acPasswordEmail.id,
        acPasswordExpiry.id,
        acBoardDrag.id,
        acBoardOrder.id,
        acModelsMigrate.id,
      ],
      storyCommentIds: [
        commentBob.id,
        commentOwner.id,
        commentCarol.id,
        commentDave.id,
        commentErin.id,
        commentFrank.id,
      ],
      acceptanceCriteriaCommentIds: [
        acCommentGrace.id,
        acCommentCarol.id,
        acCommentBob.id,
        acCommentGrace2.id,
        acCommentErin.id,
        acCommentDave.id,
        acCommentUser.id,
      ],
      activityIds: [
        activityCreated.id,
        activityMoved.id,
        activityAssigned.id,
        activityDone.id,
      ],
    });

    // READ: project with its stories
    const foundProject = await db.project.findByPk(project.id, {
      include: [{ model: db.story, as: "story" }],
    });
    console.log("Found project with stories:", {
      id: foundProject.id,
      title: foundProject.title,
      storyCount: foundProject.story.length,
    });

    // READ: story with its state, type, and people
    const foundStory = await db.story.findByPk(storyLogin.id, {
      include: [
        { model: db.storyState, as: "state" },
        { model: db.storyType, as: "type" },
        { model: db.user, as: "reporter" },
        { model: db.user, as: "assignee" },
        { model: db.user, as: "reviewer" },
        { model: db.acceptanceCriteria, as: "acceptanceCriteria" },
        { model: db.comment, as: "comment" },
      ],
    });
    console.log("Found story with associations:", {
      id: foundStory.id,
      title: foundStory.title,
      state: foundStory.state.name,
      type: foundStory.type.name,
      reporter: foundStory.reporter ? foundStory.reporter.email : null,
      assignee: foundStory.assignee ? foundStory.assignee.email : null,
      reviewer: foundStory.reviewer ? foundStory.reviewer.email : null,
      acceptanceCriteriaCount: foundStory.acceptanceCriteria.length,
      commentCount: foundStory.comment.length,
    });

    // READ: acceptance criterion with its comments
    const foundAc = await db.acceptanceCriteria.findByPk(acLoginFailure.id, {
      include: [{ model: db.comment, as: "comment" }],
    });
    console.log("Found acceptance criterion with comments:", {
      id: foundAc.id,
      title: foundAc.title,
      status: foundAc.status,
      commentCount: foundAc.comment.length,
    });

    // READ: sprint with its retrospective and standups
    const foundSprint = await db.sprint.findByPk(sprint.id, {
      include: [
        { model: db.retrospective, as: "retrospective" },
        { model: db.standup, as: "standup" },
      ],
    });
    console.log("Found sprint with retrospective and standups:", {
      id: foundSprint.id,
      name: foundSprint.name,
      hasRetrospective: !!foundSprint.retrospective,
      standupCount: foundSprint.standup.length,
    });

    // UPDATE: move a story to a new state
    await db.story.update(
      { stateId: stateDone.id },
      { where: { id: storyChore.id } },
    );
    const updatedStory = await db.story.findByPk(storyChore.id);
    console.log("Updated story stateId:", {
      id: updatedStory.id,
      stateId: updatedStory.stateId,
      matchesDone: updatedStory.stateId === stateDone.id,
    });

    // DELETE: remove an acceptance criterion (cascades to its comments)
    await db.acceptanceCriteria.destroy({ where: { id: acBugFixed.id } });
    const deletedAc = await db.acceptanceCriteria.findByPk(acBugFixed.id);
    console.log("Deleted acceptance criterion exists?", !!deletedAc);

    console.log("Nimble domain: init + CRUD verification complete.");

    console.log("Init + CRUD verification complete.");
    process.exit(0);
  } catch (error) {
    console.error("Init/verify failed:", error);
    process.exit(1);
  }
};

run();
