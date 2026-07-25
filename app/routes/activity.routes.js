module.exports = (app) => {
  const Activity = require("../controllers/activity.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Activity
  router.get("/activities/", Activity.findAll);

  router.get("/projects/:projectId/stories/:storyId/activity/", Activity.findAllForStory);

  app.use("/nimbleapi", router);
};
