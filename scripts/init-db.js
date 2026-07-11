// =============================================================================
// INIT DATABASE
// - AI was used to generate this file
// =============================================================================

require("dotenv").config();

const db = require("../app/models");
const { getSalt, hashPassword } = require("../app/authentication/crypto");

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

    const user = await db.user.create({
      firstName: "Test",
      lastName: "User",
      isAdmin: true,
      email: "test@example.com",
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

    const session = await db.session.create({
      email: user.email,
      userId: user.id,
      expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // --- Project ---
    const project = await db.project.create({
      title: "Nimble",
      description: "Agile project management, reimagined.",
      deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    // --- Project members (Test User is the manager) ---
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

    // --- Repository ---
    const repository = await db.repository.create({
      githubId: "123456789",
      name: "nimble-backend",
      projectId: project.id,
    });

    // --- Story states (type enum: unstarted | started | finished) ---
    const stateBacklog = await db.storyState.create({
      name: "Backlog",
      type: "unstarted",
      order: 1,
      projectId: project.id,
    });
    const stateInProgress = await db.storyState.create({
      name: "In Progress",
      type: "started",
      order: 2,
      projectId: project.id,
    });
    const stateReview = await db.storyState.create({
      name: "In Review",
      type: "started",
      order: 3,
      projectId: project.id,
    });
    const stateDone = await db.storyState.create({
      name: "Done",
      type: "finished",
      order: 4,
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

    // --- Sprint ---
    const sprint = await db.sprint.create({
      name: "Sprint 1",
      start: new Date(),
      end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      projectId: project.id,
    });

    // --- Retrospective (one per sprint) ---
    const retrospective = await db.retrospective.create({
      agenda: "Review Sprint 1 outcomes and blockers.",
      summary: "Velocity on track; CI flakiness slowed reviews.",
      sprintId: sprint.id,
    });

    // --- Standups ---
    const standup1 = await db.standup.create({
      agenda: "Daily sync",
      notes: "Auth flow in progress; DB scaffolding merged.",
      date: new Date(),
      sprintId: sprint.id,
    });
    const standup2 = await db.standup.create({
      agenda: null,
      notes: "Repository integration underway; no blockers.",
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      sprintId: sprint.id,
    });

    // --- Stories (nullable FKs exercised: repository/reporter/assignee/reviewer) ---
    const storyLogin = await db.story.create({
      title: "Implement user login",
      description: "Users can authenticate with email and password.",
      priority: 1,
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
      priority: 2,
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
      priority: 3,
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
      priority: 1,
      estimate: 8,
      projectId: project.id,
      sprintId: sprint.id,
      stateId: stateDone.id,
      typeId: typeFeature.id,
      repositoryId: repository.id,
      reporterId: bob.id,
      assigneeId: bob.id,
      reviewerId: user.id,
    });

    // --- Relations between stories ---
    const relationBlocks = await db.relation.create({
      type: "blocks",
      storyOneId: storyDone.id,
      storyTwoId: storyLogin.id,
    });
    const relationRelates = await db.relation.create({
      type: "relates_to",
      storyOneId: storyLogin.id,
      storyTwoId: storyBug.id,
    });

    // --- Acceptance criteria (status enum: pending | passed | failed) ---
    const acLoginSuccess = await db.acceptanceCriteria.create({
      title: "Valid credentials succeed",
      description: "A user with correct email/password receives a session.",
      status: "passed",
      storyId: storyLogin.id,
    });
    const acLoginFailure = await db.acceptanceCriteria.create({
      title: "Invalid credentials rejected",
      description: "A user with wrong credentials receives a 401.",
      status: "pending",
      storyId: storyLogin.id,
    });
    const acBugFixed = await db.acceptanceCriteria.create({
      title: "Sessions honor configured window",
      description: "Sessions no longer expire early.",
      status: "failed",
      storyId: storyBug.id,
    });

    // --- Comments ---
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

    // --- Activities (changes stored as JSON) ---
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

    console.log("Nimble seed data created:", {
      projectId: project.id,
      memberIds: [memberOwner.id, memberBob.id, memberCarol.id],
      repositoryId: repository.id,
      storyStateIds: [
        stateBacklog.id,
        stateInProgress.id,
        stateReview.id,
        stateDone.id,
      ],
      storyTypeIds: [typeFeature.id, typeBug.id, typeChore.id],
      sprintId: sprint.id,
      retrospectiveId: retrospective.id,
      standupIds: [standup1.id, standup2.id],
      storyIds: [storyLogin.id, storyBug.id, storyChore.id, storyDone.id],
      relationIds: [relationBlocks.id, relationRelates.id],
      acceptanceCriteriaIds: [
        acLoginSuccess.id,
        acLoginFailure.id,
        acBugFixed.id,
      ],
      commentIds: [commentBob.id, commentOwner.id, commentCarol.id],
      activityIds: [activityCreated.id, activityMoved.id],
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

    // DELETE: remove an acceptance criterion
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
