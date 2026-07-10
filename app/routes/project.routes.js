module.exports = (app) => {
  const Project = require("../controllers/project.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Project
  router.get("/projects/", Project.findAll);

  app.use("/nimbleapi", router);
};
