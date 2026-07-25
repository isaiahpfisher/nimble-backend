// crypto.js reads process.env.SECRET_KEY into a Buffer at module load, and
// aes-256-gcm needs exactly 32 key bytes — set one before requiring it.
process.env.SECRET_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);

const crypto = require("../../app/authentication/crypto");

describe("getSalt", () => {
  it("resolves to a Buffer of the configured salt size", async () => {
    const salt = await crypto.getSalt();
    expect(Buffer.isBuffer(salt)).toBe(true);
    expect(salt.length).toBe(crypto.saltSize);
  });

  it("returns a different value each call", async () => {
    const [a, b] = await Promise.all([crypto.getSalt(), crypto.getSalt()]);
    expect(a.equals(b)).toBe(false);
  });
});

describe("hashPassword", () => {
  it("resolves to a Buffer of the configured key size", async () => {
    const salt = await crypto.getSalt();
    const hash = await crypto.hashPassword("hunter2", salt);
    expect(Buffer.isBuffer(hash)).toBe(true);
    expect(hash.length).toBe(crypto.keySize);
  });

  it("is deterministic for the same password and salt", async () => {
    const salt = await crypto.getSalt();
    const a = await crypto.hashPassword("hunter2", salt);
    const b = await crypto.hashPassword("hunter2", salt);
    expect(a.equals(b)).toBe(true);
  });

  it("produces different hashes for different salts", async () => {
    const [s1, s2] = await Promise.all([crypto.getSalt(), crypto.getSalt()]);
    const a = await crypto.hashPassword("hunter2", s1);
    const b = await crypto.hashPassword("hunter2", s2);
    expect(a.equals(b)).toBe(false);
  });

  it("produces different hashes for different passwords", async () => {
    const salt = await crypto.getSalt();
    const a = await crypto.hashPassword("hunter2", salt);
    const b = await crypto.hashPassword("hunter3", salt);
    expect(a.equals(b)).toBe(false);
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips an object", async () => {
    const value = { userId: 42, role: "manager" };
    const token = await crypto.encrypt(value);
    expect(typeof token).toBe("string");
    await expect(crypto.decrypt(token)).resolves.toEqual(value);
  });

  it("round-trips primitive JSON values", async () => {
    for (const value of ["a string", 7, true, null]) {
      const token = await crypto.encrypt(value);
      await expect(crypto.decrypt(token)).resolves.toEqual(value);
    }
  });

  it("produces a different token each time (random IV)", async () => {
    const a = await crypto.encrypt({ id: 1 });
    const b = await crypto.encrypt({ id: 1 });
    expect(a).not.toBe(b);
    await expect(crypto.decrypt(a)).resolves.toEqual({ id: 1 });
    await expect(crypto.decrypt(b)).resolves.toEqual({ id: 1 });
  });

  it("rejects a token that is too short to hold an IV and tag", async () => {
    await expect(crypto.decrypt("YWJj")).rejects.toBeDefined();
  });

  it("rejects a tampered token", async () => {
    const token = await crypto.encrypt({ id: 1 });
    // Flip the final base64 char to corrupt the ciphertext/tag.
    const tampered =
      token.slice(0, -2) + (token.slice(-2, -1) === "A" ? "B" : "A") + token.slice(-1);
    await expect(crypto.decrypt(tampered)).rejects.toBeDefined();
  });
});
