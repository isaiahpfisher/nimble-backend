const { DataTypes } = require("sequelize");
const express = require("express");
const request = require("supertest");

jest.mock("../../app/models", () => ({
  sprint: {
    findAll: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock("../../app/authentication/authentication", () => ({
  authenticate: jest.fn(),
  authenticateRoute: jest.fn((req, res, next) => next()),
}));

const db = require("../../app/models");
const { authenticate, authenticateRoute } = require("../../app/authentication/authentication");
const Sprint = db.sprint;
const controller = require("../../app/controllers/sprint.controller.js");
const SprintModel = require("../../app/models/sprint.model.js");
const sprintRoutes = require("../../app/routes/sprint.routes.js");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe("Sprint controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticate.mockResolvedValue(undefined);
  });

  describe("findAll", () => {
    test("returns all sprints", async () => {
      const req = {};
      const res = mockRes();
      const sprints = [{ id: 1 }, { id: 2 }];
      Sprint.findAll.mockResolvedValue(sprints);

      await controller.findAll(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);
      expect(Sprint.findAll).toHaveBeenCalledWith();
      expect(res.send).toHaveBeenCalledWith(sprints);
    });

    test("returns 500 when the query fails", async () => {
      const req = {};
      const res = mockRes();
      Sprint.findAll.mockRejectedValue(new Error("db down"));

      await controller.findAll(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "db down" });
    });
  });

  describe("create", () => {
    test("creates a sprint with defaults", async () => {
      const req = {
        body: {
          title: "Sprint 1",
          startDate: "2026-01-01",
          endDate: "2026-01-14",
          projectId: 5,
        },
      };
      const res = mockRes();
      const created = { id: 1, ...req.body };
      Sprint.create.mockResolvedValue(created);

      await controller.create(req, res);

      expect(Sprint.create).toHaveBeenCalledWith({
        title: "Sprint 1",
        goal: undefined,
        startDate: "2026-01-01",
        endDate: "2026-01-14",
        status: "Planned",
        isRecurring: false,
        projectId: 5,
      });
      expect(res.send).toHaveBeenCalledWith(created);
    });

    test("uses the provided status when given", async () => {
      const req = {
        body: {
          title: "Sprint 1",
          startDate: "2026-01-01",
          endDate: "2026-01-14",
          projectId: 5,
          status: "Active",
        },
      };
      const res = mockRes();
      Sprint.create.mockResolvedValue({});

      await controller.create(req, res);

      expect(Sprint.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: "Active" })
      );
    });

    test.each(["title", "startDate", "endDate", "projectId"])(
      "returns 400 when %s is missing",
      async (field) => {
        const req = {
          body: {
            title: "Sprint 1",
            startDate: "2026-01-01",
            endDate: "2026-01-14",
            projectId: 5,
          },
        };
        delete req.body[field];
        const res = mockRes();

        await controller.create(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
        expect(Sprint.create).not.toHaveBeenCalled();
      }
    );

    test("returns 500 when creation fails", async () => {
      const req = {
        body: {
          title: "Sprint 1",
          startDate: "2026-01-01",
          endDate: "2026-01-14",
          projectId: 5,
        },
      };
      const res = mockRes();
      Sprint.create.mockRejectedValue(new Error("insert failed"));

      await controller.create(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "insert failed" });
    });
  });

  describe("createRecurring", () => {
    const baseBody = {
      title: "Sprint",
      goal: "Ship feature",
      startDate: "2026-01-01",
      endDate: "2026-01-14",
      projectId: 5,
      recurrencePattern: "Weekly",
      recurrenceCount: 3,
    };

    test("creates the requested number of sprints spaced by the recurrence pattern", async () => {
      const req = { body: { ...baseBody } };
      const res = mockRes();
      Sprint.bulkCreate.mockResolvedValue([{}, {}, {}]);

      await controller.createRecurring(req, res);

      expect(Sprint.bulkCreate).toHaveBeenCalledTimes(1);
      const created = Sprint.bulkCreate.mock.calls[0][0];
      expect(created).toHaveLength(3);
      expect(created[0].title).toBe("Sprint 1");
      expect(created[1].title).toBe("Sprint 2");
      expect(created[2].title).toBe("Sprint 3");
      created.forEach((sprint) => {
        expect(sprint.isRecurring).toBe(true);
        expect(sprint.recurrencePattern).toBe("Weekly");
        expect(sprint.recurrenceGroupId).toBe(created[0].recurrenceGroupId);
      });
      expect(
        new Date(created[1].startDate).getTime() - new Date(created[0].startDate).getTime()
      ).toBe(7 * 24 * 60 * 60 * 1000);
    });

    test.each([
      ["title"],
      ["startDate"],
      ["endDate"],
      ["projectId"],
      ["recurrencePattern"],
      ["recurrenceCount"],
    ])("returns 400 when %s is missing", async (field) => {
      const req = { body: { ...baseBody } };
      delete req.body[field];
      const res = mockRes();

      await controller.createRecurring(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith({ message: "Missing required fields." });
    });

    test("returns 400 when recurrenceCount is below 2", async () => {
      const req = { body: { ...baseBody, recurrenceCount: 1 } };
      const res = mockRes();

      await controller.createRecurring(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith({ message: "Recurrence Count must be at least 2!" });
    });

    test("returns 400 for an unknown recurrence pattern", async () => {
      const req = { body: { ...baseBody, recurrencePattern: "Daily" } };
      const res = mockRes();

      await controller.createRecurring(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith({ message: "Unknown recurrence pattern: Daily" });
    });

    test("returns 500 when bulk creation fails", async () => {
      const req = { body: { ...baseBody } };
      const res = mockRes();
      Sprint.bulkCreate.mockRejectedValue(new Error("bulk insert failed"));

      await controller.createRecurring(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "bulk insert failed" });
    });
  });

  describe("findAllForProject", () => {
    test("returns sprints for the given project ordered by start date", async () => {
      const req = { params: { projectId: "5" } };
      const res = mockRes();
      const sprints = [{ id: 1 }];
      Sprint.findAll.mockResolvedValue(sprints);

      await controller.findAllForProject(req, res);

      expect(Sprint.findAll).toHaveBeenCalledWith({
        where: { projectId: "5" },
        order: [["startDate", "ASC"]],
      });
      expect(res.send).toHaveBeenCalledWith(sprints);
    });

    test("returns 500 on query failure", async () => {
      const req = { params: { projectId: "5" } };
      const res = mockRes();
      Sprint.findAll.mockRejectedValue(new Error("query failed"));

      await controller.findAllForProject(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "query failed" });
    });
  });

  describe("findOne", () => {
    test("returns the sprint when found", async () => {
      const req = { params: { id: "1" } };
      const res = mockRes();
      const sprint = { id: 1 };
      Sprint.findByPk.mockResolvedValue(sprint);

      await controller.findOne(req, res);

      expect(Sprint.findByPk).toHaveBeenCalledWith("1");
      expect(res.send).toHaveBeenCalledWith(sprint);
    });

    test("returns 404 when not found", async () => {
      const req = { params: { id: "99" } };
      const res = mockRes();
      Sprint.findByPk.mockResolvedValue(null);

      await controller.findOne(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({ message: "Cannot find Sprint with id = 99." });
    });

    test("returns 500 on query failure", async () => {
      const req = { params: { id: "1" } };
      const res = mockRes();
      Sprint.findByPk.mockRejectedValue(new Error("query failed"));

      await controller.findOne(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "query failed" });
    });
  });

  describe("update", () => {
    test("updates and returns the sprint", async () => {
      const req = { params: { id: "1" }, body: { title: "Updated" } };
      const res = mockRes();
      const sprint = { id: 1, update: jest.fn().mockResolvedValue(undefined) };
      Sprint.findByPk.mockResolvedValue(sprint);

      await controller.update(req, res);

      expect(sprint.update).toHaveBeenCalledWith(req.body);
      expect(res.send).toHaveBeenCalledWith(sprint);
    });

    test("returns 404 when the sprint does not exist", async () => {
      const req = { params: { id: "99" }, body: {} };
      const res = mockRes();
      Sprint.findByPk.mockResolvedValue(null);

      await controller.update(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({ message: "Cannot find Sprint with id = 99." });
    });

    test("returns 500 when the update fails", async () => {
      const req = { params: { id: "1" }, body: {} };
      const res = mockRes();
      const sprint = { update: jest.fn().mockRejectedValue(new Error("update failed")) };
      Sprint.findByPk.mockResolvedValue(sprint);

      await controller.update(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "update failed" });
    });
  });

  describe("delete", () => {
    test("deletes the sprint", async () => {
      const req = { params: { id: "1" } };
      const res = mockRes();
      const sprint = { destroy: jest.fn().mockResolvedValue(undefined) };
      Sprint.findByPk.mockResolvedValue(sprint);

      await controller.delete(req, res);

      expect(sprint.destroy).toHaveBeenCalledWith();
      expect(res.send).toHaveBeenCalledWith({ message: "Sprint deleted successfully!" });
    });

    test("returns 404 when the sprint does not exist", async () => {
      const req = { params: { id: "99" } };
      const res = mockRes();
      Sprint.findByPk.mockResolvedValue(null);

      await controller.delete(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({ message: "Cannot find Sprint with id = 99." });
    });

    test("returns 500 when deletion fails", async () => {
      const req = { params: { id: "1" } };
      const res = mockRes();
      const sprint = { destroy: jest.fn().mockRejectedValue(new Error("delete failed")) };
      Sprint.findByPk.mockResolvedValue(sprint);

      await controller.delete(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({ message: "delete failed" });
    });
  });
});

describe("Sprint model", () => {
  let defineMock;
  let sequelizeMock;
  let capturedName;
  let capturedAttributes;

  beforeEach(() => {
    capturedName = undefined;
    capturedAttributes = undefined;
    defineMock = jest.fn((name, attributes) => {
      capturedName = name;
      capturedAttributes = attributes;
      return { name, attributes };
    });
    sequelizeMock = { define: defineMock };
  });

  test("defines the sprint model with correct name", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(defineMock).toHaveBeenCalledTimes(1);
    expect(capturedName).toBe("sprint");
  });

  test("title is an optional string", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.title.type).toBe(DataTypes.STRING);
    expect(capturedAttributes.title.allowNull).toBe(true);
  });

  test("goal is an optional string", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.goal.type).toBe(DataTypes.STRING);
    expect(capturedAttributes.goal.allowNull).toBe(true);
  });

  test("startDate is a required DATEONLY", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.startDate.type).toBe(DataTypes.DATEONLY);
    expect(capturedAttributes.startDate.allowNull).toBe(false);
  });

  test("endDate is a required DATEONLY", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.endDate.type).toBe(DataTypes.DATEONLY);
    expect(capturedAttributes.endDate.allowNull).toBe(false);
  });

  test("status is an enum defaulting to Planned", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.status.type.values).toEqual(["Planned", "Active", "Completed"]);
    expect(capturedAttributes.status.allowNull).toBe(false);
    expect(capturedAttributes.status.defaultValue).toBe("Planned");
  });

  test("isRecurring is a required boolean defaulting to false", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.isRecurring.type).toBe(DataTypes.BOOLEAN);
    expect(capturedAttributes.isRecurring.allowNull).toBe(false);
    expect(capturedAttributes.isRecurring.defaultValue).toBe(false);
  });

  test("recurrencePattern is an optional enum", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.recurrencePattern.type.values).toEqual(["Weekly", "Biweekly", "Monthly"]);
    expect(capturedAttributes.recurrencePattern.allowNull).toBe(true);
  });

  test("recurrenceGroupId is an optional string", () => {
    SprintModel(sequelizeMock, DataTypes);
    expect(capturedAttributes.recurrenceGroupId.type).toBe(DataTypes.STRING);
    expect(capturedAttributes.recurrenceGroupId.allowNull).toBe(true);
  });

  test("returns the defined model", () => {
    const result = SprintModel(sequelizeMock, DataTypes);
    expect(result).toEqual({ name: "sprint", attributes: capturedAttributes });
  });
});

describe("Sprint routes", () => {
  let app;

  beforeEach(() => {
    jest.spyOn(controller, "create").mockImplementation((req, res) => res.status(201).send({ handler: "create" }));
    jest.spyOn(controller, "createRecurring").mockImplementation((req, res) => res.status(201).send({ handler: "createRecurring" }));
    jest.spyOn(controller, "findAllForProject").mockImplementation((req, res) => res.send({ handler: "findAllForProject" }));
    jest.spyOn(controller, "findOne").mockImplementation((req, res) => res.send({ handler: "findOne" }));
    jest.spyOn(controller, "update").mockImplementation((req, res) => res.send({ handler: "update" }));
    jest.spyOn(controller, "delete").mockImplementation((req, res) => res.send({ handler: "delete" }));
    authenticateRoute.mockImplementation((req, res, next) => next());

    app = express();
    app.use(express.json());
    sprintRoutes(app);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("POST /nimbleapi/sprints/ calls authenticateRoute then Sprint.create", async () => {
    const res = await request(app).post("/nimbleapi/sprints/").send({ title: "Sprint 1" });

    expect(authenticateRoute).toHaveBeenCalled();
    expect(controller.create).toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ handler: "create" });
  });

  test("POST /nimbleapi/sprints/recurring calls Sprint.createRecurring", async () => {
    const res = await request(app).post("/nimbleapi/sprints/recurring").send({});

    expect(controller.createRecurring).toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  test("GET /nimbleapi/projects/:projectId/sprints calls Sprint.findAllForProject", async () => {
    const res = await request(app).get("/nimbleapi/projects/5/sprints");

    expect(controller.findAllForProject).toHaveBeenCalled();
    expect(res.body).toEqual({ handler: "findAllForProject" });
  });

  test("GET /nimbleapi/sprints/:id calls Sprint.findOne", async () => {
    const res = await request(app).get("/nimbleapi/sprints/1");

    expect(controller.findOne).toHaveBeenCalled();
    expect(res.body).toEqual({ handler: "findOne" });
  });

  test("PUT /nimbleapi/sprints/:id calls Sprint.update", async () => {
    const res = await request(app).put("/nimbleapi/sprints/1").send({ title: "Updated" });

    expect(controller.update).toHaveBeenCalled();
    expect(res.body).toEqual({ handler: "update" });
  });

  test("DELETE /nimbleapi/sprints/:id calls Sprint.delete", async () => {
    const res = await request(app).delete("/nimbleapi/sprints/1");

    expect(controller.delete).toHaveBeenCalled();
    expect(res.body).toEqual({ handler: "delete" });
  });

  test("blocks requests when authenticateRoute rejects them", async () => {
    authenticateRoute.mockImplementation((req, res) => res.status(401).send({ message: "Unauthorized" }));

    const res = await request(app).get("/nimbleapi/sprints/1");

    expect(res.status).toBe(401);
    expect(controller.findOne).not.toHaveBeenCalled();
  });
});