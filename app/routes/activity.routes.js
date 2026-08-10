module.exports = (app) => {
  const Activity = require("../controllers/activity.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Activity
  router.get("/activities/", authenticateRoute, Activity.findAll);

  router.get(
    "/projects/:projectId/stories/:storyId/activity/",
    authenticateRoute,
    Activity.findAllForStory,
  );

  app.use("/nimbleapi", router);
};
