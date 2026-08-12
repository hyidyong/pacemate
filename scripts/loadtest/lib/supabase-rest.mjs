// Direct PostgREST access with the service-role key, used ONLY by the harness for
// fixture discovery, business-state validation, and cleanup. Never used to
// generate application load — load always goes through the real app.
export function createRestClient({ url, serviceRoleKey }) {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function request(path, init = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`PostgREST ${init.method ?? "GET"} ${path} → ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    select: (table, query = "") => request(`/${table}?${query}`),
    insert: (table, rows, prefer = "return=representation") =>
      request(`/${table}`, {
        method: "POST",
        headers: { Prefer: prefer },
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
