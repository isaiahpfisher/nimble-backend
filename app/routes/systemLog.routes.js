module.exports = (app) => {
  const systemLog = require("../controllers/systemLog.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");

  const router = require("express").Router();

  router.get(
  "/systemlogs",
  (req, res, next) => {
    console.log("System log route reached");
    next();
  },
  authenticateRoute,
  systemLog.findAll
);

  app.use("/nimbleapi", router);
};