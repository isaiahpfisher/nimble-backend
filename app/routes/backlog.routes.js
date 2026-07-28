module.exports = (app) => {
  const Backlog = require("../controllers/backlog.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.get(
    "/projects/:id/backlog",
    authenticateRoute,
    Backlog.findAllForProject,
  );

  router.put(
    "/projects/:id/backlog/:storyId/sprint",
    authenticateRoute,
    Backlog.assignSprint,
  );

  app.use("/nimbleapi", router);
};