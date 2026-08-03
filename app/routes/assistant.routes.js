module.exports = (app) => {
  const Assistant = require("../controllers/assistant.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.post("/assistant/chat", authenticateRoute, Assistant.chat);
  router.post("/assistant/tool/:name", authenticateRoute, Assistant.tool);
  router.post("/assistant/generate/:kind", authenticateRoute, Assistant.generate);

  app.use("/nimbleapi", router);
};
