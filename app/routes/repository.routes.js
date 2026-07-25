module.exports = (app) => {
  const Repository = require("../controllers/repository.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Create a new Repository
  router.post(
    "/projects/:projectId/repositories/",
    authenticateRoute,
    Repository.create
  );

  // Retrieve all Repository
  router.get(
    "/repositories/",
    authenticateRoute,
    Repository.findAll
  );

  router.get(
    "/projects/:projectId/repositories/",
    authenticateRoute,
    Repository.findAllForProject
  );

  // Retrieve one Repository
  router.get(
    "/repositories/:id",
    authenticateRoute,
    Repository.findOne
  );

  // Update a Repository
  router.put(
    "/repositories/:id",
    authenticateRoute,
    Repository.update
  );

  // Delete a Repository
  router.delete(
    "/repositories/:id",
    authenticateRoute,
    Repository.delete
  );

  app.use("/nimbleapi", router);
};
