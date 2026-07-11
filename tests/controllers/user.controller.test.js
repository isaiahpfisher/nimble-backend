// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  user: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
  session: {
    create: jest.fn(),
  },
  Sequelize: { Op: { like: Symbol("like") } },
}));

jest.mock("../../app/authentication/crypto", () => ({
  encrypt: jest.fn(),
  getSalt: jest.fn(),
  hashPassword: jest.fn(),
}));

const db = require("../../app/models");
const User = db.user;
const Session = db.session;
const { encrypt, getSalt, hashPassword } = require("../../app/authentication/crypto");
const controller = require("../../app/controllers/user.controller");

// Builds a stubbed Express response whose chainable methods we can assert on.
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

beforeAll(() => {
  // The controller is chatty; keep test output readable.
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("create", () => {
  const validBody = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    password: "secret",
  };

  it("creates a user and session, then returns user info with a token", async () => {
    User.findOne.mockResolvedValue(null);
    getSalt.mockResolvedValue("salt");
    hashPassword.mockResolvedValue("hashed");
    User.create.mockResolvedValue({ id: 10 });
    Session.create.mockResolvedValue({ id: 99 });
    encrypt.mockResolvedValue("token-abc");
    const req = { body: { ...validBody } };
    const res = mockRes();

    await controller.create(req, res);

    expect(hashPassword).toHaveBeenCalledWith("secret", "salt");
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        password: "hashed",
        salt: "salt",
      }),
    );
    expect(Session.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", userId: 10 }),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        token: "token-abc",
      }),
    );
  });

  it.each([
    ["firstName", { lastName: "L", email: "e", password: "p" }],
    ["lastName", { firstName: "F", email: "e", password: "p" }],
    ["email", { firstName: "F", lastName: "L", password: "p" }],
    ["password", { firstName: "F", lastName: "L", email: "e" }],
  ])("throws a 400 when %s is missing", async (_field, body) => {
    const req = { body };
    const res = mockRes();

    await expect(controller.create(req, res)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(User.create).not.toHaveBeenCalled();
  });

  it("returns a message string when the email is already in use", async () => {
    User.findOne.mockResolvedValue({ id: 1 });
    const req = { body: { ...validBody } };
    const res = mockRes();

    const result = await controller.create(req, res);

    expect(result).toBe("This email is already in use.");
    expect(User.create).not.toHaveBeenCalled();
  });

  it("responds 500 when session creation fails", async () => {
    User.findOne.mockResolvedValue(null);
    getSalt.mockResolvedValue("salt");
    hashPassword.mockResolvedValue("hashed");
    User.create.mockResolvedValue({ id: 10 });
    Session.create.mockRejectedValue(new Error("session boom"));
    const req = { body: { ...validBody } };
    const res = mockRes();

    await controller.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "session boom" });
  });

  it("returns an error message string when the lookup fails", async () => {
    User.findOne.mockRejectedValue(new Error("lookup failed"));
    const req = { body: { ...validBody } };
    const res = mockRes();

    const result = await controller.create(req, res);

    expect(result).toBe("lookup failed");
  });
});

describe("findAll", () => {
  it("returns all users when no id filter is given", async () => {
    const users = [{ id: 1 }, { id: 2 }];
    User.findAll.mockResolvedValue(users);
    const req = { query: {} };
    const res = mockRes();

    await controller.findAll(req, res);

    expect(User.findAll).toHaveBeenCalledWith({ where: null });
    expect(res.send).toHaveBeenCalledWith(users);
  });

  it("builds a like condition when an id filter is given", async () => {
    User.findAll.mockResolvedValue([]);
    const req = { query: { id: "5" } };
    const res = mockRes();

    await controller.findAll(req, res);

    const arg = User.findAll.mock.calls[0][0];
    expect(arg.where.id[db.Sequelize.Op.like]).toBe("%5%");
  });

  it("responds 500 on failure", async () => {
    User.findAll.mockRejectedValue(new Error("db down"));
    const req = { query: {} };
    const res = mockRes();

    await controller.findAll(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "db down" });
  });
});

describe("findOne", () => {
  it("sends the user when found", async () => {
    const user = { id: 7 };
    User.findByPk.mockResolvedValue(user);
    const res = mockRes();

    await controller.findOne({ params: { id: "7" } }, res);

    expect(res.send).toHaveBeenCalledWith(user);
  });

  it("responds 404 when not found", async () => {
    User.findByPk.mockResolvedValue(null);
    const res = mockRes();

    await controller.findOne({ params: { id: "99" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot find User with id = 99.",
    });
  });

  it("responds 500 on failure", async () => {
    User.findByPk.mockRejectedValue(new Error("boom"));
    const res = mockRes();

    await controller.findOne({ params: { id: "1" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("findByEmail", () => {
  it("sends the user when found", async () => {
    const user = { id: 7, email: "a@b.com" };
    User.findOne.mockResolvedValue(user);
    const res = mockRes();

    await controller.findByEmail({ params: { email: "a@b.com" } }, res);

    expect(User.findOne).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
    expect(res.send).toHaveBeenCalledWith(user);
  });

  it("sends { email: 'not found' } when the user does not exist", async () => {
    User.findOne.mockResolvedValue(null);
    const res = mockRes();

    await controller.findByEmail({ params: { email: "x@y.com" } }, res);

    expect(res.send).toHaveBeenCalledWith({ email: "not found" });
  });

  it("responds 500 on failure", async () => {
    User.findOne.mockRejectedValue(new Error("boom"));
    const res = mockRes();

    await controller.findByEmail({ params: { email: "x@y.com" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("update", () => {
  it("confirms success when exactly one row is updated", async () => {
    User.update.mockResolvedValue(1);
    const req = { params: { id: "3" }, body: { firstName: "New" } };
    const res = mockRes();

    await controller.update(req, res);

    expect(User.update).toHaveBeenCalledWith(req.body, { where: { id: "3" } });
    expect(res.send).toHaveBeenCalledWith({
      message: "User was updated successfully.",
    });
  });

  it("reports when no row was updated", async () => {
    User.update.mockResolvedValue(0);
    const req = { params: { id: "3" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.send).toHaveBeenCalledWith({
      message:
        "Cannot update User with id = 3. Maybe User was not found or req.body is empty!",
    });
  });

  it("responds 500 on failure", async () => {
    User.update.mockRejectedValue(new Error("boom"));
    const req = { params: { id: "3" }, body: {} };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("delete", () => {
  it("confirms success when exactly one row is deleted", async () => {
    User.destroy.mockResolvedValue(1);
    const res = mockRes();

    await controller.delete({ params: { id: "3" } }, res);

    expect(User.destroy).toHaveBeenCalledWith({ where: { id: "3" } });
    expect(res.send).toHaveBeenCalledWith({
      message: "User was deleted successfully!",
    });
  });

  it("reports when no row was deleted", async () => {
    User.destroy.mockResolvedValue(0);
    const res = mockRes();

    await controller.delete({ params: { id: "3" } }, res);

    expect(res.send).toHaveBeenCalledWith({
      message: "Cannot delete User with id = 3. Maybe User was not found!",
    });
  });

  it("responds 500 on failure", async () => {
    User.destroy.mockRejectedValue(new Error("boom"));
    const res = mockRes();

    await controller.delete({ params: { id: "3" } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});

describe("deleteAll", () => {
  it("reports how many users were deleted", async () => {
    User.destroy.mockResolvedValue(4);
    const res = mockRes();

    await controller.deleteAll({}, res);

    expect(User.destroy).toHaveBeenCalledWith({ where: {}, truncate: false });
    expect(res.send).toHaveBeenCalledWith({
      message: "4 People were deleted successfully!",
    });
  });

  it("responds 500 on failure", async () => {
    User.destroy.mockRejectedValue(new Error("boom"));
    const res = mockRes();

    await controller.deleteAll({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "boom" });
  });
});
