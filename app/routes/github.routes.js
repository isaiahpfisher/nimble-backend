module.exports = (app) => {
  const github = require("../controllers/github.controller.js");
  const router = require("express").Router();

  router.post("/login", github.githubLogin);

  app.use("/nimbleapi/github", router);
};