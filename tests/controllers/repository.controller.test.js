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


describe("update",()=>{


  it("updates a repository", async()=>{


    Repository.update.mockResolvedValue([1]);

    Repository.findByPk.mockResolvedValue({
      id:1,
    });


    const req={
      params:{
        id:"1",
      },
      body:{
        name:"updated",
      },
    };


    const res=mockRes();


    await controller.update(req,res);


    expect(res.send)
      .toHaveBeenCalled();

  });



  it("returns 404 when update fails",async()=>{


    Repository.update.mockResolvedValue([0]);


    const req={
      params:{
        id:"1",
      },
      body:{},
    };


    const res=mockRes();


    await controller.update(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(404);

  });



  it("returns 500 when update throws error",async()=>{


    Repository.update.mockRejectedValue(
      new Error("update failed")
    );


    const req={
      params:{
        id:"1",
      },
      body:{},
    };


    const res=mockRes();


    await controller.update(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(500);

  });


});


describe("delete",()=>{


  it("deletes repository",async()=>{


    Repository.destroy.mockResolvedValue(1);


    const req={
      params:{
        id:"1",
      },
    };


    const res=mockRes();


    await controller.delete(req,res);


    expect(res.send)
      .toHaveBeenCalledWith({
        message:"Repository deleted successfully",
      });

  });



  it("returns 404 when repository does not exist",async()=>{


    Repository.destroy.mockResolvedValue(0);


    const req={
      params:{
        id:"1",
      },
    };


    const res=mockRes();


    await controller.delete(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(404);

  });



  it("returns 500 when delete fails",async()=>{


    Repository.destroy.mockRejectedValue(
      new Error("delete failed")
    );


    const req={
      params:{
        id:"1",
      },
    };


    const res=mockRes();


    await controller.delete(req,res);


    expect(res.status)
      .toHaveBeenCalledWith(500);

  });


});