module.exports = (app) => {
  const Project = require("../controllers/project.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.get("/projects/", Project.findAll);
  router.get("/users/me/projects", authenticateRoute, Project.findAllForUser);
  router.get("/projects/:id", Project.findOne);
  router.post("/projects/", authenticateRoute, Project.create);
  router.post("/admin/projects", authenticateRoute, Project.adminCreate);
  router.put("/projects/:id", authenticateRoute, Project.update);
  router.delete("/projects/:id", authenticateRoute, Project.delete);

  app.use("/nimbleapi", router);
};
