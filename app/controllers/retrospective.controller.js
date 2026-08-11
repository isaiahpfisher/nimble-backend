const db = require("../models");
const { requireProjectMember } = require("../authentication/authorization");

const Retrospective = db.retrospective;
const Sprint = db.sprint;
const User = db.user;


async function checkProjectMembership(userId, projectId, { mask = false } = {}) {
  try {
    await requireProjectMember(userId, String(projectId));
    return null;
  } catch (error) {
    if (mask) {
      return { status: 404, body: { message: "Retrospective not found." } };
    }

    return {
      status: error.statusCode || 403,
      body: {
        message: error.message || "You do not have access to this project.",
      },
    };
  }
}

// =========================
// Get all retrospectives for a sprint
// =========================

exports.findAllForSprint = async (req, res) => {
  try {
    const sprintId = Number(req.params.sprintId);
    const projectId = Number(req.params.projectId);

    if (!Number.isInteger(sprintId) || sprintId <= 0) {
      return res.status(400).send({
        message: "Invalid sprint ID.",
      });
    }

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).send({
        message: "Invalid project ID.",
      });
    }

    const authError = await checkProjectMembership(req.userId, projectId);

    if (authError) {
      return res.status(authError.status).send(authError.body);
    }

    // Make sure the sprint belongs to this project.
    const sprint = await Sprint.findOne({
      where: {
        id: sprintId,
        projectId: projectId,
      },
    });

    if (!sprint) {
      return res.status(404).send({
        message: "Sprint not found for this project.",
      });
    }

    const retrospectives = await Retrospective.findAll({
      where: {
        sprintId: sprintId,
      },

      include: [
        {
          model: User,
          as: "createdBy",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
          ],
        },

        {
          model: Sprint,
          as: "sprint",
          attributes: ["id", "projectId"],
          include: [
            {
              model: db.project,
              as: "project",
              attributes: ["id", "title"],
            },
          ],
        },
      ],

      order: [["createdAt", "DESC"]],
    });

    return res.send(retrospectives);
  } catch (error) {
    console.error(
      "Error retrieving retrospectives:",
      error
    );

    return res.status(500).send({
      message:
        error.message ||
        "Failed to retrieve retrospectives.",
    });
  }
};

// =========================
// Get one retrospective
// =========================

exports.findOne = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send({
        message: "Invalid retrospective ID.",
      });
    }

    const retrospective =
      await Retrospective.findByPk(id, {
        include: [
          {
            model: User,
            as: "createdBy",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "email",
            ],
          },

          {
            model: Sprint,
            as: "sprint",
            attributes: ["id", "projectId"],
            include: [
              {
                model: db.project,
                as: "project",
                attributes: ["id", "title"],
              },
            ],
          },
        ],
      });

    if (!retrospective) {
      return res.status(404).send({
        message: "Retrospective not found.",
      });
    }

 
    const authError = await checkProjectMembership(
      req.userId,
      retrospective.sprint.projectId,
      { mask: true }
    );

    if (authError) {
      return res.status(authError.status).send(authError.body);
    }

    return res.send(retrospective);
  } catch (error) {
    console.error(
      "Error retrieving retrospective:",
      error
    );

    return res.status(500).send({
      message:
        error.message ||
        "Failed to retrieve retrospective.",
    });
  }
};

// =========================
// Create retrospective
// =========================

exports.create = async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).send({
        message: "Authentication required.",
      });
    }

    const {
      title,
      summary,
      sprintId,
      createdById,
    } = req.body;

    
    if (!title || !title.trim()) {
      return res.status(400).send({
        message: "Title is required.",
      });
    }

    
    const numericSprintId = Number(sprintId);

    if (
      !Number.isInteger(numericSprintId) ||
      numericSprintId <= 0
    ) {
      return res.status(400).send({
        message: "A valid sprintId is required.",
      });
    }

   
    const sprint = await Sprint.findByPk(
      numericSprintId
    );

    if (!sprint) {
      return res.status(404).send({
        message: "Sprint not found.",
      });
    }

  
    const authError = await checkProjectMembership(req.userId, sprint.projectId);

    if (authError) {
      return res.status(authError.status).send(authError.body);
    }

    const numericCreatedById = createdById
      ? Number(createdById)
      : Number(req.userId);

    if (
      !Number.isInteger(numericCreatedById) ||
      numericCreatedById <= 0
    ) {
      return res.status(400).send({
        message: "A valid createdById is required.",
      });
    }

    const user = await User.findByPk(
      numericCreatedById
    );

    if (!user) {
      return res.status(404).send({
        message: "Selected user was not found.",
      });
    }

   
    if (numericCreatedById !== Number(req.userId)) {
      const creatorAuthError = await checkProjectMembership(
        numericCreatedById,
        sprint.projectId
      );

      if (creatorAuthError) {
        return res.status(400).send({
          message: "Selected user is not a member of this project.",
        });
      }
    }

    const retrospective =
      await Retrospective.create({
        title: title.trim(),
        summary: summary || "",
        sprintId: numericSprintId,
        createdById: numericCreatedById,
      });

    const result =
      await Retrospective.findByPk(
        retrospective.id,
        {
          include: [
            {
              model: User,
              as: "createdBy",
              attributes: [
                "id",
                "firstName",
                "lastName",
                "email",
              ],
            },

            {
              model: Sprint,
              as: "sprint",
              attributes: ["id", "projectId"],
              include: [
                {
                  model: db.project,
                  as: "project",
                  attributes: ["id", "title"],
                },
              ],
            },
          ],
        }
      );

    return res.status(201).send(result);
  } catch (error) {
    console.error(
      "Error creating retrospective:",
      error
    );

    return res.status(500).send({
      message:
        error.message ||
        "Failed to create retrospective.",
    });
  }
};



exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send({
        message: "Invalid retrospective ID.",
      });
    }

    const retrospective =
      await Retrospective.findByPk(id, {
        include: [
          {
            model: Sprint,
            as: "sprint",
            attributes: ["id", "projectId"],
          },
        ],
      });

    if (!retrospective) {
      return res.status(404).send({
        message: "Retrospective not found.",
      });
    }

    
    const authError = await checkProjectMembership(
      req.userId,
      retrospective.sprint.projectId,
      { mask: true }
    );

    if (authError) {
      return res.status(authError.status).send(authError.body);
    }

    const {
      title,
      summary,
      createdById,
    } = req.body;

    // Update title
    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).send({
          message: "Title cannot be empty.",
        });
      }

      retrospective.title = title.trim();
    }

    // Update summary
    if (summary !== undefined) {
      retrospective.summary = summary;
    }


    if (createdById !== undefined) {
      const numericCreatedById =
        Number(createdById);

      if (
        !Number.isInteger(numericCreatedById) ||
        numericCreatedById <= 0
      ) {
        return res.status(400).send({
          message: "Invalid createdById.",
        });
      }

      const user = await User.findByPk(
        numericCreatedById
      );

      if (!user) {
        return res.status(404).send({
          message:
            "Selected user was not found.",
        });
      }

      const creatorAuthError = await checkProjectMembership(
        numericCreatedById,
        retrospective.sprint.projectId
      );

      if (creatorAuthError) {
        return res.status(400).send({
          message: "Selected user is not a member of this project.",
        });
      }

      retrospective.createdById =
        numericCreatedById;
    }

    await retrospective.save();

    const result =
      await Retrospective.findByPk(
        retrospective.id,
        {
          include: [
            {
              model: User,
              as: "createdBy",
              attributes: [
                "id",
                "firstName",
                "lastName",
                "email",
              ],
            },

            {
              model: Sprint,
              as: "sprint",
              attributes: ["id", "projectId"],
              include: [
                {
                  model: db.project,
                  as: "project",
                  attributes: ["id", "title"],
                },
              ],
            },
          ],
        }
      );

    return res.send(result);
  } catch (error) {
    console.error(
      "Error updating retrospective:",
      error
    );

    return res.status(500).send({
      message:
        error.message ||
        "Failed to update retrospective.",
    });
  }
};

// =========================
// Delete retrospective
// =========================

exports.delete = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send({
        message: "Invalid retrospective ID.",
      });
    }

    const retrospective =
      await Retrospective.findByPk(id, {
        include: [
          {
            model: Sprint,
            as: "sprint",
            attributes: ["id", "projectId"],
          },
        ],
      });

    if (!retrospective) {
      return res.status(404).send({
        message: "Retrospective not found.",
      });
    }

   
    const authError = await checkProjectMembership(
      req.userId,
      retrospective.sprint.projectId,
      { mask: true }
    );

    if (authError) {
      return res.status(authError.status).send(authError.body);
    }

    await retrospective.destroy();

    return res.send({
      message:
        "Retrospective deleted successfully.",
    });
  } catch (error) {
    console.error(
      "Error deleting retrospective:",
      error
    );

    return res.status(500).send({
      message:
        error.message ||
        "Failed to delete retrospective.",
    });
  }
};