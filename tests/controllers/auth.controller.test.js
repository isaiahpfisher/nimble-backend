// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  user: {
    findByPk: jest.fn(),
  },
  session: {
    create: jest.fn(),
    destroy: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

jest.mock("../../app/authentication/authentication", () => ({
  authenticate: jest.fn(),
}));

jest.mock("../../app/authentication/crypto", () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
}));

const db = require("../../app/models");
const User = db.user;
const Session = db.session;
const { authenticate } = require("../../app/authentication/authentication");
const { encrypt, decrypt } = require("../../app/authentication/crypto");
const controller = require("../../app/controllers/auth.controller");

// Builds a stubbed Express response whose chainable methods we can assert on.
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

// Builds a stubbed Express request with a given authorization header.
function mockReq(authHeader) {
  return { get: jest.fn(() => authHeader) };
}

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("login", () => {
  it("creates a session and returns user info with a token", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    User.findByPk.mockResolvedValue({
      id: 42,
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      isAdmin: false,
    });
    Session.create.mockResolvedValue({ id: 7 });
    encrypt.mockResolvedValue("token-xyz");
    const req = mockReq("Basic abc");
    const res = mockRes();

    await controller.login(req, res);

    expect(authenticate).toHaveBeenCalledWith(req, res, "credentials");
    expect(Session.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", userId: 42 }),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        id: 42,
        token: "token-xyz",
      }),
    );
  });

  it("does nothing when authentication yields no userId", async () => {
    // authenticate already sent its own 401 response in this case.
    authenticate.mockResolvedValue({});
    const req = mockReq("Basic abc");
    const res = mockRes();

    await controller.login(req, res);

    expect(User.findByPk).not.toHaveBeenCalled();
    expect(Session.create).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("responds 500 when session creation fails", async () => {
    authenticate.mockResolvedValue({ userId: 42 });
    User.findByPk.mockResolvedValue({ id: 42, email: "a@b.com" });
    Session.create.mockRejectedValue(new Error("session boom"));
    const req = mockReq("Basic abc");
    const res = mockRes();

    await controller.login(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "session boom" });
  });
});

describe("logout", () => {
  it("destroys the session for a valid bearer token", async () => {
    decrypt.mockResolvedValue("session-1");
    Session.destroy.mockResolvedValue(1);
    const req = mockReq("Bearer token-xyz");
    const res = mockRes();

    await controller.logout(req, res);

    expect(decrypt).toHaveBeenCalledWith("token-xyz");
    expect(Session.destroy).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });

  it("does nothing when there is no authorization header", async () => {
    const req = mockReq(null);
    const res = mockRes();

    await controller.logout(req, res);

    expect(decrypt).not.toHaveBeenCalled();
    expect(Session.destroy).not.toHaveBeenCalled();
  });

  it("does nothing when the header is not a bearer token", async () => {
    const req = mockReq("Basic abc");
    const res = mockRes();

    await controller.logout(req, res);

    expect(decrypt).not.toHaveBeenCalled();
    expect(Session.destroy).not.toHaveBeenCalled();
  });

  it("returns without destroying when the token decrypts to null", async () => {
    decrypt.mockResolvedValue(null);
    const req = mockReq("Bearer bad-token");
    const res = mockRes();

    await controller.logout(req, res);

    expect(Session.destroy).not.toHaveBeenCalled();
  });

  it("swallows errors thrown while destroying the session", async () => {
    decrypt.mockResolvedValue("session-1");
    Session.destroy.mockRejectedValue(new Error("destroy boom"));
    const req = mockReq("Bearer token-xyz");
    const res = mockRes();

    await expect(controller.logout(req, res)).resolves.toBeUndefined();
    expect(Session.destroy).toHaveBeenCalled();
  });
});
