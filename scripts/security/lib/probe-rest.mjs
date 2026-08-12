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

export const DEFAULT_TIMEOUT_MS = 15_000;

export class ProbeRequestError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = "ProbeRequestError";
    this.status = status;
    if (cause) this.cause = cause;
  }
}

async function fetchWithDeadline(url, init, timeoutMs) {
  const controller = new AbortController();
  // A real AbortError, not a TimeoutError — postgrest-js and undici treat the
  // two differently, and Stage 8 already learned that lesson the hard way.
  const timer = setTimeout(
    () => controller.abort(new DOMException("probe request timed out", "AbortError")),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ProbeRequestError(`request to ${url} exceeded ${timeoutMs}ms`, { cause: error });
    }
    throw new ProbeRequestError(`request to ${url} failed: ${error?.message ?? error}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/** PostgREST with the service-role key. Used for provisioning, verification and cleanup. */
export function createProbeRest({ url, serviceRoleKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const doFetch = fetchImpl ?? ((u, init) => fetchWithDeadline(u, init, timeoutMs));

  async function request(path, init = {}) {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ProbeRequestError(`PostgREST ${init.method ?? "GET"} ${path} → ${res.status}: ${text}`, {
        status: res.status,
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
  const doFetch = fetchImpl ?? ((u, init) => fetchWithDeadline(u, init, timeoutMs));

  return {
    async createUser(email, password) {
      const res = await doFetch(`${base}/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new ProbeRequestError(`GoTrue create user → ${res.status}: ${text}`, { status: res.status });
      }
      return JSON.parse(text);
    },
    async deleteUser(id) {
      const res = await doFetch(`${base}/users/${id}`, { method: "DELETE", headers });
      // 404 means the user is already gone, which is the state cleanup wants.
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new ProbeRequestError(`GoTrue delete user → ${res.status}: ${text}`, { status: res.status });
      }
    },
    async listUsersByEmailPrefix(prefix) {
      const res = await doFetch(`${base}/users?per_page=200`, { method: "GET", headers });
      if (!res.ok) {
        throw new ProbeRequestError(`GoTrue list users → ${res.status}`, { status: res.status });
      }
      const body = JSON.parse(await res.text());
      const users = Array.isArray(body?.users) ? body.users : [];
      return users.filter((user) => typeof user?.email === "string" && user.email.includes(prefix));
    },
  };
}

export function signInFactory({ url, anonKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const doFetch = fetchImpl ?? ((u, init) => fetchWithDeadline(u, init, timeoutMs));
  return async function signIn(email, password) {
    const res = await doFetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = JSON.parse(await res.text());
    if (!body.access_token) {
      throw new ProbeRequestError(`could not sign in probe user: ${body?.error_description ?? body?.msg ?? "no token"}`);
    }
    return body.access_token;
  };
}
