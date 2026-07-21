```js
const crypto = require("crypto");

jest.mock("crypto", () => ({
  randomUUID: jest.fn(),
}));

jest.mock("../models", () => ({
  sprint: {
    findAll: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock("../authentication/authentication", () => ({
  authenticate: jest.fn(),
}));

jest.mock("../utils/httpUtils", () => ({
  httpError: jest.fn((message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }),
}));

const db = require("../models");
const Sprint = db.sprint;

const {
  authenticate,
} = require("../authentication/authentication");

const {
  httpError,
} = require("../utils/httpUtils");

const sprintController = require("../controllers/sprint.controller");

describe("Sprint Controller", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      body: {},
      params: {},
    };

    res = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    authenticate.mockResolvedValue({
      userId: 1,
    });
  });

  describe("findAll", () => {
    it("should return all sprints", async () => {
      const sprints = [
        {
          id: 1,
          title: "Sprint 1",
          status: "Planned",
        },
        {
          id: 2,
          title: "Sprint 2",
          status: "Active",
        },
      ];

      Sprint.findAll.mockResolvedValue(sprints);

      await sprintController.findAll(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);
      expect(Sprint.findAll).toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith(sprints);
    });

    it("should return 500 when retrieving sprints fails", async () => {
      Sprint.findAll.mockRejectedValue(
        new Error("Database error")
      );

      await sprintController.findAll(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({
        message: "Database error",
      });
    });
  });

  describe("create", () => {
    it("should create a sprint successfully", async () => {
      req.body = {
        title: "Sprint 1",
        goal: "Complete project setup",
        startDate: "2026-07-20",
        endDate: "2026-07-27",
        status: "Planned",
        projectId: 1,
      };

      const createdSprint = {
        id: 1,
        ...req.body,
        isRecurring: false,
      };

      Sprint.create.mockResolvedValue(createdSprint);

      await sprintController.create(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);

      expect(Sprint.create).toHaveBeenCalledWith({
        title: "Sprint 1",
        goal: "Complete project setup",
        startDate: "2026-07-20",
        endDate: "2026-07-27",
        status: "Planned",
        isRecurring: false,
        projectId: 1,
      });

      expect(res.send).toHaveBeenCalledWith(createdSprint);
    });

    it("should return 400 when required fields are missing", async () => {
      req.body = {
        title: "Sprint 1",
      };

      await sprintController.create(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Missing required fields.",
        400
      );

      expect(res.status).toHaveBeenCalledWith(400);

      expect(res.send).toHaveBeenCalledWith({
        message: "Missing required fields.",
      });

      expect(Sprint.create).not.toHaveBeenCalled();
    });

    it("should return 500 when creating a sprint fails", async () => {
      req.body = {
        title: "Sprint 1",
        startDate: "2026-07-20",
        endDate: "2026-07-27",
        projectId: 1,
      };

      Sprint.create.mockRejectedValue(
        new Error("Database error")
      );

      await sprintController.create(req, res);

      expect(res.status).toHaveBeenCalledWith(500);

      expect(res.send).toHaveBeenCalledWith({
        message: "Database error",
      });
    });
  });

  describe("createRecurring", () => {
    beforeEach(() => {
      crypto.randomUUID.mockReturnValue(
        "test-recurrence-group-id"
      );

      req.body = {
        title: "Weekly Sprint",
        goal: "Complete weekly tasks",
        startDate: "2026-07-20",
        endDate: "2026-07-27",
        recurrencePattern: "Weekly",
        recurrenceCount: 3,
        projectId: 1,
      };
    });

    it("should create recurring sprints successfully", async () => {
      const createdSprints = [
        {
          id: 1,
          title: "Weekly Sprint 1",
        },
        {
          id: 2,
          title: "Weekly Sprint 2",
        },
        {
          id: 3,
          title: "Weekly Sprint 3",
        },
      ];

      Sprint.bulkCreate.mockResolvedValue(createdSprints);

      await sprintController.createRecurring(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);

      expect(crypto.randomUUID).toHaveBeenCalled();

      expect(Sprint.bulkCreate).toHaveBeenCalledTimes(1);

      const sprints = Sprint.bulkCreate.mock.calls[0][0];

      expect(sprints).toHaveLength(3);

      expect(sprints[0].title).toBe("Weekly Sprint 1");
      expect(sprints[1].title).toBe("Weekly Sprint 2");
      expect(sprints[2].title).toBe("Weekly Sprint 3");

      expect(sprints[0].isRecurring).toBe(true);

      expect(sprints[0].recurrencePattern).toBe(
        "Weekly"
      );

      expect(sprints[0].recurrenceGroupId).toBe(
        "test-recurrence-group-id"
      );

      expect(res.send).toHaveBeenCalledWith(
        createdSprints
      );
    });

    it("should return 400 when required fields are missing", async () => {
      req.body = {
        title: "Weekly Sprint",
      };

      await sprintController.createRecurring(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Missing required fields.",
        400
      );

      expect(res.status).toHaveBeenCalledWith(400);

      expect(Sprint.bulkCreate).not.toHaveBeenCalled();
    });

    it("should return 400 when recurrence count is less than 2", async () => {
      req.body.recurrenceCount = 1;

      await sprintController.createRecurring(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Recurrence Count must be at least 2!",
        400
      );

      expect(res.status).toHaveBeenCalledWith(400);

      expect(res.send).toHaveBeenCalledWith({
        message: "Recurrence Count must be at least 2!",
      });

      expect(Sprint.bulkCreate).not.toHaveBeenCalled();
    });

    it("should return 400 for an invalid recurrence pattern", async () => {
      req.body.recurrencePattern = "Daily";

      await sprintController.createRecurring(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Unknown recurrence pattern: Daily",
        400
      );

      expect(res.status).toHaveBeenCalledWith(400);

      expect(res.send).toHaveBeenCalledWith({
        message: "Unknown recurrence pattern: Daily",
      });

      expect(Sprint.bulkCreate).not.toHaveBeenCalled();
    });

    it("should create biweekly recurring sprints", async () => {
      req.body.recurrencePattern = "Biweekly";
      req.body.recurrenceCount = 2;

      Sprint.bulkCreate.mockResolvedValue([
        {
          id: 1,
          title: "Biweekly Sprint 1",
        },
        {
          id: 2,
          title: "Biweekly Sprint 2",
        },
      ]);

      await sprintController.createRecurring(req, res);

      const sprints = Sprint.bulkCreate.mock.calls[0][0];

      expect(sprints).toHaveLength(2);

      expect(sprints[0].title).toBe(
        "Weekly Sprint 1"
      );

      expect(sprints[1].title).toBe(
        "Weekly Sprint 2"
      );

      expect(res.send).toHaveBeenCalled();
    });

    it("should create monthly recurring sprints", async () => {
      req.body.recurrencePattern = "Monthly";
      req.body.recurrenceCount = 2;

      Sprint.bulkCreate.mockResolvedValue([
        {
          id: 1,
          title: "Weekly Sprint 1",
        },
        {
          id: 2,
          title: "Weekly Sprint 2",
        },
      ]);

      await sprintController.createRecurring(req, res);

      const sprints = Sprint.bulkCreate.mock.calls[0][0];

      expect(sprints).toHaveLength(2);

      expect(
        sprints[0].recurrencePattern
      ).toBe("Monthly");

      expect(
        sprints[1].recurrencePattern
      ).toBe("Monthly");

      expect(res.send).toHaveBeenCalled();
    });
  });

  describe("findAllForProject", () => {
    it("should return all sprints for a project", async () => {
      req.params.projectId = 1;

      const sprints = [
        {
          id: 1,
          title: "Sprint 1",
          projectId: 1,
        },
        {
          id: 2,
          title: "Sprint 2",
          projectId: 1,
        },
      ];

      Sprint.findAll.mockResolvedValue(sprints);

      await sprintController.findAllForProject(
        req,
        res
      );

      expect(authenticate).toHaveBeenCalledWith(req, res);

      expect(Sprint.findAll).toHaveBeenCalledWith({
        where: {
          projectId: 1,
        },
        order: [["startDate", "ASC"]],
      });

      expect(res.send).toHaveBeenCalledWith(sprints);
    });

    it("should return 500 when retrieving project sprints fails", async () => {
      req.params.projectId = 1;

      Sprint.findAll.mockRejectedValue(
        new Error("Database error")
      );

      await sprintController.findAllForProject(
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(500);

      expect(res.send).toHaveBeenCalledWith({
        message: "Database error",
      });
    });
  });

  describe("findOne", () => {
    it("should return a sprint when found", async () => {
      req.params.id = 1;

      const sprint = {
        id: 1,
        title: "Sprint 1",
      };

      Sprint.findByPk.mockResolvedValue(sprint);

      await sprintController.findOne(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);

      expect(Sprint.findByPk).toHaveBeenCalledWith(1);

      expect(res.send).toHaveBeenCalledWith(sprint);
    });

    it("should return 404 when sprint is not found", async () => {
      req.params.id = 999;

      Sprint.findByPk.mockResolvedValue(null);

      await sprintController.findOne(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Cannot find Sprint with id = 999.",
        404
      );

      expect(res.status).toHaveBeenCalledWith(404);

      expect(res.send).toHaveBeenCalledWith({
        message:
          "Cannot find Sprint with id = 999.",
      });
    });
  });

  describe("update", () => {
    it("should update a sprint successfully", async () => {
      req.params.id = 1;

      req.body = {
        title: "Updated Sprint",
        status: "Active",
      };

      const sprint = {
        id: 1,
        title: "Sprint 1",
        status: "Planned",
        update: jest.fn().mockResolvedValue(true),
      };

      Sprint.findByPk.mockResolvedValue(sprint);

      await sprintController.update(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);

      expect(Sprint.findByPk).toHaveBeenCalledWith(1);

      expect(sprint.update).toHaveBeenCalledWith({
        title: "Updated Sprint",
        status: "Active",
      });

      expect(res.send).toHaveBeenCalledWith(sprint);
    });

    it("should return 404 when sprint does not exist", async () => {
      req.params.id = 999;

      Sprint.findByPk.mockResolvedValue(null);

      await sprintController.update(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Cannot find Sprint with id = 999.",
        404
      );

      expect(res.status).toHaveBeenCalledWith(404);

      expect(res.send).toHaveBeenCalledWith({
        message:
          "Cannot find Sprint with id = 999.",
      });
    });

    it("should return 500 when update fails", async () => {
      req.params.id = 1;

      const sprint = {
        id: 1,
        update: jest
          .fn()
          .mockRejectedValue(
            new Error("Update failed")
          ),
      };

      Sprint.findByPk.mockResolvedValue(sprint);

      await sprintController.update(req, res);

      expect(res.status).toHaveBeenCalledWith(500);

      expect(res.send).toHaveBeenCalledWith({
        message: "Update failed",
      });
    });
  });

  describe("delete", () => {
    it("should delete a sprint successfully", async () => {
      req.params.id = 1;

      const sprint = {
        id: 1,
        title: "Sprint 1",
        destroy: jest.fn().mockResolvedValue(true),
      };

      Sprint.findByPk.mockResolvedValue(sprint);

      await sprintController.delete(req, res);

      expect(authenticate).toHaveBeenCalledWith(req, res);

      expect(Sprint.findByPk).toHaveBeenCalledWith(1);

      expect(sprint.destroy).toHaveBeenCalled();

      expect(res.send).toHaveBeenCalledWith({
        message: "Sprint deleted successfully!",
      });
    });

    it("should return 404 when sprint does not exist", async () => {
      req.params.id = 999;

      Sprint.findByPk.mockResolvedValue(null);

      await sprintController.delete(req, res);

      expect(httpError).toHaveBeenCalledWith(
        "Cannot find Sprint with id = 999.",
        404
      );

      expect(res.status).toHaveBeenCalledWith(404);

      expect(res.send).toHaveBeenCalledWith({
        message:
          "Cannot find Sprint with id = 999.",
      });
    });

    it("should return 500 when delete fails", async () => {
      req.params.id = 1;

      const sprint = {
        id: 1,
        destroy: jest
          .fn()
          .mockRejectedValue(
            new Error("Delete failed")
          ),
      };

      Sprint.findByPk.mockResolvedValue(sprint);

      await sprintController.delete(req, res);

      expect(res.status).toHaveBeenCalledWith(500);

      expect(res.send).toHaveBeenCalledWith({
        message: "Delete failed",
      });
    });
  });
});
```
