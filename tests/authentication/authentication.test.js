// Mock the models module so requiring authentication.js never opens a real DB
// connection (app/models/index.js instantiates Sequelize at load time).
jest.mock("../../app/models", () => ({
  user: { findAll: jest.fn() },
  session: { findAll: jest.fn() },
  Sequelize: { Op: {} },
}));

// Stub the crypto helpers the module leans on so the tests control password
// hashing and token decoding without exercising real crypto.
jest.mock("../../app/authentication/crypto", () => ({
  hashPassword: jest.fn(),
  decrypt: jest.fn(),
}));

const db = require("../../app/models");
const User = db.user;
const Session = db.session;
const { hashPassword, decrypt } = require("../../app/authentication/crypto");
const { authenticate, authenticateRoute } = require("../../app/authentication/authentication");

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

// Encodes credentials the way a Basic auth client would.
function basic(email, password) {
  return "Basic " + Buffer.from(`${email}:${password}`).toString("base64");
}

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("authenticate", () => {
  describe("no authorization header", () => {
    it("responds 401 when authentication is required", async () => {
      const res = mockRes();

      await authenticate(mockReq(null), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Authentication required" });
    });

    it("returns an anonymous identity when authentication is optional", async () => {
      const res = mockRes();

      const result = await authenticate(mockReq(null), res, false);

      expect(result).toEqual({ type: "none", userId: null });
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("Basic credentials", () => {
    it("returns the credentials identity when the password matches", async () => {
      const hash = Buffer.from("hashed-password");
      User.findAll.mockResolvedValue([
        { id: 3, salt: Buffer.from("salt"), password: hash },
      ]);
      hashPassword.mockResolvedValue(hash);
      const res = mockRes();

      const result = await authenticate(mockReq(basic("a@b.dev", "pw")), res);

      expect(User.findAll).toHaveBeenCalledWith({ where: { email: "a@b.dev" } });
      expect(hashPassword).toHaveBeenCalledWith("pw", Buffer.from("salt"));
      expect(result).toEqual({ type: "credentials", userId: 3 });
      expect(res.status).not.toHaveBeenCalled();
    });

    it("responds 401 when the password does not match", async () => {
      User.findAll.mockResolvedValue([
        { id: 3, salt: Buffer.from("salt"), password: Buffer.from("stored") },
      ]);
      hashPassword.mockResolvedValue(Buffer.from("different"));
      const res = mockRes();

      await authenticate(mockReq(basic("a@b.dev", "pw")), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Invalid password!" });
    });

    it("responds 401 when no user has the email", async () => {
      User.findAll.mockResolvedValue([]);
      const res = mockRes();

      await authenticate(mockReq(basic("missing@b.dev", "pw")), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "User not found!" });
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it("treats a lookup failure as a missing user", async () => {
      User.findAll.mockRejectedValue(new Error("db down"));
      const res = mockRes();

      await authenticate(mockReq(basic("a@b.dev", "pw")), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "User not found!" });
    });

    it("ignores Basic credentials when token auth is required", async () => {
      const res = mockRes();

      await authenticate(mockReq(basic("a@b.dev", "pw")), res, "token");

      expect(User.findAll).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Authentication required" });
    });
  });

  describe("Bearer token", () => {
    it("returns the token identity for a live session", async () => {
      decrypt.mockResolvedValue("sess-1");
      Session.findAll.mockResolvedValue([
        { id: "sess-1", userId: 8, expirationDate: Date.now() + 100000 },
      ]);
      const res = mockRes();

      const result = await authenticate(mockReq("Bearer tok"), res);

      expect(decrypt).toHaveBeenCalledWith("tok");
      expect(Session.findAll).toHaveBeenCalledWith({ where: { id: "sess-1" } });
      expect(result).toEqual({ type: "token", userId: 8, sessionId: "sess-1" });
      expect(res.status).not.toHaveBeenCalled();
    });

    it("responds 401 when the session has expired", async () => {
      decrypt.mockResolvedValue("sess-1");
      Session.findAll.mockResolvedValue([
        { id: "sess-1", userId: 8, expirationDate: Date.now() - 100000 },
      ]);
      const res = mockRes();

      await authenticate(mockReq("Bearer tok"), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Session has expired." });
    });

    it("responds 401 when no session matches", async () => {
      decrypt.mockResolvedValue("sess-1");
      Session.findAll.mockResolvedValue([]);
      const res = mockRes();

      await authenticate(mockReq("Bearer tok"), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Invalid session" });
    });

    it("treats a lookup failure as an invalid session", async () => {
      decrypt.mockResolvedValue("sess-1");
      Session.findAll.mockRejectedValue(new Error("db down"));
      const res = mockRes();

      await authenticate(mockReq("Bearer tok"), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Invalid session" });
    });

    it("ignores Bearer tokens when credential auth is required", async () => {
      const res = mockRes();

      await authenticate(mockReq("Bearer tok"), res, "credentials");

      expect(decrypt).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ message: "Authentication required" });
    });
  });
});

describe("authenticateRoute", () => {
  it("calls next for a live session", async () => {
    decrypt.mockResolvedValue("sess-1");
    Session.findAll.mockResolvedValue([
      { id: "sess-1", expirationDate: Date.now() + 100000 },
    ]);
    const res = mockRes();
    const next = jest.fn();

    await authenticateRoute(mockReq("Bearer tok"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 401 when the session has expired", async () => {
    decrypt.mockResolvedValue("sess-1");
    Session.findAll.mockResolvedValue([
      { id: "sess-1", expirationDate: Date.now() - 100000 },
    ]);
    const res = mockRes();
    const next = jest.fn();

    await authenticateRoute(mockReq("Bearer tok"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({
      message: "Unauthorized! Expired Token, Logout and Login again",
    });
  });

  it("responds 401 when no session matches", async () => {
    decrypt.mockResolvedValue("sess-1");
    Session.findAll.mockResolvedValue([]);
    const res = mockRes();
    const next = jest.fn();

    await authenticateRoute(mockReq("Bearer tok"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({
      message: "Unauthorized! Expired Token, Logout and Login again",
    });
  });

  it("treats a lookup failure as an unauthorized request", async () => {
    decrypt.mockResolvedValue("sess-1");
    Session.findAll.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    const next = jest.fn();

    await authenticateRoute(mockReq("Bearer tok"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("responds 401 when there is no authorization header", async () => {
    const res = mockRes();
    const next = jest.fn();

    await authenticateRoute(mockReq(null), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ message: "Unauthorized! No Auth Header" });
  });
});
