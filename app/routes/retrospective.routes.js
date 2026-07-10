module.exports = (app) => {
  const Retrospective = require("../controllers/retrospective.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Retrospective
  router.get("/retrospectives/", Retrospective.findAll);

  app.use("/nimbleapi", router);
};
