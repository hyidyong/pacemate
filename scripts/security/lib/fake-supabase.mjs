// A tiny in-memory stand-in for PostgREST + GoTrue admin, used ONLY by the
// probe harness's own subprocess tests.
//
// Codex round 3, F1 asked for tests that exercise the actual runner process
// rather than its helpers. Driving the real `rls-probe.mjs` needs something for
// it to talk to, and it must be able to misbehave on demand: stall before
// headers, stall halfway through a body, refuse a delete, hide residue, or hold
// more auth users than a single page.
//
// This is deliberately NOT an RLS simulator. These tests are about the runner's
// LIFECYCLE — deadlines, signals, cleanup, residue, exit codes — so the security
// assertions the runner makes against this fake are meaningless and are ignored.

import { createServer } from "node:http";

export const SCENARIOS = {
  normal: "normal",
  stallBeforeHeaders: "stall-before-headers",
  stallMidBody: "stall-mid-body",
  refuseDelete: "refuse-delete",
  hideResidue: "hide-residue",
  manyAuthUsers: "many-auth-users",
  // Codex round 4, 4C. The create COMMITS but the response never arrives, so
  // the client times out and the ledger never learns the row's id. Only the
  // marker sweep can find it.
  ambiguousCreate: "ambiguous-create",
};

// Codex round 5, F6: predicates are now `like.<runMarker>%25` — a PREFIX match
// with a URL-encoded wildcard. The stand-in must model that, or it would keep
// answering the old substring semantics and the tests would pass against
// behaviour the real database no longer has.
function likeMatches(value, raw) {
  if (typeof value !== "string") return false;
  // The caller may hand us either the raw query text or an already-decoded
  // value, depending on whether a URL parser has been through it. Decoding a
  // decoded string throws URIError on a bare `%`, so fall back rather than
  // crash the stand-in.
  let pattern;
  try {
    pattern = decodeURIComponent(raw);
  } catch {
    pattern = raw;
  }
  pattern = pattern.replaceAll("*", "%");
  if (pattern.endsWith("%")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function matchRow(row, query) {
  for (const [key, raw] of query.entries()) {
    if (["select", "limit", "offset", "order", "page", "per_page"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    const actual = row[key];
    if (op === "eq") {
      if (String(actual ?? "") !== decodeURIComponent(value)) return false;
    } else if (op === "like") {
      if (!likeMatches(actual, value)) return false;
    } else if (op === "in") {
      const list = value.replace(/^\(|\)$/g, "").split(",");
      if (!list.includes(String(actual ?? ""))) return false;
    } else if (op === "is") {
      if (value === "null" && actual != null) return false;
    }
  }
  return true;
}

export async function startFakeSupabase({ scenario = SCENARIOS.normal, authUserCount = 0 } = {}) {
  const tables = new Map();
  const authUsers = new Map();
  const authSecrets = new Map();
  let seq = 0;

  // Pre-seed unrelated auth users so probe users land beyond the first page.
  for (let i = 0; i < authUserCount; i += 1) {
    const id = `seed-${i}`;
    authUsers.set(id, { id, email: `seed-${i}@example.test` });
  }

  const rowsOf = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, payload) => {
      const body = payload === undefined ? "" : JSON.stringify(payload);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(body);
    };

    // Never respond at all: exercises the connect/headers half of the deadline.
    if (scenario === SCENARIOS.stallBeforeHeaders && url.pathname.includes("/rest/v1/departments")) {
      return; // socket held open, no headers
    }
    // Headers, then a body that never completes: this is the case the old
    // transport could not bound, because it cleared the timer once fetch()
    // resolved.
    if (scenario === SCENARIOS.stallMidBody && url.pathname.includes("/rest/v1/departments")) {
      res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      res.write('[{"id":"partial"');
      return; // never finished
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : null;

    // ---- GoTrue admin ----
    if (url.pathname === "/auth/v1/admin/users") {
      if (req.method === "POST") {
        const id = `auth-${++seq}`;
        authUsers.set(id, { id, email: payload.email });
        authSecrets.set(payload.email, payload.password);
        return send(200, { id, email: payload.email });
      }
      const perPage = Number(url.searchParams.get("per_page") ?? 50);
      const page = Number(url.searchParams.get("page") ?? 1);
      const all = [...authUsers.values()];
      const slice = all.slice((page - 1) * perPage, page * perPage);
      return send(200, { users: slice });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      const id = url.pathname.split("/").pop();
      const email = authUsers.get(id)?.email;
      authUsers.delete(id);
      if (email) authSecrets.delete(email);
      return send(200, {});
    }
    if (url.pathname === "/auth/v1/token") {
      if (!payload?.email || authSecrets.get(payload.email) !== payload.password) {
        return send(400, { error_description: "invalid probe credentials" });
      }
      return send(200, { access_token: `token-${Math.random().toString(36).slice(2)}` });
    }

    // ---- PostgREST RPC ----
    // An RPC is a function call, not a table. Without this the stand-in
    // happily created rows in a pseudo-table called "rpc/<name>" and the
    // teardown assertion then reported residue that does not exist in reality.
    // The stand-in is not a database, so it answers the safest thing a real
    // transition can answer: nothing happened.
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      return send(200, { outcome: "stale" });
    }

    // ---- PostgREST ----
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.replace("/rest/v1/", "");
      const rows = rowsOf(table);

      if (req.method === "POST") {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const created = incoming.map((row) => ({ ...row, id: row.id ?? `${table}-${++seq}` }));
        rows.push(...created);
        if (scenario === SCENARIOS.ambiguousCreate && table === "counseling_requests") {
          // Committed server-side, but the caller never finds out. This is the
          // case the ledger structurally cannot cover: it has no id to record.
          return; // never respond
        }
        return send(201, created);
      }
      if (req.method === "GET") {
        // Pretend the residue query finds nothing, while the rows are really
        // still there — a false-clean the tests must catch.
        if (scenario === SCENARIOS.hideResidue) return send(200, []);
        return send(200, rows.filter((row) => matchRow(row, url.searchParams)));
      }
      if (req.method === "PATCH") {
        const hits = rows.filter((row) => matchRow(row, url.searchParams));
        for (const row of hits) Object.assign(row, payload);
        return send(200, hits);
      }
      if (req.method === "DELETE") {
        if (scenario === SCENARIOS.refuseDelete && table === "courses") {
          return send(409, { message: "injected delete failure" });
        }
        const hits = rows.filter((row) => matchRow(row, url.searchParams));
        tables.set(table, rows.filter((row) => !hits.includes(row)));
        return send(200, hits);
      }
    }

    send(404, { message: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    tables,
    authUsers,
    // Tests inspect and seed individual tables (Codex round 4, 4C).
    rowsOf,
    totalRows() {
      let n = 0;
      for (const rows of tables.values()) n += rows.length;
      return n;
    },
    probeAuthUsers(marker) {
      return [...authUsers.values()].filter((u) => u.email?.includes(marker));
    },
    async close() {
      // Drop stalled sockets FIRST — the stall scenarios deliberately hold
      // connections open, and awaiting close() before dropping them made the
      // suite wait on them.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
