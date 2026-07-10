module.exports = (app) => {
  const Comment = require("../controllers/comment.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  // Retrieve all Comment
  router.get("/comments/", Comment.findAll);

  app.use("/nimbleapi", router);
};
