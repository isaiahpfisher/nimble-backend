module.exports = (app) => {
  const Comment = require("../controllers/comment.controller.js");
  const { authenticateRoute } = require("../authentication/authentication");
  var router = require("express").Router();

  router.get("/comments/", Comment.findAll);

  router.get(
    "/projects/:projectId/stories/:storyId/comments",
    authenticateRoute,
    Comment.findAllForStory,
  );

  router.post(
    "/projects/:projectId/stories/:storyId/comments",
    authenticateRoute,
    Comment.createForStory,
  );

  router.get(
    "/projects/:projectId/stories/:storyId/acceptanceCriteria/:criterionId/comments",
    authenticateRoute,
    Comment.findAllForCriterion,
  );

  router.post(
    "/projects/:projectId/stories/:storyId/acceptanceCriteria/:criterionId/comments",
    authenticateRoute,
    Comment.createForCriterion,
  );

  router.put("/comments/:id", authenticateRoute, Comment.update);

  router.delete("/comments/:id", authenticateRoute, Comment.delete);

  app.use("/nimbleapi", router);
};
