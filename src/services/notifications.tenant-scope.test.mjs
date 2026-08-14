import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 P0-1. The bulk "mark read" actions issued an UPDATE whose predicate was
// `is_read = false AND (recipient_id = me OR recipient_role = my role)`.
// Role-addressed notifications carried recipient_id IS NULL, so the OR arm
// matched role-addressed rows in EVERY tenant — one user's click mutated other
// universities' notifications. That arm was then bounded by tenant.
//
// CODEX ROUND 4, FINDING 1 removed the arm entirely. A broadcast is no longer a
// shared row: it is fanned out into one row per recipient, `recipient_id` is
// NOT NULL, and the predicate is identity alone. The fixtures below therefore
// model the CURRENT shape — every row is addressed to exactly one profile.
//
// Every cross-tenant property this file has always protected is still asserted.
// One is now STRONGER: a same-tenant, same-role PEER's copy of a broadcast must
// also be untouchable, which the old shared-row model could not even express —
// there was one row for the whole cohort to share.
//
// These are behavior tests: the fake client really evaluates eq/or/in filters
// against fixture rows, so a missing predicate shows up as the wrong row
// flipping to is_read = true, not as a source-string mismatch.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const OBSERVABILITY_LOG_STUB = toDataUrl(
  "export const logEvent = () => {}; export const buildLogRecord = () => ({}); export const classifyPostgresError = () => 'fault';",
);

const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__stage8Client;",
);
const SESSION_SERVICE_STUB = toDataUrl(
  "export const getDemoProfile = async () => globalThis.__stage8Profile;",
);
const CACHE_STUB = toDataUrl(
  "export const revalidatePath = (path) => { globalThis.__stage8Revalidated.push(path); };",
);
const NAVIGATION_STUB = toDataUrl(
  `export const redirect = (path) => {
     const error = new Error("NEXT_REDIRECT:" + path);
     error.digest = "NEXT_REDIRECT";
     throw error;
   };`,
);

const uuidUrl = new URL("../lib/uuid.ts", import.meta.url).href;
// Pure module: point at the REAL file so these tests exercise the real
// ownership predicate rather than a stub of it.
const ownershipUrl = new URL("./notifications.ownership.ts", import.meta.url).href;

let modulesPromise;
function loadActions() {
  modulesPromise ??= (async () => {
    let source = await readFile(new URL("./notifications.actions.ts", import.meta.url), "utf8");
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "next/navigation"', `from ${JSON.stringify(NAVIGATION_STUB)}`],
      ['from "@/lib/uuid"', `from ${JSON.stringify(uuidUrl)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_SERVICE_STUB)}`],
      ['from "@/services/notifications.ownership"', `from ${JSON.stringify(ownershipUrl)}`],
      ['from "@/lib/observability/log"', `from ${JSON.stringify(OBSERVABILITY_LOG_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(
      !compiled.includes('from "@/'),
      "unrewritten alias import remains in notifications.actions.ts",
    );
    return import(toDataUrl(compiled));
  })();
  return modulesPromise;
}

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const STUDENT_A = "11111111-0000-4000-8000-000000000001";
const STUDENT_B = "22222222-0000-4000-8000-000000000002";
const PEER_A = "33333333-0000-4000-8000-000000000003"; // same tenant AND same role as STUDENT_A

// Real UUIDs: the targeted actions run the id through normalizeUuid(), so
// placeholder ids like "n1" would be rejected before any query and a
// cross-tenant test would pass for the wrong reason.
const N1 = "10000000-0000-4000-8000-000000000001"; // mine, direct, tenant A
const N2 = "20000000-0000-4000-8000-000000000002"; // MY copy of a tenant-A broadcast
const N3 = "30000000-0000-4000-8000-000000000003"; // a tenant-B broadcast copy
const N4 = "40000000-0000-4000-8000-000000000004"; // another student, direct, tenant B
const N5 = "50000000-0000-4000-8000-000000000005"; // PEER's copy of the same tenant-A broadcast

function freshRows() {
  return [
    { id: N1, recipient_id: STUDENT_A, recipient_role: "student", school_id: TENANT_A, is_read: false, category: "counseling", target_href: "/dashboard" },
    { id: N2, recipient_id: STUDENT_A, recipient_role: "student", school_id: TENANT_A, is_read: false, category: "counseling", target_href: "/notices" },
    { id: N3, recipient_id: STUDENT_B, recipient_role: "student", school_id: TENANT_B, is_read: false, category: "counseling", target_href: "/secret-other-tenant" },
    { id: N4, recipient_id: STUDENT_B, recipient_role: "student", school_id: TENANT_B, is_read: false, category: "counseling", target_href: "/secret-other-tenant" },
    // Same tenant, same role, different person. Before finding 1 this row could
    // not exist: PEER_A and STUDENT_A shared N2, and therefore shared its
    // is_read. This is the row the redesign exists to create.
    { id: N5, recipient_id: PEER_A, recipient_role: "student", school_id: TENANT_A, is_read: false, category: "counseling", target_href: "/notices" },
  ];
}

// Minimal PostgREST semantics: eq / in, plus or() expressions that may nest
// and(...) groups — e.g. `recipient_id.eq.X,and(recipient_role.eq.Y,school_id.eq.T)`.
// Splitting must respect parentheses, or the nested group is torn apart and the
// test would evaluate a predicate the server never sees.
function splitTopLevel(expression) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of expression) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function makeFakeClient(rows) {
  function evaluateClause(row, clause) {
    const group = /^(and|or)\((.*)\)$/.exec(clause.trim());
    if (group) {
      const [, operator, inner] = group;
      const clauses = splitTopLevel(inner);
      return operator === "and"
        ? clauses.every((c) => evaluateClause(row, c))
        : clauses.some((c) => evaluateClause(row, c));
    }

    const [col, op, ...rest] = clause.trim().split(".");
    const val = rest.join(".");
    if (op === "eq") return String(row[col]) === val;
    if (op === "is") return val === "null" ? row[col] === null : String(row[col]) === val;
    throw new Error(`unsupported or-operator: ${op}`);
  }

  function matches(row, filter) {
    if (filter.kind === "eq") return row[filter.col] === filter.val;
    if (filter.kind === "in") return filter.val.includes(row[filter.col]);
    if (filter.kind === "or") return filter.clauses.some((c) => evaluateClause(row, c));
    throw new Error(`unsupported filter: ${filter.kind}`);
  }

  function builder(patch) {
    const filters = [];
    const api = {
      eq(col, val) {
        filters.push({ kind: "eq", col, val });
        return api;
      },
      in(col, val) {
        filters.push({ kind: "in", col, val });
        return api;
      },
      or(expr) {
        filters.push({ kind: "or", clauses: splitTopLevel(expr) });
        return api;
      },
      select() {
        return api;
      },
      maybeSingle() {
        const found = rows.find((row) => filters.every((f) => matches(row, f)));
        return Promise.resolve({ data: found ?? null, error: null });
      },
      then(resolve, reject) {
        const affected = rows.filter((row) => filters.every((f) => matches(row, f)));
        for (const row of affected) Object.assign(row, patch);
        return Promise.resolve({ data: affected, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    from() {
      return {
        update: (patch) => builder(patch),
        select: () => builder(null),
      };
    },
  };
}

async function runAsTenantA(actionName) {
  const rows = freshRows();
  globalThis.__stage8Client = makeFakeClient(rows);
  globalThis.__stage8Revalidated = [];
  globalThis.__stage8Profile = {
    id: STUDENT_A,
    identifier: "student-a@example.test",
    name: "학생A",
    role: "student",
    school_id: TENANT_A,
    department_id: null,
  };

  const actions = await loadActions();
  if (actionName === "markAllNotificationsRead") {
    await actions.markAllNotificationsRead();
  } else {
    await actions.markNotificationsReadByCategory("counseling");
  }
  return rows;
}

test("markAllNotificationsRead marks only the caller's own rows", async () => {
  const rows = await runAsTenantA("markAllNotificationsRead");
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId[N1].is_read, true, "the caller's own notification should be marked read");
  assert.equal(byId[N2].is_read, true, "the caller's OWN COPY of the broadcast should be marked read");
  assert.equal(
    byId[N5].is_read,
    false,
    "a same-tenant PEER's copy must never be touched — Codex round 4, finding 1",
  );
  assert.equal(byId[N3].is_read, false, "another tenant's broadcast copy must never be touched");
  assert.equal(byId[N4].is_read, false, "another tenant's direct notification must never be touched");
});

test("markNotificationsReadByCategory marks only the caller's own rows", async () => {
  const rows = await runAsTenantA("markNotificationsReadByCategory");
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId[N1].is_read, true, "the caller's own notification should be marked read");
  assert.equal(byId[N2].is_read, true, "the caller's own copy of the broadcast should be marked read");
  assert.equal(byId[N5].is_read, false, "a same-tenant peer's copy must never be touched");
  assert.equal(byId[N3].is_read, false, "another tenant's broadcast copy must never be touched");
  assert.equal(byId[N4].is_read, false, "another tenant's direct notification must never be touched");
});

// --- Review finding 3: the TARGETED (by-id) write paths -------------------
//
// markAllNotificationsRead was fixed first, but markNotificationAsRead and
// markNotificationReadAndGo still bounded their UPDATE with
// `id = <uuid> AND (recipient_id = me OR recipient_role = my role)`. Role
// addressed rows carry recipient_id IS NULL, so knowing (or enumerating) a
// UUID from ANOTHER tenant was enough to mark it read — and
// markNotificationReadAndGo additionally reads and redirects to that row's
// target_href, disclosing it.

async function runTargetedAsTenantA(actionName, notificationId) {
  const rows = freshRows();
  globalThis.__stage8Client = makeFakeClient(rows);
  globalThis.__stage8Revalidated = [];
  globalThis.__stage8Profile = {
    id: STUDENT_A,
    identifier: "student-a@example.test",
    name: "학생A",
    role: "student",
    school_id: TENANT_A,
    department_id: null,
  };

  const actions = await loadActions();
  let redirectedTo = null;
  try {
    if (actionName === "markNotificationAsRead") {
      await actions.markNotificationAsRead(notificationId);
    } else {
      await actions.markNotificationReadAndGo(formDataWith(notificationId));
    }
  } catch (error) {
    if (error?.digest === "NEXT_REDIRECT") {
      redirectedTo = String(error.message).replace("NEXT_REDIRECT:", "");
    } else {
      throw error;
    }
  }
  return { rows, redirectedTo };
}

function formDataWith(notificationId) {
  const form = new FormData();
  form.set("notificationId", notificationId);
  return form;
}

test("markNotificationAsRead cannot mark another tenant's notification by id", async () => {
  const { rows } = await runTargetedAsTenantA("markNotificationAsRead", N3);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(
    byId[N3].is_read,
    false,
    "knowing a foreign tenant's notification UUID must not permit marking it read",
  );
});

test("markNotificationAsRead still marks the caller's own notification", async () => {
  const { rows } = await runTargetedAsTenantA("markNotificationAsRead", N1);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId[N1].is_read, true, "the legitimate path must still work");
});

test("markNotificationAsRead still marks the caller's own copy of a broadcast", async () => {
  const { rows } = await runTargetedAsTenantA("markNotificationAsRead", N2);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId[N2].is_read, true, "the legitimate broadcast path must still work");
  assert.equal(byId[N5].is_read, false, "and it must not reach the peer's copy of the same broadcast");
});

test("markNotificationAsRead cannot mark a SAME-TENANT peer's broadcast copy by id", async () => {
  // Codex round 4, finding 1. The old model had no way to express this: one
  // shared row meant marking it read for yourself marked it for the cohort.
  const { rows } = await runTargetedAsTenantA("markNotificationAsRead", N5);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(
    byId[N5].is_read,
    false,
    "knowing a same-tenant peer's notification UUID must not permit marking it read",
  );
});

test("markNotificationReadAndGo does not disclose or mark another tenant's notification", async () => {
  const { rows, redirectedTo } = await runTargetedAsTenantA("markNotificationReadAndGo", N3);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId[N3].is_read, false, "must not mark a foreign tenant's row read");
  assert.equal(
    redirectedTo,
    "/notifications",
    "must fall back to the list rather than follow a foreign row's target_href",
  );
});
