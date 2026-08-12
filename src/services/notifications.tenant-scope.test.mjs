import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 P0-1. The bulk "mark read" actions issue an UPDATE whose predicate is
// `is_read = false AND (recipient_id = me OR recipient_role = my role)`.
// Role-addressed notifications carry recipient_id IS NULL (that is how the
// counseling flow writes them, counseling.actions.ts:142-150), so the OR arm
// matches role-addressed rows in EVERY tenant — one user's click mutates other
// universities' notifications.
//
// These are behavior tests: the fake client really evaluates eq/or/in filters
// against fixture rows, so a missing tenant predicate shows up as a foreign row
// flipping to is_read = true, not as a source-string mismatch.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

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

function freshRows() {
  return [
    { id: "n1", recipient_id: STUDENT_A, recipient_role: "student", school_id: TENANT_A, is_read: false, category: "counseling" },
    { id: "n2", recipient_id: null, recipient_role: "student", school_id: TENANT_A, is_read: false, category: "counseling" },
    { id: "n3", recipient_id: null, recipient_role: "student", school_id: TENANT_B, is_read: false, category: "counseling" },
    { id: "n4", recipient_id: STUDENT_B, recipient_role: "student", school_id: TENANT_B, is_read: false, category: "counseling" },
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

test("markAllNotificationsRead never marks another tenant's notifications read", async () => {
  const rows = await runAsTenantA("markAllNotificationsRead");
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId.n1.is_read, true, "the caller's own notification should be marked read");
  assert.equal(byId.n2.is_read, true, "a role broadcast in the caller's tenant should be marked read");
  assert.equal(
    byId.n3.is_read,
    false,
    "a role broadcast in ANOTHER tenant must never be touched (cross-tenant write)",
  );
  assert.equal(byId.n4.is_read, false, "another tenant's direct notification must never be touched");
});

test("markNotificationsReadByCategory never marks another tenant's notifications read", async () => {
  const rows = await runAsTenantA("markNotificationsReadByCategory");
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId.n1.is_read, true, "the caller's own notification should be marked read");
  assert.equal(byId.n2.is_read, true, "a role broadcast in the caller's tenant should be marked read");
  assert.equal(byId.n3.is_read, false, "a role broadcast in ANOTHER tenant must never be touched");
  assert.equal(byId.n4.is_read, false, "another tenant's direct notification must never be touched");
});
