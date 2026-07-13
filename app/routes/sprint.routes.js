module.exports = (app) => {
  const Sprint = require("../controllers/sprint.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Sprint
  router.get("/sprints/", Sprint.findAll);

  app.use("/nimbleapi", router);
};
