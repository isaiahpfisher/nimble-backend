const db = require("../models");
const RecipeIngredient = db.recipeIngredient;
const Ingredient = db.ingredient;
const Op = db.Sequelize.Op;

// Create and Save a new RecipeIngredient
exports.create = async (req, res) => {
  // Validate request
  if (req.body.quantity === undefined) {
    const error = new Error("Quantity cannot be empty for recipe ingredient!");
    error.statusCode = 400;
    throw error;
  } else if (req.body.recipeId === undefined) {
    const error = new Error("Recipe ID cannot be empty for recipe ingredient!");
    error.statusCode = 400;
    throw error;
  } else if (req.body.ingredientId === undefined) {
    const error = new Error(
      "Ingredient ID cannot be empty for recipe ingredient!"
    );
    error.statusCode = 400;
    throw error;
  }

  // Create a RecipeIngredient
  const recipeIngredient = {
    quantity: req.body.quantity,
    recipeId: req.body.recipeId,
    recipeStepId: req.body.recipeStepId ? req.body.recipeStepId : null,
    ingredientId: req.body.ingredientId,
  };
  // Save RecipeIngredient in the database
  try {
    const data = await RecipeIngredient.create(recipeIngredient);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message ||
        "Some error occurred while creating the RecipeIngredient.",
    });
  }
};

// Retrieve all RecipeIngredients from the database.
exports.findAll = async (req, res) => {
  const recipeIngredientId = req.query.recipeIngredientId;
  var condition = recipeIngredientId
    ? {
        id: {
          [Op.like]: `%${recipeIngredientId}%`,
        },
      }
    : null;

  try {
    const data = await RecipeIngredient.findAll({ where: condition });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message ||
        "Some error occurred while retrieving recipeIngredients.",
    });
  }
};

exports.findAllForRecipe = async (req, res) => {
  const recipeId = req.params.recipeId;
  try {
    const data = await RecipeIngredient.findAll({
      where: { recipeId: recipeId },
      include: [
        {
          model: Ingredient,
          as: "ingredient",
          required: true,
        },
      ],
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message ||
        "Some error occurred while retrieving recipeIngredients for a recipe.",
    });
  }
};

// Find all RecipeIngredients for a recipe step and include the ingredients
exports.findAllForRecipeStepWithIngredients = async (req, res) => {
  const recipeStepId = req.params.recipeStepId;
  try {
    const data = await RecipeIngredient.findAll({
      where: { recipeStepId: recipeStepId },
      include: [
        {
          model: Ingredient,
          as: "ingredient",
          required: true,
        },
      ],
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

// Find a single RecipeIngredient with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await RecipeIngredient.findByPk(id);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Error retrieving RecipeIngredient with id=" + id,
    });
  }
};

// Update a RecipeIngredient by the id in the request
exports.update = async (req, res) => {
  const id = req.params.id;

  try {
    const number = await RecipeIngredient.update(req.body, {
      where: { id: id },
    });
    if (number == 1) {
      res.send({
        message: "RecipeIngredient was updated successfully.",
      });
    } else {
      res.send({
        message: `Cannot update RecipeIngredient with id=${id}. Maybe RecipeIngredient was not found or req.body is empty!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error updating RecipeIngredient with id=" + id,
    });
  }
};

// Delete a RecipeIngredient with the specified id in the request
exports.delete = async (req, res) => {
  const id = req.params.id;

  try {
    const number = await RecipeIngredient.destroy({
      where: { id: id },
    });
    if (number == 1) {
      res.send({
        message: "RecipeIngredient was deleted successfully!",
      });
    } else {
      res.send({
        message: `Cannot delete RecipeIngredient with id=${id}. Maybe RecipeIngredient was not found!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Could not delete RecipeIngredient with id=" + id,
    });
  }
};

// Delete all RecipeIngredients from the database.
exports.deleteAll = async (req, res) => {
  try {
    const number = await RecipeIngredient.destroy({
      where: {},
      truncate: false,
    });
    res.send({
      message: `${number} RecipeIngredients were deleted successfully!`,
    });
  } catch (err) {
    res.status(500).send({
      message:
        err.message ||
        "Some error occurred while removing all recipeIngredients.",
    });
  }
};
