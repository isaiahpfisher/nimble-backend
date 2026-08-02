// The one door onto Nimble's data. What matters here is that a failure says
// something the person reading it can act on: the API's own words when it
// answered, and where we were knocking when it did not.

const { apiClient } = require("../../app/assistant/api");

const url = "http://nimble.test/nimbleapi";

/** Replaces global fetch for one test and puts it back afterwards. */
function stubFetch(impl) {
  const original = global.fetch;
  global.fetch = jest.fn(impl);
  return () => {
    global.fetch = original;
  };
}

describe("reaching the API", () => {
  let restore = () => {};

  afterEach(() => restore());

  it("sends the caller's token and returns the parsed body", async () => {
    restore = stubFetch(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 }));

    const api = apiClient("tok", { url });

    await expect(api("/projects/1")).resolves.toEqual({ id: 1 });
    expect(global.fetch).toHaveBeenCalledWith(
      `${url}/projects/1`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    );
  });

  it("throws with the API's own message when it refuses", async () => {
    restore = stubFetch(
      async () => new Response(JSON.stringify({ message: "Not a member." }), { status: 403 }),
    );

    await expect(apiClient("tok", { url })("/projects/9")).rejects.toThrow("Not a member. (HTTP 403)");
  });

  // "fetch failed" on its own reads like a broken tool and sends people hunting
  // in the wrong place; the usual cause is a backend that is not running
  it("says where it was knocking when nothing answered", async () => {
    restore = stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const failure = apiClient("tok", { url })("/projects/1");

    await expect(failure).rejects.toThrow(url);
    await expect(failure).rejects.toThrow("is the backend running?");
  });
});
