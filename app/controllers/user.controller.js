const db = require("../models");
const User = db.user;
const Session = db.session;
const Op = db.Sequelize.Op;
const SystemLog = db.systemLog;
const { encrypt, getSalt, hashPassword } = require("../authentication/crypto");
const { authenticate } = require("../authentication/authentication");
const { httpError } = require("../utils/httpUtils");

// Create and Save a new User
exports.create = async (req, res) => {
  try {
    // Validate request
    if (req.body.firstName === undefined) {
      const error = new Error("First name cannot be empty for user!");
      error.statusCode = 400;
      throw error;
    } else if (req.body.lastName === undefined) {
      const error = new Error("Last name cannot be empty for user!");
      error.statusCode = 400;
      throw error;
    } else if (req.body.email === undefined) {
      const error = new Error("Email cannot be empty for user!");
      error.statusCode = 400;
      throw error;
    } else if (req.body.password === undefined) {
      const error = new Error("Password cannot be empty for user!");
      error.statusCode = 400;
      throw error;
    }

    const data = await User.findOne({
      where: {
        email: req.body.email,
      },
    });

    if (data) {
      const error = new Error("This email is already in use.");
      error.statusCode = 400;
      throw error;
    }

    let salt = await getSalt();
    let hash = await hashPassword(req.body.password, salt);

    // Create a User
    const user = {
      id: req.body.id,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: hash,
      salt: salt,
    };

    try {
      const createdUser = await User.create(user);
      await SystemLog.create({
        subjectType: "USER",
        subjectId: createdUser.id,
        action: "CREATE_USER",
        metadata: {
          message: "User created",
          firstName: createdUser.firstName,
          lastName: createdUser.lastName,
          email: createdUser.email,
        },
        userId: createdUser.id,
      });
      let userId = createdUser.id;

      let expireTime = new Date();
      expireTime.setDate(expireTime.getDate() + 1);

      const session = {
        email: req.body.email,
        userId: userId,
        expirationDate: expireTime,
      };
      const sessionData = await Session.create(session);
      let sessionId = sessionData.id;
      let token = await encrypt(sessionId);
      let userInfo = {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: createdUser.isAdmin,
        id: userId,
        token: token,
      };
      res.send(userInfo);
    } catch (err) {
      console.log(err);
      res.status(500).send({
        message: err.message || "Some error occurred while creating the User.",
      });
    }
  } catch (err) {
    return res.status(err.statusCode || 500).send({
      message: err.message || "Some error occurred while creating the User.",
    });
  }
};

// Retrieve all Users from the database.
exports.findAll = async (req, res) => {
  const id = req.query.id;
  var condition = id ? { id: { [Op.like]: `%${id}%` } } : null;

  try {
    const data = await User.findAll({
      where: condition,
      attributes: ["id", "isAdmin", "firstName", "lastName", "email"],
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Some error occurred while retrieving users.",
    });
  }
};

// Find a single User with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await User.findByPk(id, {
      attributes: ["id", "isAdmin", "firstName", "lastName", "email"],
    });
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find User with id = ${id}.`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving User with id = " + id,
    });
  }
};

// Find a single User with an email
exports.findByEmail = async (req, res) => {
  const email = req.params.email;

  try {
    const data = await User.findOne({
      where: {
        email: email,
      },
    });
    if (data) {
      res.send(data);
    } else {
      res.send({ email: "not found" });
      /*res.status(404).send({
        message: `Cannot find User with email=${email}.`
      });*/
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error retrieving User with email=" + email,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);

    const user = await User.findByPk(req.params.id);
    if (!user) {
      throw httpError(`Cannot find user with id = ${req.params.id}.`, 404);
    }

    const { firstName, lastName, email, isAdmin } = req.body;
    const updatedUser = { firstName, lastName, email, isAdmin };
    await user.update(updatedUser);

    await SystemLog.create({
      subjectType: "USER",
      subjectId: user.id,
      action: "UPDATE_USER",
      metadata: {
        message: "User updated",
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        changes: req.body,
      },
      userId: userId,
    });
    res.send(updatedUser);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error updating user.",
    });
  }
};

// Delete a User with the specified id in the request
exports.delete = async (req, res) => {
  const id = req.params.id;
  
  try {
    const { userId } = await authenticate(req, res);
    const user = await User.findByPk(id);

    if (user) {
      await SystemLog.create({
        subjectType: "USER",
        subjectId: user.id,
        action: "DELETE_USER",
        metadata: {
          message: "User deleted",
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        },
        userId: userId,
      });
    }
    const number = await User.destroy({
      where: { id: id },
    });
    if (number == 1) {
      res.send({
        message: "User was deleted successfully!",
      });
    } else {
      res.send({
        message: `Cannot delete User with id = ${id}. Maybe User was not found!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Could not delete User with id = " + id,
    });
  }
};

// Delete all People from the database.
exports.deleteAll = async (req, res) => {
  try {
    const { userId } = await authenticate(req, res);
    await SystemLog.create({
      subjectType: "USER",
      subjectId: 0,
      action: "DELETE_ALL_USERS",
      metadata: {
        message: "All users deleted",
      },
      userId: userId,
    });
    const number = await User.destroy({
      where: {},
      truncate: false,
    });
    res.send({ message: `${number} People were deleted successfully!` });
  } catch (err) {
    res.status(500).send({
      message: err.message || "Some error occurred while removing all people.",
    });
  }
};
