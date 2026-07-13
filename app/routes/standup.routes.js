module.exports = (app) => {
  const Standup = require("../controllers/standup.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Standup
  router.get("/standups/", Standup.findAll);

  app.use("/nimbleapi", router);
};
