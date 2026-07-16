module.exports = (app) => {
  const Story = require("../controllers/story.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.get("/stories/", Story.findAll);
  router.get(
    "/projects/:projectId/stories/:storyId",
    authenticateRoute,
    Story.findOne,
  );
  router.delete(
    "/projects/:projectId/stories/:storyId",
    authenticateRoute,
    Story.delete,
  );
  router.post("/projects/:id/stories/", authenticateRoute, Story.create);
  router.put(
    "/projects/:projectId/stories/:storyId",
    authenticateRoute,
    Story.update,
  );

  app.use("/nimbleapi", router);
};
