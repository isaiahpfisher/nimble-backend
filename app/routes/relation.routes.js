module.exports = (app) => {
  const Relation = require("../controllers/relation.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Relation
  router.get("/relations/", Relation.findAll);

  app.use("/nimbleapi", router);
};
