// Reading a project: the list of them, and one project's setup.
//
// State, type, sprint and member ids are defined per project, so they differ in
// every one. get_project is where the model learns the ids it is about to use;
// nothing downstream lets it guess.

const { z } = require("zod");
const { listChoices } = require("../rules");
const { fullName, isProjectManager, projectSummary, sprintSummary } = require("../shape");

const num = (description) => z.number().int().describe(description);

module.exports = [
  {
    name: "list_my_projects",
    title: "List my projects",
    description:
      "Every project the current user belongs to, with id, title and url. Call this first whenever the " +
      "user names a project in words rather than by id, so you can resolve it to a project id.",
    input: z.object({}),
    async run(_args, { api }) {
      const projects = await api("/users/me/projects");
      return projects.map(projectSummary);
    },
  },

  {
    name: "get_people",
    title: "Who is on my projects, and who manages them",
    description:
      'Who the people on a project are and which of them manage it. This is the tool for "who is my ' +
      'manager", "who runs this project", "who is on this team", "who else is on Atlas" and for looking ' +
      "up a teammate's name or email.\n\n" +
      "It covers every project the current user belongs to unless you name one, so it answers \"who is " +
      'my manager" in a single call — do not assemble that from list_my_projects and get_project. ' +
      "`managers` is the roll-up: each manager once, with the projects they manage under `manages`. A " +
      "person flagged `isYou` is the user you are talking to, so do not report them as their own " +
      "manager — say they manage it themselves.\n\n" +
      "Managing a project is a permission, not a job title: a project can have several managers, or " +
      "none at all, and an empty `managers` list means nobody has been given it rather than that you " +
      "failed to find them. This is about who people are; get_team_workload is about what they are " +
      "working on.",
    input: z.object({
      projectId: num("Only this project. Omit to cover every project the user belongs to.").optional(),
    }),
    async run({ projectId }, { api, userId }) {
      const mine = await api("/users/me/projects");
      const wanted = projectId === undefined ? mine : mine.filter((row) => Number(row.id) === projectId);

      if (!wanted.length) {
        throw new Error(
          projectId === undefined
            ? "You do not belong to any project yet."
            : `You are not a member of project ${projectId}, so its people are not visible to you. ` +
              `Your projects are: ${listChoices(mine, "title")}.`,
        );
      }

      const projects = (
        await Promise.all(
          wanted.map(async (row) => {
            try {
              const project = await api(`/projects/${row.id}`);

              return {
                id: project.id,
                title: project.title,
                url: `/projects/${project.id}`,
                people: (project.projectMembers ?? []).map((member) => ({
                  userId: member.userId,
                  name: fullName(member.user),
                  email: member.user?.email ?? null,
                  isManager: isProjectManager(member),
                  isYou: userId != null && Number(member.userId) === Number(userId),
                })),
              };
            } catch (err) {
              // one unreadable project should not sink the whole answer
              console.error(`[assistant] get_people skipped project ${row.id}: ${err.message}`);
              return null;
            }
          }),
        )
      ).filter(Boolean);

      // each manager once, carrying the projects they manage, so "who is my
      // manager" is one list rather than a per-project table to be merged
      const managers = new Map();
      for (const project of projects) {
        for (const person of project.people) {
          if (!person.isManager) continue;

          const seen = managers.get(person.userId) ?? { ...person, manages: [] };
          seen.manages.push(project.title);
          managers.set(person.userId, seen);
        }
      }

      return {
        managers: [...managers.values()].map(({ isManager, ...manager }) => manager),
        projects,
      };
    },
  },

  {
    name: "get_project",
    title: "Get a project",
    description:
      "A project's setup: workflow states, story types, members, repositories and sprints. Call this " +
      "before filtering or changing stories — it is where you learn which state, type, sprint and user " +
      "ids a project actually has. Those are per-project and can never be guessed.",
    input: z.object({ projectId: num("Id of the project to fetch.") }),
    async run({ projectId }, { api }) {
      const project = await api(`/projects/${projectId}`);

      return {
        ...projectSummary(project),
        workflow: {
          completedStateId: project.completedStateId ?? null,
          branchCreationStateId: project.branchCreationStateId ?? null,
          prReviewStateId: project.prReviewStateId ?? null,
        },
        states: (project.storyState ?? [])
          .map((s) => ({ id: s.id, name: s.name, order: s.order }))
          .sort((a, b) => a.order - b.order),
        types: (project.storyType ?? []).map((t) => ({ id: t.id, name: t.name })),
        members: (project.projectMembers ?? []).map((m) => ({
          userId: m.userId,
          name: fullName(m.user),
          email: m.user?.email ?? null,
          isManager: isProjectManager(m),
        })),
        repositories: (project.repository ?? []).map((r) => ({ id: r.id, name: r.name })),
        sprints: (project.sprint ?? []).map((s) => sprintSummary(s, project.id)),
      };
    },
  },
];
