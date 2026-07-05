const db = require("../models");
const RecipeStep = db.recipeStep;
const RecipeIngredient = db.recipeIngredient;
const Ingredient = db.ingredient;
const Op = db.Sequelize.Op;

// Create and Save a new RecipeStep
exports.create = async (req, res) => {
  // Validate request
  if (req.body.stepNumber === undefined) {
    const error = new Error("Step number cannot be empty for recipe step!");
    error.statusCode = 400;
    throw error;
  } else if (req.body.instruction === undefined) {
    const error = new Error("Description cannot be empty for recipe step!");
    error.statusCode = 400;
    throw error;
  } else if (req.body.recipeId === undefined) {
    const error = new Error("Recipe ID cannot be empty for recipe step!");
    error.statusCode = 400;
    throw error;
  }

  // Create a RecipeStep
  const recipeStep = {
    stepNumber: req.body.stepNumber,
    instruction: req.body.instruction,
    recipeId: req.body.recipeId,
  };
  // Save RecipeStep in the database
  try {
    const data = await RecipeStep.create(recipeStep);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while creating the RecipeStep.",
    });
  }
};

// Retrieve all RecipeSteps from the database.
exports.findAll = async (req, res) => {
  const recipeStepId = req.query.recipeStepId;
  var condition = recipeStepId
    ? {
        id: {
          [Op.like]: `%${recipeStepId}%`,
        },
      }
    : null;

  try {
    const data = await RecipeStep.findAll({ where: condition });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving recipeSteps.",
    });
  }
};

// Retrieve all RecipeSteps for a recipe from the database.
exports.findAllForRecipe = async (req, res) => {
  const recipeId = req.params.recipeId;

  try {
    const data = await RecipeStep.findAll({
      where: { recipeId: recipeId },
      order: [["stepNumber", "ASC"]],
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message ||
        "Some error occurred while retrieving recipeSteps for a recipe.",
    });
  }
};

// Find all RecipeSteps for a recipe and include the ingredients
exports.findAllForRecipeWithIngredients = async (req, res) => {
  const recipeId = req.params.recipeId;
  try {
    const data = await RecipeStep.findAll({
      where: { recipeId: recipeId },
      include: [
        {
          model: RecipeIngredient,
          as: "recipeIngredient",
          required: false,
          include: [
            {
              model: Ingredient,
              as: "ingredient",
              required: false,
            },
          ],
        },
      ],
      order: [["stepNumber", "ASC"]],
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message ||
        "Some error occurred while retrieving recipeIngredients for a recipe step.",
    });
  }
};

// Find a single RecipeStep with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;
  try {
    const data = await RecipeStep.findByPk(id);
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find RecipeStep with id=${id}.`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving RecipeStep with id=" + id,
    });
  }
};

// Update a RecipeStep by the id in the request
exports.update = async (req, res) => {
  const id = req.params.id;
  try {
    const number = await RecipeStep.update(req.body, {
      where: { id: id },
    });
    if (number == 1) {
      res.send({
        message: "RecipeStep was updated successfully.",
      });
    } else {
      res.send({
        message: `Cannot update RecipeStep with id=${id}. Maybe RecipeStep was not found or req.body is empty!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error updating RecipeStep with id=" + id,
    });
  }
};

// Delete a RecipeStep with the specified id in the request
exports.delete = async (req, res) => {
  const id = req.params.id;
  try {
    const number = await RecipeStep.destroy({
      where: { id: id },
    });
    if (number == 1) {
      res.send({
        message: "RecipeStep was deleted successfully!",
      });
    } else {
      res.send({
        message: `Cannot delete RecipeStep with id=${id}. Maybe RecipeStep was not found!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Could not delete RecipeStep with id=" + id,
    });
  }
};

// Delete all RecipeSteps from the database.
exports.deleteAll = async (req, res) => {
  try {
    const number = await RecipeStep.destroy({
      where: {},
      truncate: false,
    });
    res.send({ message: `${number} RecipeSteps were deleted successfully!` });
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while removing all recipeSteps.",
    });
  }
};
