// Codex round 4, finding 2 — only a student may publish a course review.
//
// `/reviews` has always been gated by `redirectNonStudent`, so the product has
// always said reviews are student experience. Nothing below the route agreed:
// the INSERT policy checked authorship and tenancy, and the server action
// checked only that a session existed. A route guard is not an authorization
// boundary — a server action runs before any page renders, and PostgREST is
// reachable directly with the publishable key.
//
// Proven live before the fix: professor, assistant and admin each posted a
// same-tenant, self-authored review and got 201 with the row persisted.
//
// These tests drive the REAL action against a fake client, so a role that slips
// through shows up as a row reaching the database rather than as a string
// mismatch. The database half is asserted against the migration.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__reviewClient;",
);
const SESSION_STUB = toDataUrl("export const getDemoProfile = async () => globalThis.__reviewProfile;");
const CACHE_STUB = toDataUrl("export const revalidatePath = () => {};");

let modulePromise;
async function loadActions() {
  modulePromise ??= (async () => {
    let source = readFileSync(
      fileURLToPath(new URL("./reviews.actions.ts", import.meta.url)),
      "utf8",
    );
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
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

const COURSE = "44444444-4444-4444-8444-444444444444";
const TENANT = "55555555-5555-4555-8555-555555555555";

function install(role) {
  globalThis.__reviewInserts = [];
  globalThis.__reviewProfile = role === null
    ? null
    : { id: "profile-1", name: "사용자", role, school_id: TENANT };
  globalThis.__reviewClient = {
    from() {
      return {
        insert(row) {
          globalThis.__reviewInserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function form() {
  const data = new FormData();
  data.set("courseId", COURSE);
  data.set("content", "이 과목은 과제가 많지만 배우는 것이 확실히 많았습니다.");
  data.set("difficulty", "4");
  data.set("workload", "5");
  data.set("gradingStyle", "상대평가");
  data.set("teamProject", "true");
  return data;
}

test("a STUDENT can publish a course review (legitimate path)", async () => {
  const { createCourseReview } = await loadActions();
  install("student");

  const result = await createCourseReview(form());

  assert.equal(result.ok, true, result.message);
  assert.equal(globalThis.__reviewInserts.length, 1);
  assert.equal(globalThis.__reviewInserts[0].course_id, COURSE);
  assert.equal(globalThis.__reviewInserts[0].author_id, "profile-1", "the author is the caller");
});

for (const role of ["professor", "assistant", "admin"]) {
  test(`a ${role} is REFUSED and nothing is persisted`, async () => {
    const { createCourseReview } = await loadActions();
    install(role);

    const result = await createCourseReview(form());

    assert.equal(result.ok, false, `${role} must not publish a student review`);
    assert.equal(globalThis.__reviewInserts.length, 0, "no row may reach the database");
  });
}

test("an unauthenticated caller is still refused", async () => {
  const { createCourseReview } = await loadActions();
  install(null);

  const result = await createCourseReview(form());

  assert.equal(result.ok, false);
  assert.equal(globalThis.__reviewInserts.length, 0);
});

test("the author is taken from the session, never from the form", async () => {
  const { createCourseReview } = await loadActions();
  install("student");

  const data = form();
  data.set("author_id", "99999999-9999-4999-8999-999999999999");
  data.set("authorId", "99999999-9999-4999-8999-999999999999");
  await createCourseReview(data);

  assert.equal(globalThis.__reviewInserts[0].author_id, "profile-1");
});

test("the DATABASE enforces the same rule, so the action is not the only gate", () => {
  const migration = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260814160000_stage9_reviews_student_only.sql", import.meta.url)),
    "utf8",
  );
  const sql = migration
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.match(sql, /app_private\.current_user_role\(\) = 'student'/);
  // The terms the previous policy already had must survive alongside it.
  assert.match(sql, /author_id = app_private\.current_profile_id\(\)/);
  assert.match(sql, /c\.school_id = app_private\.current_school_id\(\)/);
  // And the migration must fail closed rather than silently apply a weaker rule.
  assert.match(sql, /postcondition failed: the INSERT policy does not constrain the caller role/);
});

test("the legitimate student EDIT path is not collaterally broken", () => {
  const migration = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260814160000_stage9_reviews_student_only.sql", import.meta.url)),
    "utf8",
  );
  // Only the INSERT policy is replaced. A postcondition proves the author's
  // UPDATE policy is still present and still bound to the caller.
  assert.match(migration, /postcondition failed: the author UPDATE policy is missing or unbound/);
  assert.doesNotMatch(
    migration.split(/\r?\n/).filter((l) => !l.trimStart().startsWith("--")).join("\n"),
    /drop policy if exists "authors update own course reviews"/,
  );
});

test("no enrolment requirement was invented", () => {
  // The review was explicit: enrolment eligibility is a product decision, and
  // repository evidence does not require it. A security fix must not smuggle
  // one in.
  const migration = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260814160000_stage9_reviews_student_only.sql", import.meta.url)),
    "utf8",
  );
  const sql = migration
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(sql, /student_courses/, "no enrolment predicate belongs in this policy");
});
