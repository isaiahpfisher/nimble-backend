require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const db = require("./app/models");

const startServer = async () => {
  try {
    await db.sequelize.sync({ alter: true });
    console.log("Database synced.");

    if (process.env.NODE_ENV !== "test") {
      app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}.`);
      });
    }
  } catch (err) {
    console.error("DB sync failed:", err);
    process.exit(1);
  }
};

var corsOptions = {
  origin: process.env.CORS_ORIGIN || "http://localhost:8081",
};

app.use(cors(corsOptions));
app.options("*", cors());

// parse requests of content-type - application/json
app.use(express.json());

// parse requests of content-type - application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// routes
require("./app/routes/auth.routes.js")(app);
require("./app/routes/user.routes")(app);
require("./app/routes/project.routes")(app);
require("./app/routes/projectMember.routes")(app);
require("./app/routes/repository.routes")(app);
require("./app/routes/storyState.routes")(app);
require("./app/routes/storyType.routes")(app);
require("./app/routes/sprint.routes")(app);
require("./app/routes/retrospective.routes")(app);
require("./app/routes/standup.routes")(app);
require("./app/routes/story.routes")(app);
require("./app/routes/relation.routes")(app);
require("./app/routes/acceptanceCriteria.routes")(app);
require("./app/routes/comment.routes")(app);
require("./app/routes/activity.routes")(app);
require("./app/routes/github.routes.js")(app);

// set port, listen for requests
const PORT = process.env.PORT || 3200;
startServer();

module.exports = app;
