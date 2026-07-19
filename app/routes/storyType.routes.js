module.exports = (app) => {
  const StoryType = require("../controllers/storyType.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.get("/storyTypes/", StoryType.findAll);

  router.get(
    "/projects/:projectId/storyTypes/",
    authenticateRoute,
    StoryType.findAllForProject,
  );

  router.post(
    "/projects/:projectId/storyTypes/",
    authenticateRoute,
    StoryType.create,
  );

  router.put(
    "/projects/:projectId/storyTypes/:typeId",
    authenticateRoute,
    StoryType.update,
  );

  router.delete(
    "/projects/:projectId/storyTypes/:typeId",
    authenticateRoute,
    StoryType.delete,
  );

  app.use("/nimbleapi", router);
};
