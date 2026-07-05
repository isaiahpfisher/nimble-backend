require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const db = require("./app/models");

const startServer = async () => {
  try {
    await db.sequelize.sync();
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
  origin: "http://localhost:8081",
};

app.use(cors(corsOptions));
app.options("*", cors());

// parse requests of content-type - application/json
app.use(express.json());

// parse requests of content-type - application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// simple route
app.get("/", (req, res) => {
  res.json({ message: "The nimble backend is running..." });
});

require("./app/routes/auth.routes.js")(app);
require("./app/routes/ingredient.routes")(app);
require("./app/routes/recipe.routes")(app);
require("./app/routes/recipeStep.routes")(app);
require("./app/routes/recipeIngredient.routes")(app);
require("./app/routes/user.routes")(app);

// set port, listen for requests
const PORT = process.env.PORT || 3200;
startServer();

module.exports = app;
