// Disposable two-tenant fixture for the Stage 9 security probes.
//
// Provisions, in the live project, two complete miniature universities that
// exist only for the duration of one run:
//
//   tenant A — school, department, professor, course, availability, student
//              (profile + auth user + student_profile), enrolment, counseling
//              request, direct notification, role broadcast, mission progress
//   tenant B — the same shape, so every "A must not see B" assertion has a real
//              row on the other side instead of a hypothetical one
//
// Both tenants carry PROBE_MARKER in `schools.slug`, every row carries the
// marker in a text column where the schema allows one, and teardown deletes in
// FK order using ids minted by this run. `verifyTornDown()` re-reads the
// database afterwards so "cleaned up" is an observation, not a claim.

import { PROBE_MARKER, PROBE_TENANT_SLUG_PREFIX, isProbeTenant, assertScopedFilter } from "./probe-guard.mjs";

const PROBE_PASSWORD = "Stage9-probe-!aA9";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** GoTrue admin API — creating and deleting the probe users. */
function createAuthAdmin({ url, serviceRoleKey }) {
  const base = `${url.replace(/\/$/, "")}/auth/v1/admin`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  return {
    async createUser(email) {
      const res = await fetch(`${base}/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password: PROBE_PASSWORD, email_confirm: true }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`GoTrue create user ${email} → ${res.status}: ${text}`);
      return JSON.parse(text);
    },
    async deleteUser(id) {
      const res = await fetch(`${base}/users/${id}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) {
        throw new Error(`GoTrue delete user ${id} → ${res.status}: ${await res.text()}`);
      }
    },
  };
}

export async function signIn({ url, anonKey, email }) {
  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PROBE_PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) {
    throw new Error(`could not sign in probe user ${email}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function provisionTenant(rest, auth, label, runId) {
  const slug = `${PROBE_TENANT_SLUG_PREFIX}${label}-${runId}`;

  const [school] = await rest.insert("schools", [
    { name: `${PROBE_MARKER} university ${label}`, slug, status: "active" },
  ]);
  // Re-read: the harness only writes into a tenant the DATABASE confirms is a
  // probe tenant, even though it just created it.
  const [confirmed] = await rest.select("schools", `select=id,name,slug&id=eq.${school.id}`);
  if (!isProbeTenant(confirmed)) {
    throw new Error(`provisioned tenant ${school.id} does not carry the probe marker — aborting`);
  }

  const [department] = await rest.insert("departments", [
    { school_id: school.id, name: `${PROBE_MARKER} department ${label}` },
  ]);

  const [professor] = await rest.insert("professors", [
    {
      school_id: school.id,
      department_id: department.id,
      name: `${PROBE_MARKER} professor ${label}`,
      email: `${PROBE_MARKER}-prof-${label}-${runId}@probe.invalid`,
    },
  ]);

  const [course] = await rest.insert("courses", [
    {
      school_id: school.id,
      department_id: department.id,
      code: `PB-${label}-${runId}`.slice(0, 20),
      name: `${PROBE_MARKER} course ${label}`,
      credit: 3,
    },
  ]);

  const [availability] = await rest.insert("professor_availability", [
    {
      professor_id: professor.id,
      day_of_week: 1,
      start_time: "10:00:00",
      end_time: "11:00:00",
      slot_minutes: 30,
      is_active: true,
    },
  ]);

  const email = `${PROBE_MARKER}-${label}-${runId}@probe.invalid`;
  const authUser = await auth.createUser(email);

  const [profile] = await rest.insert("profiles", [
    {
      identifier: email,
      name: `${PROBE_MARKER} student ${label}`,
      role: "student",
      school_id: school.id,
      department_id: department.id,
      auth_user_id: authUser.id,
    },
  ]);

  const [studentProfile] = await rest.insert("student_profiles", [
    { profile_id: profile.id, grade: 1, semester: 1, is_onboarded: true },
  ]);

  const [enrolment] = await rest.insert("student_courses", [
    {
      student_id: profile.id,
      course_id: course.id,
      status: "interested",
      semester_label: "2026-2",
      source_text: PROBE_MARKER,
    },
  ]);

  const start = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const [counseling] = await rest.insert("counseling_requests", [
    {
      student_id: profile.id,
      professor_id: professor.id,
      requested_start: start.toISOString(),
      requested_end: end.toISOString(),
      topic: `${PROBE_MARKER} confidential counseling topic ${label}`,
      status: "pending",
    },
  ]);

  const [directNotification] = await rest.insert("user_notifications", [
    {
      recipient_id: profile.id,
      recipient_role: null,
      school_id: school.id,
      category: "system",
      title: `${PROBE_MARKER} direct ${label}`,
      body: `${PROBE_MARKER} direct body ${label}`,
      target_href: "/notifications",
    },
  ]);

  const [broadcast] = await rest.insert("user_notifications", [
    {
      recipient_id: null,
      recipient_role: "student",
      school_id: school.id,
      category: "system",
      title: `${PROBE_MARKER} broadcast ${label}`,
      body: `${PROBE_MARKER} broadcast body ${label}`,
      target_href: "/notifications",
    },
  ]);

  const [mission] = await rest.insert("student_mission_progress", [
    {
      student_id: profile.id,
      course_id: course.id,
      week_number: 1,
      is_completed: false,
      actual_progress_feedback: `${PROBE_MARKER} private feedback ${label}`,
    },
  ]);

  return {
    label,
    school,
    department,
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

export async function provisionProbeTenants({ rest, url, serviceRoleKey }) {
  const auth = createAuthAdmin({ url, serviceRoleKey });
  const runId = stamp();
  const created = { runId, tenants: {}, auth };
  try {
    created.tenants.A = await provisionTenant(rest, auth, "a", runId);
    created.tenants.B = await provisionTenant(rest, auth, "b", runId);
  } catch (error) {
    await teardownProbeTenants({ rest, fixtures: created }).catch(() => {});
    throw error;
  }
  return created;
}

/** Deletes in FK order. Every filter is id-scoped or marker-scoped. */
export async function teardownProbeTenants({ rest, fixtures }) {
  const tenants = Object.values(fixtures.tenants ?? {});
  const del = async (table, filter) => {
    try {
      await rest.remove(table, assertScopedFilter(filter));
    } catch {
      /* a missing row is a successful teardown for that row */
    }
  };

  for (const t of tenants) {
    if (t.mission) await del("student_mission_progress", `id=eq.${t.mission.id}`);
    if (t.directNotification) await del("user_notifications", `id=eq.${t.directNotification.id}`);
    if (t.broadcast) await del("user_notifications", `id=eq.${t.broadcast.id}`);
    if (t.counseling) await del("counseling_requests", `id=eq.${t.counseling.id}`);
    if (t.enrolment) await del("student_courses", `id=eq.${t.enrolment.id}`);
    if (t.studentProfile) await del("student_profiles", `id=eq.${t.studentProfile.id}`);
    if (t.profile) await del("profiles", `id=eq.${t.profile.id}`);
    if (t.availability) await del("professor_availability", `id=eq.${t.availability.id}`);
    if (t.course) await del("courses", `id=eq.${t.course.id}`);
    if (t.professor) await del("professors", `id=eq.${t.professor.id}`);
    if (t.department) await del("departments", `id=eq.${t.department.id}`);
    if (t.school) await del("schools", `id=eq.${t.school.id}`);
    if (t.authUserId && fixtures.auth) {
      await fixtures.auth.deleteUser(t.authUserId).catch(() => {});
    }
  }

  // Anything a probe created outside the id set (for example a row an anon
  // write test managed to insert) is caught by the marker sweep.
  await del("user_notifications", `title=like.*${PROBE_MARKER}*`);
  await del("schools", `slug=like.${PROBE_TENANT_SLUG_PREFIX}*`);
}

/** Observation, not assertion: re-read the database and report leftovers. */
export async function verifyTornDown({ rest }) {
  const leftovers = [];
  const checks = [
    ["schools", `select=id&slug=like.${PROBE_TENANT_SLUG_PREFIX}*`],
    ["profiles", `select=id&identifier=like.*${PROBE_MARKER}*`],
    ["professors", `select=id&name=like.*${PROBE_MARKER}*`],
    ["courses", `select=id&name=like.*${PROBE_MARKER}*`],
    ["user_notifications", `select=id&title=like.*${PROBE_MARKER}*`],
    ["counseling_requests", `select=id&topic=like.*${PROBE_MARKER}*`],
    ["student_courses", `select=id&source_text=like.*${PROBE_MARKER}*`],
    ["student_mission_progress", `select=id&actual_progress_feedback=like.*${PROBE_MARKER}*`],
    ["departments", `select=id&name=like.*${PROBE_MARKER}*`],
  ];
  for (const [table, query] of checks) {
    try {
      const rows = await rest.select(table, query);
      if (rows.length) leftovers.push(`${table}: ${rows.length}`);
    } catch (error) {
      leftovers.push(`${table}: UNCHECKED (${error.message})`);
    }
  }
  return leftovers;
}

export { PROBE_MARKER };
