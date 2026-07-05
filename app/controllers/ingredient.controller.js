const db = require("../models");
const Ingredient = db.ingredient;
const Op = db.Sequelize.Op;

// Create and Save a new Ingredient
exports.create = async (req, res) => {
  // Validate request
  if (req.body.name === undefined) {
    const error = new Error("Name cannot be empty for ingredient!");
    error.statusCode = 400;
    throw error;
  } else if (req.body.unit === undefined) {
    const error = new Error("Unit cannot be empty for ingredient!");
    error.statusCode = 400;
    throw error;
  } else if (req.body.pricePerUnit === undefined) {
    const error = new Error("Price per unit cannot be empty for ingredient!");
    error.statusCode = 400;
    throw error;
  }

  // Create a Ingredient
  const ingredient = {
    name: req.body.name,
    unit: req.body.unit,
    pricePerUnit: req.body.pricePerUnit,
  };
  // Save Ingredient in the database
  try {
    const data = await Ingredient.create(ingredient);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while creating the Ingredient.",
    });
  }
};

// Retrieve all Ingredients from the database.
exports.findAll = async (req, res) => {
  const ingredientId = req.query.ingredientId;
  var condition = ingredientId
    ? {
        id: {
          [Op.like]: `%${ingredientId}%`,
        },
      }
    : null;

  try {
    const data = await Ingredient.findAll({ where: condition, order: [["name", "ASC"]] });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving ingredients.",
    });
  }
};

// Find a single Ingredient with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await Ingredient.findByPk(id);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving Ingredient with id=" + id,
    });
  }
};

// Update a Ingredient by the id in the request
exports.update = async (req, res) => {
  const id = req.params.id;

  try {
    const num = await Ingredient.update(req.body, {
      where: { id: id },
    });
    if (num == 1) {
      res.send({
        message: "Ingredient was updated successfully.",
      });
    } else {
      res.send({
        message: `Cannot update Ingredient with id=${id}. Maybe Ingredient was not found or req.body is empty!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error updating Ingredient with id=" + id,
    });
  }
};

// Delete a Ingredient with the specified id in the request
exports.delete = async (req, res) => {
  const id = req.params.id;

  try {
    const number = await Ingredient.destroy({
      where: { id: id },
    });
    if (number == 1) {
      res.send({
        message: "Ingredient was deleted successfully!",
      });
    } else {
      res.send({
        message: `Cannot delete Ingredient with id=${id}. Maybe Ingredient was not found!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Could not delete Ingredient with id=" + id,
    });
  }
};

// Delete all Ingredients from the database.
exports.deleteAll = async (req, res) => {
  try {
    const number = await Ingredient.destroy({
      where: {},
      truncate: false,
    });
    res.send({ message: `${number} Ingredients were deleted successfully!` });
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while removing all ingredients.",
    });
  }
};
