const db = require("../models");
const Repository = db.repository;
const Op = db.Sequelize.Op;
const axios = require("axios");
const { encrypt, getSalt, hashPassword } = require("../authentication/crypto");
const { authenticate } = require("../authentication/authentication");
const { httpError } = require("../utils/httpUtils");
const { requireAdmin, requireProjectMember } = require("../authentication/authorization");

async function findRepositoryForCaller(userId, id) {
  const repository = await Repository.findByPk(id);

  if (!repository) {
    throw httpError("Repository not found", 404);
  }

  try {
    await requireProjectMember(userId, repository.projectId);
  } catch (err) {
    if (err.statusCode === 403) {
      throw httpError("Repository not found", 404);
    }
    throw err;
  }

  return repository;
}

exports.create = async (req, res) => {
  try {
    await requireProjectMember(req.userId, req.params.projectId);

    const { githubId, name } = req.body;

    // Validate GitHub repository exists
    try {
      await axios.get(`https://api.github.com/repositories/${githubId}`);
    } catch (error) {
      return res.status(400).send({
        message: "Invalid GitHub repository ID.",
      });
    }

    const repository = {
      githubId: githubId,
      name: name,
      projectId: req.params.projectId,
      githubToken: req.body.githubToken,
      owner: req.body.owner,
    };

    const data = await Repository.create(repository);

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Error creating repository.",
    });
  }
};
exports.findAll = async (req, res) => {
  try {
    await requireAdmin(req.userId);

    const data = await Repository.findAll();
    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.findAllForProject = async (req, res) => {
  try {
    await requireProjectMember(req.userId, req.params.projectId);

    const data = await Repository.findAll({
      where: {
        projectId: req.params.projectId,
      },
    });

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.findOne = async (req, res) => {
  try {
    const data = await findRepositoryForCaller(req.userId, req.params.id);

    res.send(data);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.update = async (req, res) => {
  try {
    const repository = await findRepositoryForCaller(req.userId, req.params.id);

    // don't allow updating the projectId, so extract that out of the update body
    const { projectId, ...updates } = req.body;
    await repository.update(updates);

    res.send(repository);
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.delete = async (req, res) => {
  try {
    const repository = await findRepositoryForCaller(req.userId, req.params.id);

    await repository.destroy();

    res.send({
      message: "Repository deleted successfully",
    });
  } catch (err) {
    res.status(err.statusCode || 500).send({
      message: err.message || "Something went wrong",
    });
  }
};
