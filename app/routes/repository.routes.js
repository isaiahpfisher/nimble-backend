module.exports = (app) => {
  const Repository = require("../controllers/repository.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Repository
  router.get("/repositories/", Repository.findAll);

  app.use("/nimbleapi", router);
};
