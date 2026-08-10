// Authorization is covered on its own in tests/authentication/authorization.test.js.
// Here it is stubbed permissively so each controller test sees only the
// controller's behaviour; the guard calls themselves are asserted per action.
jest.mock("../../app/authentication/authorization", () => ({
  isAdmin: jest.fn().mockResolvedValue(true),
  requireAdmin: jest.fn().mockResolvedValue(undefined),
  requireSelfOrAdmin: jest.fn().mockResolvedValue(undefined),
  requireProjectMember: jest.fn().mockResolvedValue({ isManager: "1" }),
  requireMemberManagement: jest.fn().mockResolvedValue({ isManager: "1" }),
  assertBelongsToProject: jest.fn((record, projectId, label) => {
    const owner = record && record.projectId;
    if (owner == null || projectId == null || String(owner) !== String(projectId)) {
      const error = new Error(`Cannot find ${label}.`);
      error.statusCode = 404;
      throw error;
    }
    return record;
  }),
}));

jest.mock("axios", () => ({
  get: jest.fn(),
}));
jest.mock("../../app/models", () => ({
  repository: {
    create: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
  systemLog: {
    create: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

const db = require("../../app/models");
const Repository = db.repository;
const controller = require("../../app/controllers/repository.controller");
const axios = require("axios");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});


describe("create", () => {

  it("creates a repository", async () => {

    axios.get.mockResolvedValue({
      data: {
        id: 123,
        name: "test-repo"
      }
    });


    const repository = {
      id: 1,
      githubId: "123",
      name: "test-repo",
      projectId: 4,
    };


    Repository.create.mockResolvedValue(repository);


    const req = {
      params: { 
        projectId: "4" 
      },
      body: {
        githubId: "123",
        name: "test-repo",
      },
    };


    const res = mockRes();


    await controller.create(req, res);


    expect(axios.get).toHaveBeenCalledWith(
      "https://api.github.com/repositories/123"
    );


    expect(Repository.create).toHaveBeenCalledWith({
      githubId: "123",
      name: "test-repo",
      projectId: "4",
    });


    expect(res.send).toHaveBeenCalledWith(repository);

  });



  // 👇 ADD IT HERE (outside the previous test)
  it("returns 400 when GitHub repository does not exist", async()=>{

    axios.get.mockRejectedValue(
      new Error("Not found")
    );


    const req={
      params:{
        projectId:"4",
      },
      body:{
        githubId:"999999999",
        name:"fake",
      },
    };


    const res=mockRes();


    await controller.create(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(400);


    expect(res.send)
      .toHaveBeenCalledWith({
        message:"Invalid GitHub repository ID.",
      });

  });



  it("returns 500 when create fails", async () => {

    axios.get.mockResolvedValue({
      data:{
        id:123
      }
    });


    Repository.create.mockRejectedValue(
      new Error("create failed")
    );


    const req = {
      params: { 
        projectId:"4" 
      },
      body:{
        githubId:"123",
        name:"test-repo",
      },
    };


    const res=mockRes();


    await controller.create(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(500);


    expect(res.send)
      .toHaveBeenCalledWith({
        message:"create failed",
      });

  });

});

describe("findAll", () => {

  it("returns all repositories", async () => {

    const repositories = [{ id: 1 }];

    Repository.findAll.mockResolvedValue(repositories);

    const res = mockRes();

    await controller.findAll({}, res);

    expect(Repository.findAll)
      .toHaveBeenCalledTimes(1);

    expect(res.send)
      .toHaveBeenCalledWith(repositories);

  });


  it("returns 500 when findAll fails", async () => {

    Repository.findAll.mockRejectedValue(
      new Error("find failed")
    );

    const res = mockRes();

    await controller.findAll({}, res);

    expect(res.status)
      .toHaveBeenCalledWith(500);

    expect(res.send)
      .toHaveBeenCalledWith({
        message: "find failed",
      });

  });

});


describe("findAllForProject", () => {

  it("returns repositories for a project", async () => {

    const repositories = [{ id: 1 }];

    Repository.findAll.mockResolvedValue(repositories);

    const req = {
      params: {
        projectId: "4",
      },
    };

    const res = mockRes();

    await controller.findAllForProject(req,res);

    expect(Repository.findAll)
      .toHaveBeenCalledWith({
        where:{
          projectId:"4",
        },
      });

    expect(res.send)
      .toHaveBeenCalledWith(repositories);

  });


  it("returns 500 when findAllForProject fails", async () => {

    Repository.findAll.mockRejectedValue(
      new Error("project repository failed")
    );


    const req = {
      params:{
        projectId:"4",
      },
    };


    const res = mockRes();


    await controller.findAllForProject(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(500);

  });

});


describe("findOne", () => {

  it("returns a repository", async () => {

    const repository = {
      id:1,
    };


    Repository.findByPk.mockResolvedValue(repository);


    const req = {
      params:{
        id:"1",
      },
    };


    const res = mockRes();


    await controller.findOne(req,res);


    expect(res.send)
      .toHaveBeenCalledWith(repository);

  });



  it("returns 404 when repository does not exist", async () => {

    Repository.findByPk.mockResolvedValue(null);


    const req={
      params:{
        id:"1",
      },
    };


    const res=mockRes();


    await controller.findOne(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(404);

  });



  it("returns 500 when findOne fails", async () => {

    Repository.findByPk.mockRejectedValue(
      new Error("find one failed")
    );


    const req={
      params:{
        id:"1",
      },
    };


    const res=mockRes();


    await controller.findOne(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(500);

  });

});


// update and delete now load the row first so the caller can be checked against
// the repository's project, then act on the instance.
describe("update", () => {
  it("updates a repository", async () => {
    const repository = {
      id: 1,
      projectId: 5,
      update: jest.fn().mockResolvedValue(undefined),
    };
    Repository.findByPk.mockResolvedValue(repository);

    const req = { userId: 42, params: { id: "1" }, body: { name: "updated" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(repository.update).toHaveBeenCalledWith({ name: "updated" });
    expect(res.send).toHaveBeenCalledWith(repository);
  });

  it("does not let update move the repository to another project", async () => {
    const repository = {
      id: 1,
      projectId: 5,
      update: jest.fn().mockResolvedValue(undefined),
    };
    Repository.findByPk.mockResolvedValue(repository);

    const req = {
      userId: 42,
      params: { id: "1" },
      body: { name: "updated", projectId: 999 },
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(repository.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
  });

  it("returns 404 when the repository does not exist", async () => {
    Repository.findByPk.mockResolvedValue(null);

    const req = { userId: 42, params: { id: "1" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when update throws error", async () => {
    Repository.findByPk.mockResolvedValue({
      id: 1,
      projectId: 5,
      update: jest.fn().mockRejectedValue(new Error("update failed")),
    });

    const req = { userId: 42, params: { id: "1" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("delete", () => {
  it("deletes repository", async () => {
    const repository = {
      id: 1,
      projectId: 5,
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    Repository.findByPk.mockResolvedValue(repository);

    const req = { userId: 42, params: { id: "1" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(repository.destroy).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({
      message: "Repository deleted successfully",
    });
  });

  it("returns 404 when repository does not exist", async () => {
    Repository.findByPk.mockResolvedValue(null);

    const req = { userId: 42, params: { id: "1" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when delete fails", async () => {
    Repository.findByPk.mockResolvedValue({
      id: 1,
      projectId: 5,
      destroy: jest.fn().mockRejectedValue(new Error("delete failed")),
    });

    const req = { userId: 42, params: { id: "1" } };
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
