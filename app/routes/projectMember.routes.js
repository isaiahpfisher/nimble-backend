module.exports = (app) => {
  const ProjectMember = require("../controllers/projectMember.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all ProjectMember
  router.get("/projectMembers/", ProjectMember.findAll);

  //Retrieve all ProjectMember for a specific user
  router.get("/projectMembers/user/:userId", ProjectMember.findAllForUser);

    //Retrieve all ProjectMember for a specific Project
  router.get("/projectMembers/project/:projectId", ProjectMember.findAllForProject);

  // Create a new ProjectMember
  router.post("/projectMembers/:project/:member",/*authenticateRoute,*/ ProjectMember.create);

  //Delete a ProjectMember
  router.delete("/projectMembers/:id",/*authenticateRoute,*/ ProjectMember.delete);

  //Update a ProjectMember
  router.put("/projectMembers/:id",/*authenticateRoute,*/ ProjectMember.update);


  app.use("/nimbleapi", router);
};
