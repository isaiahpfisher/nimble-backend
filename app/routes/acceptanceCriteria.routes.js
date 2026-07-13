module.exports = (app) => {
  const AcceptanceCriteria = require("../controllers/acceptanceCriteria.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all AcceptanceCriteria
  router.get("/acceptanceCriteria/", AcceptanceCriteria.findAll);

  app.use("/nimbleapi", router);
};
