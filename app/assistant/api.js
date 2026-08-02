// The one door the assistant has onto Nimble's data.
//
// Every tool reaches the database the same way the browser does: an HTTP call
// to Nimble's own REST API carrying the caller's bearer token. No tool touches
// a model or a controller directly, so authorization stays in exactly one
// place and a tool can only ever see what its user could see by hand.

const baseUrl = () =>
  process.env.NIMBLE_API_URL || `http://localhost:${process.env.PORT || 3200}/nimbleapi`;

/**
 * A client bound to one user: `api("/projects/1")`, `api("/sprints", { method: "POST", body })`.
 *
 * A non-2xx throws, carrying the API's own message. Tool bodies therefore read
 * top to bottom, and the registry turns the throw into a result the model can
 * read and correct.
 */
function apiClient(token, { url = baseUrl() } = {}) {
  return async function api(path, { method = "GET", body } = {}) {
    const hasBody = body !== undefined;

    let response;
    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(hasBody && { "Content-Type": "application/json" }),
        },
        ...(hasBody && { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // A connection that never opened is almost always the API not running.
      // Node reports that as a bare "fetch failed", which reads like a bug in
      // the tool rather than a server that is not there, so say where we were
      // trying to reach and what would explain it.
      throw new Error(
        `Could not reach Nimble's API at ${url} — is the backend running? (${cause.message})`,
        { cause },
      );
    }

    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON; the raw text is the best message we have */
    }

    if (!response.ok) {
      throw new Error(`${payload?.message ?? text ?? "Request failed"} (HTTP ${response.status})`);
    }

    return payload;
  };
}

module.exports = { apiClient };
