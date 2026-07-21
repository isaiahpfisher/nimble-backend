module.exports = (app) => {
  const Sprint = require("../controllers/sprint.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Create a new Sprint
  router.post("/sprints/", [authenticateRoute], Sprint.create);

  // Create a series of recurring Sprints
  router.post(
    "/sprints/recurring",[authenticateRoute],Sprint.createRecurring);

  // Retrieve all Sprints for a project
  router.get(
    "/projects/:projectId/sprints",[authenticateRoute],Sprint.findAllForProject,);

  // Retrieve a single Sprint with id
  router.get("/sprints/:id", [authenticateRoute], Sprint.findOne);

  // Update a Sprint with id
  router.put("/sprints/:id", [authenticateRoute], Sprint.update);

  // Delete a Sprint with id
  router.delete("/sprints/:id", [authenticateRoute], Sprint.delete);

  app.use("/nimbleapi", router);
};