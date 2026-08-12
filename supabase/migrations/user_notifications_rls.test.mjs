import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Stage 8 review finding 3. The live behaviour is verified by
// scripts/verify-notification-rls.mjs against a real JWT (recorded in the
// handoff). This guard freezes the migration's SHAPE so the properties that
// verification proved cannot silently regress in the repository — e.g. someone
// re-adding a blanket policy, widening the roles, or reintroducing the KI-007
// auth.uid()-vs-profiles.id identity confusion.

const MIGRATION = new URL("./20260813030000_user_notifications_rls.sql", import.meta.url);

let sourcePromise;
function loadSource() {
  sourcePromise ??= readFile(MIGRATION, "utf8");
  return sourcePromise;
}

test("the blanket demo policies are dropped", async () => {
  const sql = await loadSource();
  assert.match(sql, /drop policy if exists "demo read notifications"/i);
  assert.match(sql, /drop policy if exists "demo update notifications"/i);
});

test("SELECT and UPDATE policies are scoped to authenticated only", async () => {
  const sql = await loadSource();

  const selectPolicy = /create policy[\s\S]*?for select\s+to (\w+)/i.exec(sql);
  assert.ok(selectPolicy, "a SELECT policy must exist");
  assert.equal(selectPolicy[1], "authenticated", "anon must have no SELECT policy (default deny)");

  const updatePolicy = /create policy[\s\S]*?for update\s+to (\w+)/i.exec(sql);
  assert.ok(updatePolicy, "an UPDATE policy must exist");
  assert.equal(updatePolicy[1], "authenticated", "anon must have no UPDATE policy (default deny)");
});

test("identity is resolved through profiles.auth_user_id, never profiles.id", async () => {
  const sql = await loadSource();

  assert.match(
    sql,
    /p\.auth_user_id = auth\.uid\(\)/,
    "the profile must be found via auth_user_id — comparing auth.uid() to profiles.id is the KI-007 defect",
  );
  assert.doesNotMatch(
    sql,
    /p\.id\s*=\s*auth\.uid\(\)/,
    "must not reintroduce the auth.uid() = profiles.id confusion",
  );
});

test("role broadcasts require a matching tenant and reject NULL school_id", async () => {
  const sql = await loadSource();

  assert.match(sql, /recipient_id is null/i, "the role-broadcast arm must require recipient_id IS NULL");
  assert.match(sql, /school_id is not null/i, "an undirected row must not match — NULL school_id is not global");
  assert.match(
    sql,
    /school_id = \(select p\.school_id from public\.profiles p where p\.auth_user_id = auth\.uid\(\)\)/,
    "the role-broadcast arm must be tenant-scoped",
  );
});

test("the UPDATE policy carries a WITH CHECK so rows cannot be re-addressed", async () => {
  const sql = await loadSource();
  const updateBlock = sql.slice(sql.search(/for update/i));
  assert.match(
    updateBlock,
    /with check/i,
    "without WITH CHECK a caller could move a row into another tenant during an update",
  );
});

test("INSERT is deliberately left alone so sessionless creation keeps working", async () => {
  const sql = await loadSource();
  assert.doesNotMatch(
    sql,
    /drop policy if exists "demo create notifications"/i,
    "notifications are created through the session client, which is anon for the sessionless /support flow",
  );
});
