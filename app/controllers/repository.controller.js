const db = require("../models");
const Repository = db.repository;
const Op = db.Sequelize.Op;
const axios = require("axios");
const SystemLog = db.systemLog;

exports.create = async (req, res) => {
  try {
    const { githubId, name } = req.body;

    // Validate GitHub repository exists
    try {
      await axios.get(
        `https://api.github.com/repositories/${githubId}`
      );
    } catch (error) {
      return res.status(400).send({
        message: "Invalid GitHub repository ID.",
      });
    }

    const repository = {
      githubId: githubId,
      name: name,
      projectId: req.params.projectId,
    };

    const data = await Repository.create(repository);
    await SystemLog.create({
      subjectType: "REPOSITORY",
      subjectId: data.id,
      action: "CREATE_REPOSITORY",
      metadata: {
        message: "Repository connected",
        repositoryName: data.name,
        projectId: data.projectId,
      },
      userId: req.userId,
    });

    res.send(data);

  } catch (err) {
    res.status(500).send({
      message: err.message || "Error creating repository.",
    });
  }
};
exports.findAll = async (req, res) => {
  try {
    const data = await Repository.findAll();
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.findAllForProject = async (req, res) => {
  try {
    const data = await Repository.findAll({
      where: {
        projectId: req.params.projectId,
      },
    });

    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.findOne = async (req, res) => {
  try {
    const data = await Repository.findByPk(req.params.id);

    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: "Repository not found",
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.update = async (req, res) => {
  try {
    const id = req.params.id;

    const [updated] = await Repository.update(req.body, {
      where: { id: id },
    });

    if (updated) {
      const updatedRepository = await Repository.findByPk(id);
      await SystemLog.create({
        subjectType: "REPOSITORY",
        subjectId: updatedRepository.id,
        action: "UPDATE_REPOSITORY",
        metadata: {
          message: "Repository updated",
          repositoryName: updatedRepository.name,
          changes: req.body,
        },
        userId: req.userId,
      });
      res.send(updatedRepository);
    } else {
      res.status(404).send({
        message: "Repository not found",
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
exports.delete = async (req, res) => {
  try {
    const id = req.params.id;
    const repository = await Repository.findByPk(id);
    if (!repository) {
      return res.status(404).send({
        message: "Repository not found",
      });
    }

    await SystemLog.create({
      subjectType: "REPOSITORY",
      subjectId: repository.id,
      action: "DELETE_REPOSITORY",
      metadata: {
        message: "Repository deleted",
        repositoryName: repository.name,
        githubId: repository.githubId,
        projectId: repository.projectId,
      },
      userId: req.userId,
    });
    const deleted = await Repository.destroy({
      where: { id: id },
    });

    if (deleted) {
      res.send({
        message: "Repository deleted successfully",
      });
    } else {
      res.status(404).send({
        message: "Repository not found",
      });
    }
  } catch (err) {
    res.status(500).send({
      message: err.message || "Something went wrong",
    });
  }
};
