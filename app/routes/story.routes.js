module.exports = (app) => {
  const Story = require("../controllers/story.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Story
  router.get("/stories/", Story.findAll);

  app.use("/nimbleapi", router);
};
