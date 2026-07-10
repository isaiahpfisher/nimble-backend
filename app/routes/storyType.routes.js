module.exports = (app) => {
  const StoryType = require("../controllers/storyType.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all StoryType
  router.get("/storyTypes/", StoryType.findAll);

  app.use("/nimbleapi", router);
};
