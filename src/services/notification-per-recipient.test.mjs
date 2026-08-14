// Codex round 4, finding 1 — notification read state is per recipient.
//
// A role broadcast used to be ONE row with `recipient_id = NULL` shared by every
// holder of that role in the tenant. `is_read` is a column on the row, so the
// first reader marked it read for everyone. Measured live before the fix: 14
// shared rows, 12 of them already flipped to read.
//
// The fix expands a broadcast into one row per recipient at the single creation
// chokepoint, and `recipient_id` is NOT NULL (20260814150000). These tests drive
// the REAL service against a fake Supabase client, so they exercise the
// expansion rather than asserting on its source text.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const UUID_STUB = toDataUrl(`
  export const normalizeUuid = (value) =>
    typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value.trim()) ? value.trim() : "";
`);
const ADMIN_STUB = toDataUrl("export const createSupabaseAdminClient = () => globalThis.__notifyClient;");

let modulePromise;
async function loadService() {
  modulePromise ??= (async () => {
    let source = readFileSync(
      fileURLToPath(new URL("./notifications.create.service.ts", import.meta.url)),
      "utf8",
    );
    for (const [from, to] of [
      ['import "server-only";', ""],
      ['from "@/lib/uuid"', `from ${JSON.stringify(UUID_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['import type { SupabaseClient } from "@supabase/supabase-js";', ""],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import");
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const uuid = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

/** A fake holding a profile directory and collecting inserted notification rows. */
function createWorld(profiles) {
  const inserted = [];
  const client = {
    from(table) {
      if (table === "profiles") {
        const filters = {};
        const api = {
          select: () => api,
          eq(column, value) {
            filters[column] = value;
            return api;
          },
          in(column, values) {
            filters[`${column}__in`] = values;
            return api;
          },
          then(resolve) {
            const rows = profiles.filter((p) =>
              (filters.role === undefined || p.role === filters.role) &&
              (filters.school_id === undefined || p.school_id === filters.school_id) &&
              (filters.id__in === undefined || filters.id__in.includes(p.id)));
            resolve({ data: rows.map((p) => ({ id: p.id, school_id: p.school_id })), error: null });
          },
        };
        return api;
      }
      return {
        insert(rows) {
          inserted.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { inserted, client };
}

const STUDENTS = [
  { id: uuid(1), role: "student", school_id: TENANT },
  { id: uuid(2), role: "student", school_id: TENANT },
  { id: uuid(3), role: "student", school_id: OTHER_TENANT },
];
const ADMINS = [{ id: uuid(4), role: "admin", school_id: TENANT }];
const DIRECTORY = [...STUDENTS, ...ADMINS];

const broadcast = (role, schoolId) => ({
  category: "system",
  recipientRole: role,
  recipientId: null,
  schoolId,
  title: "공지",
  body: "본문",
  targetHref: "/notifications",
});

test("a role broadcast becomes ONE ROW PER RECIPIENT, never a shared row", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(DIRECTORY);

  const result = await createUserNotificationsWithClient(world.client, [broadcast("student", TENANT)]);

  assert.equal(result.ok, true);
  assert.equal(world.inserted.length, 2, "both same-tenant students must get their own row");
  assert.deepEqual(
    world.inserted.map((row) => row.recipient_id).sort(),
    [STUDENTS[0].id, STUDENTS[1].id].sort(),
  );
  // The defect, stated as an assertion: no row may be addressed to nobody.
  assert.equal(
    world.inserted.filter((row) => row.recipient_id === null).length,
    0,
    "a NULL recipient is a row whose read state is shared",
  );
});

test("fan-out does not cross the tenant boundary", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(DIRECTORY);

  await createUserNotificationsWithClient(world.client, [broadcast("student", TENANT)]);

  assert.ok(
    !world.inserted.some((row) => row.recipient_id === STUDENTS[2].id),
    "the other tenant's student must not receive it",
  );
  for (const row of world.inserted) assert.equal(row.school_id, TENANT);
});

test("fan-out respects the role, so a student broadcast never reaches an admin", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(DIRECTORY);

  await createUserNotificationsWithClient(world.client, [broadcast("student", TENANT)]);

  assert.ok(!world.inserted.some((row) => row.recipient_id === ADMINS[0].id));
});

test("a direct notification is untouched by the expansion", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(DIRECTORY);

  const result = await createUserNotificationsWithClient(world.client, [
    { ...broadcast("student", TENANT), recipientId: STUDENTS[0].id },
  ]);

  assert.equal(result.ok, true);
  assert.equal(world.inserted.length, 1, "one input, one row");
  assert.equal(world.inserted[0].recipient_id, STUDENTS[0].id);
});

test("a mixed batch expands only the broadcast", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(DIRECTORY);

  await createUserNotificationsWithClient(world.client, [
    { ...broadcast("student", TENANT), recipientId: STUDENTS[2].id },
    broadcast("admin", TENANT),
  ]);

  assert.equal(world.inserted.length, 2, "1 direct + 1 admin in the tenant");
  assert.equal(world.inserted[0].recipient_id, STUDENTS[2].id);
  assert.equal(world.inserted[1].recipient_id, ADMINS[0].id);
});

test("a broadcast with NO eligible recipient FAILS rather than vanishing", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(STUDENTS); // no admin anywhere

  const result = await createUserNotificationsWithClient(world.client, [broadcast("admin", TENANT)]);

  assert.equal(result.ok, false, "the caller asked for a notification and got none");
  assert.equal(world.inserted.length, 0);
});

test("a broadcast with no tenant is REFUSED, not sent platform-wide", async () => {
  const { createUserNotificationsWithClient } = await loadService();
  const world = createWorld(DIRECTORY);

  const result = await createUserNotificationsWithClient(world.client, [
    { ...broadcast("student", TENANT), schoolId: null },
  ]);

  assert.equal(result.ok, false);
  assert.equal(world.inserted.length, 0, "nothing may be written without a tenant");
});

test("the ownership predicate is identity alone — no role branch survives", async () => {
  const source = readFileSync(
    fileURLToPath(new URL("./notifications.ownership.ts", import.meta.url)),
    "utf8",
  );
  // Compare the CODE, not the header comment, which legitimately quotes the
  // predicate it replaced.
  const code = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("/*") && !trimmed.startsWith("//");
    })
    .join("\n");

  assert.match(code, /recipient_id\.eq\.\$\{profile\.id\}/);
  assert.doesNotMatch(code, /recipient_role/, "a role branch matches a peer's row");
  assert.doesNotMatch(code, /school_id/, "the tenant term existed only to bound the role branch");
});

test("the migration makes the shared row unrepresentable, not merely unused", () => {
  const migration = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260814150000_stage9_notification_per_recipient.sql", import.meta.url)),
    "utf8",
  );
  const sql = migration
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.match(sql, /alter column recipient_id set not null/i);
  assert.match(sql, /using \(recipient_id = app_private\.current_profile_id\(\)\)/i);
  // The backfill must run BEFORE the NOT NULL, or the migration would fail on
  // live data instead of migrating it.
  assert.ok(
    sql.indexOf("insert into public.user_notifications") <
      sql.indexOf("set not null"),
    "existing shared rows must be fanned out before the column is tightened",
  );
  // Postcondition, not just intent.
  assert.match(sql, /postcondition failed: user_notifications\.recipient_id is still nullable/);
});
