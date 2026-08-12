// Disposable two-tenant fixture for the Stage 9 security probes.
//
// Provisions two complete miniature universities that exist only for the
// duration of one run:
//
//   tenant A — school, department, professor, course, availability, student
//              (profile + auth user + student_profile), enrolment, counseling
//              request, direct notification, role broadcast, mission progress
//   tenant B — the same shape, so every "A must not see B" assertion has a real
//              row on the other side instead of a hypothetical one
//
// Codex finding 1 changed how this file works, not what it creates. EVERY
// resource is written into the caller's ProbeLedger the instant it exists and
// before the next operation that could fail, so a throw halfway through leaves
// the caller holding a complete removal list. This function no longer owns any
// cleanup responsibility and no longer has a rescue `catch`: the caller's
// top-level `finally` covers provisioning itself.
//
// Both tenants carry PROBE_MARKER in `schools.slug`, and every row carries the
// marker in a text column wherever the schema has one.

import { PROBE_MARKER, PROBE_TENANT_SLUG_PREFIX, isProbeTenant } from "./probe-guard.mjs";

export const PROBE_PASSWORD = "Stage9-probe-!aA9";

export function makeRunId(now = Date.now(), random = Math.random()) {
  return `${now.toString(36)}${random.toString(36).slice(2, 6)}`;
}

/**
 * Insert one row and record it in the ledger before returning.
 *
 * The record happens after the insert resolves (we need the id) and before the
 * caller can perform any further work, which is the tightest window the API
 * allows. If the insert itself fails, nothing was created and nothing needs
 * recording.
 */
async function createRow(ledger, table, row, label) {
  const inserted = await ledger.rest.insert(table, [row]);
  const created = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!created?.id) {
    throw new Error(`insert into ${table} returned no id (${label})`);
  }
  ledger.recordRow(table, created.id, label);
  return created;
}

async function createAuthUser(ledger, email, label) {
  const user = await ledger.auth.createUser(email, PROBE_PASSWORD);
  if (!user?.id) {
    throw new Error(`GoTrue create user returned no id (${label})`);
  }
  ledger.recordAuthUser(user.id, label);
  return user;
}

/**
 * @param {import('./probe-ledger.mjs').ProbeLedger} ledger
 */
export async function provisionTenant(ledger, label, runId) {
  const slug = `${PROBE_TENANT_SLUG_PREFIX}${label}-${runId}`;

  const school = await createRow(
    ledger,
    "schools",
    { name: `${PROBE_MARKER} university ${label}`, slug, status: "active" },
    `school ${label}`,
  );

  // The harness only writes into a tenant the DATABASE confirms is a probe
  // tenant, even though it just created it. Runs AFTER the ledger entry, so a
  // failed confirmation still leaves the school removable.
  const [confirmed] = await ledger.rest.select("schools", `select=id,name,slug&id=eq.${school.id}`);
  if (!isProbeTenant(confirmed)) {
    throw new Error(`provisioned tenant ${school.id} does not carry the probe marker — aborting`);
  }

  const department = await createRow(
    ledger,
    "departments",
    { school_id: school.id, name: `${PROBE_MARKER} department ${label}` },
    `department ${label}`,
  );

  // The professor gets a real identity (auth user + profile + linked professors
  // row) so `app_private.current_professor_id()` resolves for them. Without it
  // no probe can exercise a professor-scoped policy at all.
  const professorEmail = `${PROBE_MARKER}-prof-${label}-${runId}@probe.invalid`;
  const professorAuthUser = await createAuthUser(ledger, professorEmail, `professor auth user ${label}`);

  const professorProfile = await createRow(
    ledger,
    "profiles",
    {
      identifier: professorEmail,
      name: `${PROBE_MARKER} professor profile ${label}`,
      role: "professor",
      school_id: school.id,
      department_id: department.id,
      auth_user_id: professorAuthUser.id,
    },
    `professor profile ${label}`,
  );

  const professor = await createRow(
    ledger,
    "professors",
    {
      school_id: school.id,
      department_id: department.id,
      profile_id: professorProfile.id,
      name: `${PROBE_MARKER} professor ${label}`,
      email: professorEmail,
    },
    `professor ${label}`,
  );

  const course = await createRow(
    ledger,
    "courses",
    {
      school_id: school.id,
      department_id: department.id,
      code: `PB-${label}-${runId}`.slice(0, 20),
      name: `${PROBE_MARKER} course ${label}`,
      credit: 3,
    },
    `course ${label}`,
  );

  const availability = await createRow(
    ledger,
    "professor_availability",
    {
      professor_id: professor.id,
      day_of_week: 1,
      start_time: "10:00:00",
      end_time: "11:00:00",
      slot_minutes: 30,
      is_active: true,
    },
    `availability ${label}`,
  );

  const email = `${PROBE_MARKER}-${label}-${runId}@probe.invalid`;
  const authUser = await createAuthUser(ledger, email, `auth user ${label}`);

  const profile = await createRow(
    ledger,
    "profiles",
    {
      identifier: email,
      name: `${PROBE_MARKER} student ${label}`,
      role: "student",
      school_id: school.id,
      department_id: department.id,
      auth_user_id: authUser.id,
    },
    `profile ${label}`,
  );

  const studentProfile = await createRow(
    ledger,
    "student_profiles",
    { profile_id: profile.id, grade: 1, semester: 1, is_onboarded: true },
    `student profile ${label}`,
  );

  const enrolment = await createRow(
    ledger,
    "student_courses",
    {
      student_id: profile.id,
      course_id: course.id,
      status: "interested",
      semester_label: "2026-2",
      source_text: PROBE_MARKER,
    },
    `enrolment ${label}`,
  );

  const start = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const counseling = await createRow(
    ledger,
    "counseling_requests",
    {
      student_id: profile.id,
      professor_id: professor.id,
      requested_start: start.toISOString(),
      requested_end: end.toISOString(),
      topic: `${PROBE_MARKER} confidential counseling topic ${label}`,
      status: "pending",
    },
    `counseling ${label}`,
  );

  const directNotification = await createRow(
    ledger,
    "user_notifications",
    {
      recipient_id: profile.id,
      recipient_role: null,
      school_id: school.id,
      category: "system",
      title: `${PROBE_MARKER} direct ${label}`,
      body: `${PROBE_MARKER} direct body ${label}`,
      target_href: "/notifications",
    },
    `direct notification ${label}`,
  );

  const broadcast = await createRow(
    ledger,
    "user_notifications",
    {
      recipient_id: null,
      recipient_role: "student",
      school_id: school.id,
      category: "system",
      title: `${PROBE_MARKER} broadcast ${label}`,
      body: `${PROBE_MARKER} broadcast body ${label}`,
      target_href: "/notifications",
    },
    `broadcast ${label}`,
  );

  const mission = await createRow(
    ledger,
    "student_mission_progress",
    {
      student_id: profile.id,
      course_id: course.id,
      week_number: 1,
      is_completed: false,
      actual_progress_feedback: `${PROBE_MARKER} private feedback ${label}`,
    },
    `mission ${label}`,
  );

  return {
    label,
    school,
    department,
    professorEmail,
    professorProfile,
    professorAuthUserId: professorAuthUser.id,
    professor,
    course,
    availability,
    email,
    authUserId: authUser.id,
    profile,
    studentProfile,
    enrolment,
    counseling,
    directNotification,
    broadcast,
    mission,
  };
}

/**
 * Provision both tenants. Deliberately has NO rescue `catch`: cleanup belongs to
 * the caller's top-level `finally`, which also covers the case where this
 * function never returns at all.
 */
export async function provisionProbeTenants(ledger, runId = makeRunId()) {
  const tenants = {};
  tenants.A = await provisionTenant(ledger, "a", runId);
  tenants.B = await provisionTenant(ledger, "b", runId);
  return { runId, tenants };
}

export { PROBE_MARKER };
