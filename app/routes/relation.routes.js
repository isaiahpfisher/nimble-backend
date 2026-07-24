module.exports = (app) => {
  const Relation = require("../controllers/relation.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Relation
  router.get("/relations/", Relation.findAll);

  router.post(
    "/projects/:projectId/stories/:storyId/relations",
    authenticateRoute,
    Relation.create,
  );

  router.delete(
    "/projects/:projectId/stories/:storyId/relations/:relationId",
    authenticateRoute,
    Relation.delete,
  );

  app.use("/nimbleapi", router);
};
