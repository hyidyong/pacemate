// Bounded-timeout clients for the security probe harness.
//
// Codex finding 1: the harness had no timeout on any network call, so a hung
// PostgREST or GoTrue request could block cleanup indefinitely — the one moment
// a hang is least acceptable, because it leaves fixtures alive in a live
// project. Every request here carries its own deadline and fails loudly.
//
// Kept separate from scripts/loadtest/lib/supabase-rest.mjs on purpose: that
// client is shared with the load harness and its error/`Prefer` semantics are
// depended on there. This one exists to be strict.
//
// Codex round 3: the transport moved to probe-http.mjs so ONE bounded
// implementation covers every probe request, including body consumption.

import { DEFAULT_TIMEOUT_MS, ProbeRequestError, boundedRequest, parseBody } from "./probe-http.mjs";

export { DEFAULT_TIMEOUT_MS, ProbeRequestError };

/** PostgREST with the service-role key. Used for provisioning, verification and cleanup. */
export function createProbeRest({ url, serviceRoleKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  async function request(path, init = {}) {
    const { status, text } = await boundedRequest(
      `${base}${path}`,
      { ...init, headers: { ...headers, ...(init.headers ?? {}) } },
      { timeoutMs, fetchImpl },
    );
    if (status < 200 || status >= 300) {
      throw new ProbeRequestError(`PostgREST ${init.method ?? "GET"} ${path} → ${status}: ${text}`, {
        status,
      });
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    select: (table, query = "") => request(`/${table}?${query}`),
    insert: (table, rows) =>
      request(`/${table}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows),
      }),
    update: (table, query, patch) =>
      request(`/${table}?${query}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      }),
    remove: (table, query) =>
      request(`/${table}?${query}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      }),
    request,
  };
}

/** GoTrue admin API — creating and deleting probe auth users. */
export function createProbeAuthAdmin({ url, serviceRoleKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const base = `${url.replace(/\/$/, "")}/auth/v1/admin`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const call = (path, init) => boundedRequest(`${base}${path}`, { ...init, headers }, { timeoutMs, fetchImpl });

  return {
    async createUser(email, password) {
      const { status, text } = await call("/users", {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (status < 200 || status >= 300) {
        throw new ProbeRequestError(`GoTrue create user → ${status}: ${text}`, { status });
      }
      return parseBody(text);
    },
    async deleteUser(id) {
      const { status, text } = await call(`/users/${id}`, { method: "DELETE" });
      // 404 means the user is already gone, which is the state cleanup wants.
      if ((status < 200 || status >= 300) && status !== 404) {
        throw new ProbeRequestError(`GoTrue delete user → ${status}: ${text}`, { status });
      }
    },
    /**
     * Codex round 3, F1: this used to issue ONE `per_page=200` request, so a
     * project with more than 200 auth users could hide probe residue past the
     * first page and residue verification would report clean. It now paginates
     * to exhaustion, and a page that cannot be read is an error rather than an
     * empty result.
     */
    async listUsersByEmailPrefix(prefix, { perPage = 200, maxPages = 500 } = {}) {
      const matches = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const { status, text } = await call(`/users?page=${page}&per_page=${perPage}`, { method: "GET" });
        if (status < 200 || status >= 300) {
          throw new ProbeRequestError(`GoTrue list users page ${page} → ${status}`, { status });
        }
        const body = parseBody(text);
        const users = Array.isArray(body?.users) ? body.users : [];
        for (const user of users) {
          if (typeof user?.email === "string" && user.email.includes(prefix)) matches.push(user);
        }
        if (users.length < perPage) return matches;
      }
      throw new ProbeRequestError(
        `GoTrue user enumeration did not terminate within ${maxPages} pages; residue cannot be verified`,
      );
    },
  };
}

export function signInFactory({ url, anonKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  return async function signIn(email, password) {
    const { text } = await boundedRequest(
      `${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      { timeoutMs, fetchImpl },
    );
    const body = parseBody(text) ?? {};
    if (!body.access_token) {
      throw new ProbeRequestError(`could not sign in probe user: ${body?.error_description ?? body?.msg ?? "no token"}`);
    }
    return body.access_token;
  };
}
