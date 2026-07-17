module.exports = (app) => {
  const AcceptanceCriteria = require("../controllers/acceptanceCriteria.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all AcceptanceCriteria
  router.get("/acceptanceCriteria/", AcceptanceCriteria.findAll);

  router.post(
    "/projects/:projectId/stories/:storyId/acceptanceCriteria",
    authenticateRoute,
    AcceptanceCriteria.create,
  );

  router.put(
    "/projects/:projectId/stories/:storyId/acceptanceCriteria/:criterionId",
    authenticateRoute,
    AcceptanceCriteria.update,
  );

  router.delete(
    "/projects/:projectId/stories/:storyId/acceptanceCriteria/:criterionId",
    authenticateRoute,
    AcceptanceCriteria.delete,
  );

  app.use("/nimbleapi", router);
};
