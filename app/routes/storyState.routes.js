module.exports = (app) => {
  const StoryState = require("../controllers/storyState.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.get("/storyStates/", [authenticateRoute], StoryState.findAll);

  router.get(
    "/projects/:projectId/storyStates/",
    [authenticateRoute],
    StoryState.findAllForProject,
  );

  router.post(
    "/projects/:projectId/storyStates/",
    [authenticateRoute],
    StoryState.create,
  );

  router.put(
    "/projects/:projectId/storyStates/reorder",
    [authenticateRoute],
    StoryState.reorder,
  );

  router.put(
    "/projects/:projectId/storyStates/:stateId",
    [authenticateRoute],
    StoryState.update,
  );

  router.delete(
    "/projects/:projectId/storyStates/:stateId",
    [authenticateRoute],
    StoryState.delete,
  );

  app.use("/nimbleapi", router);
};
