module.exports = (app) => {
  const StoryState = require("../controllers/storyState.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all StoryState
  router.get("/storyStates/", StoryState.findAll);

  app.use("/nimbleapi", router);
};
