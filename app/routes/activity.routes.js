module.exports = (app) => {
  const Activity = require("../controllers/activity.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Activity
  router.get("/activities/", Activity.findAll);

  app.use("/nimbleapi", router);
};
