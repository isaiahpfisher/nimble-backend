module.exports = (app) => {
  const ProjectMember = require("../controllers/projectMember.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all ProjectMember
  router.get("/projectMembers/", ProjectMember.findAll);

  app.use("/nimbleapi", router);
};
