// Mock the models module so requiring the controller never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  user: {
    findOrCreate: jest.fn(),
  },
  session: {
    create: jest.fn(),
  },
  Sequelize: { Op: {} },
}));

jest.mock("../../app/authentication/crypto", () => ({
  encrypt: jest.fn(),
}));

const db = require("../../app/models");
const User = db.user;
const Session = db.session;
const { encrypt } = require("../../app/authentication/crypto");
const controller = require("../../app/controllers/github.controller");

// Builds a stubbed Express response whose chainable methods we can assert on.
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

// Builds a stubbed Express request with a given body.
function mockReq(body) {
  return { body };
}

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe("githubLogin", () => {
  it("responds 400 when no code is provided", async () => {
    const req = mockReq({});
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: "Missing GitHub code." });
  });

  it("responds 401 when GitHub does not return an access token", async () => {
    global.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: "bad_verification_code" }),
    });
    const req = mockReq({ code: "abc" });
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(User.findOrCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ message: "GitHub authorization failed." });
  });

  it("responds 403 when the GitHub profile has no id", async () => {
    global.fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ access_token: "gh-token" }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) });
    const req = mockReq({ code: "abc" });
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(User.findOrCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({ message: "Unable to verify GitHub account." });
  });

  it("creates a session and returns user info with a token for a new user", async () => {
    global.fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ access_token: "gh-token" }) })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            id: 99,
            name: "Ada Lovelace",
            email: "ada@example.com",
            avatar_url: "http://avatar",
          }),
      });
    User.findOrCreate.mockResolvedValue([
      {
        id: 1,
        githubId: "99",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        isAdmin: false,
      },
    ]);
    Session.create.mockResolvedValue({ id: 7 });
    encrypt.mockResolvedValue("token-xyz");
    const req = mockReq({ code: "abc" });
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/user",
      expect.objectContaining({
        headers: { Authorization: "token gh-token" },
      }),
    );
    expect(User.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubId: "99" },
        defaults: expect.objectContaining({
          githubId: "99",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          avatarUrl: "http://avatar",
        }),
      }),
    );
    expect(Session.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", userId: 1 }),
    );
    expect(encrypt).toHaveBeenCalledWith(7);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        id: 1,
        token: "token-xyz",
      }),
    );
  });

  it("falls back to login and '-' lastName when name has a single word", async () => {
    global.fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ access_token: "gh-token" }) })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ id: 5, login: "adalovelace", email: null }),
      });
    User.findOrCreate.mockResolvedValue([
      { id: 2, firstName: "adalovelace", lastName: "-", email: null, isAdmin: false },
    ]);
    Session.create.mockResolvedValue({ id: 8 });
    encrypt.mockResolvedValue("token-abc");
    const req = mockReq({ code: "abc" });
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(User.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ firstName: "adalovelace", lastName: "-" }),
      }),
    );
    expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("responds 500 when an unexpected error is thrown", async () => {
    global.fetch.mockRejectedValueOnce(new Error("network boom"));
    const req = mockReq({ code: "abc" });
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: "network boom" });
  });

  it("responds 500 with a fallback message when the thrown error has none", async () => {
    global.fetch.mockRejectedValueOnce({});
    const req = mockReq({ code: "abc" });
    const res = mockRes();

    await controller.githubLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      message: "Some error occurred during GitHub authentication.",
    });
  });
});