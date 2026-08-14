// Codex round 5, F2 + F3 — authorization for actions that write with the
// service role.
//
// Both findings are the same mistake in two places: a check that establishes
// WHAT the caller is, followed by a privileged write that trusts WHAT THE
// CALLER SENT. The service role bypasses RLS, so nothing downstream re-asks.
//
//   F2  removeCourseAssignment checked `role === "professor"` and then used the
//       caller's own courseId. A Tenant A professor could name a Tenant B
//       course, or an unassigned course in their own tenant.
//   F3  submitRoadmapFeedback required a session and checked the course tenant,
//       but never the role — so staff could file a report stored and shown as
//       "학생 익명 제보", an anonymous STUDENT report, which pages every admin.
//
// These drive the REAL actions against fakes that record every write, so a
// denial that still writes shows up as a recorded row rather than as a message
// mismatch.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const ADMIN_STUB = toDataUrl("export const createSupabaseAdminClient = () => globalThis.__privClient;");
const SESSION_STUB = toDataUrl("export const getDemoProfile = async () => globalThis.__privProfile;");
const CACHE_STUB = toDataUrl("export const revalidatePath = () => {};");
const NOTIFY_STUB = toDataUrl(`
  export const createUserNotification = async (n) => { globalThis.__privNotifications.push(n); return { ok: true }; };
  export const createUserNotifications = async (n) => { globalThis.__privNotifications.push(...n); return { ok: true }; };
  export const createUserNotificationsWithClient = async (_c, n) => { globalThis.__privNotifications.push(...n); return { ok: true }; };
`);

const cache = new Map();
async function load(file, extraRewrites = []) {
  if (cache.has(file)) return cache.get(file);
  let source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
  for (const [from, to] of [
    ['"use server";', ""],
    ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
    ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
    ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
    ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFY_STUB)}`],
    ...extraRewrites,
  ]) {
    source = source.split(from).join(to);
  }
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  assert.ok(!compiled.includes('from "@/'), `unrewritten alias import in ${file}`);
  const mod = await import(toDataUrl(compiled));
  cache.set(file, mod);
  return mod;
}

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PROF_PROFILE = "11111111-0000-4000-8000-000000000001";
const PROF_ID = "22222222-0000-4000-8000-000000000002";
const OWN_COURSE = "33333333-0000-4000-8000-000000000003";
const UNASSIGNED_SAME_TENANT = "44444444-0000-4000-8000-000000000004";
const FOREIGN_COURSE = "55555555-0000-4000-8000-000000000005";
const MISSING_COURSE = "66666666-0000-4000-8000-000000000006";

const COURSES = {
  [OWN_COURSE]: { id: OWN_COURSE, school_id: TENANT_A, name: "내 과목" },
  [UNASSIGNED_SAME_TENANT]: { id: UNASSIGNED_SAME_TENANT, school_id: TENANT_A, name: "남의 과목" },
  [FOREIGN_COURSE]: { id: FOREIGN_COURSE, school_id: TENANT_B, name: "타 대학 과목" },
};

/** Records every write; only OWN_COURSE is assigned to PROF_ID. */
function createWorld() {
  const writes = [];
  const client = {
    from(table) {
      const filters = {};
      const api = {
        select: () => api,
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        in: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle() {
          if (table === "courses") return Promise.resolve({ data: COURSES[filters.id] ?? null, error: null });
          if (table === "professors") {
            return Promise.resolve({
              data: filters.profile_id === PROF_PROFILE ? { id: PROF_ID } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          return api.maybeSingle();
        },
        insert(row) {
          writes.push({ table, row });
          const result = { data: { id: "written" }, error: null };
          const chain = {
            select: () => chain,
            single: () => Promise.resolve(result),
            maybeSingle: () => Promise.resolve(result),
            then: (resolve) => Promise.resolve(result).then(resolve),
          };
          return chain;
        },
        then(resolve) {
          // Assignment lookups: only OWN_COURSE belongs to this professor.
          if (table === "course_professors" || table === "course_offerings") {
            const assigned = filters.course_id === OWN_COURSE && filters.professor_id === PROF_ID;
            return Promise.resolve({ data: assigned ? [{ course_id: OWN_COURSE }] : [], error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  return { writes, client };
}

function install(role, schoolId = TENANT_A) {
  const world = createWorld();
  globalThis.__privClient = world.client;
  globalThis.__privProfile = { id: PROF_PROFILE, name: "교수", role, school_id: schoolId };
  globalThis.__privNotifications = [];
  return world;
}

function removalForm(courseId) {
  const form = new FormData();
  form.set("courseId", courseId);
  return form;
}

// ---------------------------------------------------------------- F2 matrix

test("F2 — a professor CAN request removal of their OWN assigned course", async () => {
  const { removeCourseAssignment } = await load("course-settings.actions.ts");
  const world = install("professor");

  const result = await removeCourseAssignment(removalForm(OWN_COURSE));

  assert.match(result.message, /전송되었습니다/, result.message);
  const revisions = world.writes.filter((w) => w.table === "roadmap_revision_requests");
  assert.equal(revisions.length, 1, "the legitimate path must still write");
  assert.equal(revisions[0].row.course_id, OWN_COURSE, "and must write the VERIFIED id");
});

for (const [label, courseId] of [
  ["an UNASSIGNED course in their own tenant", UNASSIGNED_SAME_TENANT],
  ["a course in ANOTHER tenant", FOREIGN_COURSE],
  ["a course that does not exist", MISSING_COURSE],
]) {
  test(`F2 — a professor is REFUSED for ${label}, and NOTHING is written`, async () => {
    const { removeCourseAssignment } = await load("course-settings.actions.ts");
    const world = install("professor");

    const result = await removeCourseAssignment(removalForm(courseId));

    assert.match(result.message, /담당하고 있는 과목만/, result.message);
    assert.deepEqual(world.writes, [], "a denied call must perform ZERO privileged writes");
  });
}

test("F2 — all three privileged course actions go through the same check", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./course-settings.actions.ts", import.meta.url)),
    "utf8",
  );
  const code = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

  // One helper, three callers — so a future action cannot answer the question
  // differently by accident.
  const calls = code.match(/authorizeProfessorCourse\(admin, profile, courseId\)/g) ?? [];
  assert.equal(calls.length, 3, `expected 3 authorization calls, found ${calls.length}`);

  // The helper must check BOTH tenant and assignment.
  const helper = code.slice(code.indexOf("async function authorizeProfessorCourse"));
  assert.match(helper, /course\.school_id !== profile\.school_id/, "tenant term missing");
  assert.match(helper, /course_professors/, "assignment term missing");
  assert.match(helper, /course_offerings/, "offering term missing");

  // And every privileged write must use the VERIFIED id, never the raw input.
  assert.doesNotMatch(code, /course_id: courseId,/, "a raw caller-supplied id still reaches a write");
});

// ---------------------------------------------------------------- F3 matrix

function feedbackForm() {
  const form = new FormData();
  form.set("courseId", OWN_COURSE);
  form.set("courseCode", "CS101");
  form.set("courseName", "자료구조");
  form.set("reason", "선수과목 정보가 실제 수강 안내와 다릅니다.");
  return form;
}

test("F3 — a STUDENT can submit roadmap feedback (legitimate path)", async () => {
  const { submitRoadmapFeedback } = await load("roadmap-feedback.actions.ts");
  const world = install("student");

  const result = await submitRoadmapFeedback(feedbackForm());

  assert.equal(result.ok, true, result.message);
  assert.equal(
    world.writes.filter((w) => w.table === "roadmap_revision_requests").length,
    1,
    "the student path must still create the report",
  );
});

for (const role of ["professor", "assistant", "admin"]) {
  test(`F3 — a ${role} is REFUSED and creates ZERO revision rows`, async () => {
    const { submitRoadmapFeedback } = await load("roadmap-feedback.actions.ts");
    const world = install(role);

    const result = await submitRoadmapFeedback(feedbackForm());

    assert.equal(result.ok, false, `${role} must not file a student report`);
    assert.match(result.message, /학생만/);
    assert.deepEqual(world.writes, [], "no privileged write may occur");
    assert.deepEqual(globalThis.__privNotifications, [], "and no admin may be paged");
  });
}

test("F3 — the tenant check survives the new role check", async () => {
  const { submitRoadmapFeedback } = await load("roadmap-feedback.actions.ts");
  // A student whose tenant does not match the course's.
  const world = install("student", TENANT_B);

  const result = await submitRoadmapFeedback(feedbackForm());

  assert.equal(result.ok, false, "a course in another tenant must still be refused");
  assert.deepEqual(world.writes, []);
});
