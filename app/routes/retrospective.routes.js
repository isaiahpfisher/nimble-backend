module.exports = (app) => {
  const Retrospective = require("../controllers/retrospective.controller.js");

  const { authenticateRoute } = require("../authentication/authentication");

  const router = require("express").Router();

  // Get all retrospectives for a sprint
  router.get(
    "/projects/:projectId/sprints/:sprintId/retrospectives",
    authenticateRoute,
    Retrospective.findAllForSprint
  );

  // Get one retrospective
  router.get(
    "/retrospectives/:id",
    authenticateRoute,
    Retrospective.findOne
  );

  // Create retrospective
  router.post(
    "/retrospectives",
    authenticateRoute,
    Retrospective.create
  );

  // Update retrospective
  router.put(
    "/retrospectives/:id",
    authenticateRoute,
    Retrospective.update
  );

  // Delete retrospective
  router.delete(
    "/retrospectives/:id",
    authenticateRoute,
    Retrospective.delete
  );

  app.use("/nimbleapi", router);
};