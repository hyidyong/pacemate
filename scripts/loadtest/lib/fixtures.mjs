import { randomUUID } from "node:crypto";

// Fixture lifecycle for load tests. The only Supabase project available is the
// LIVE one, so every row this creates carries a run-scoped marker and is removed
// by cleanup() — the same discipline Stage 5/6 used for their live probes.
export const LOADTEST_MARKER = "pacemate-loadtest";

export function newRunId() {
  return randomUUID().slice(0, 8);
}

export async function discoverTenant(rest) {
  const schools = await rest.select("schools", "select=id,name,slug,status&limit=5");
  if (!schools.length) throw new Error("No schools row found — cannot resolve a tenant.");
  return schools[0];
}

export async function discoverProfessors(rest, tenantId) {
  return rest.select(
    "professors",
    `select=id,name,school_id&school_id=eq.${tenantId}&order=name.asc`,
  );
}

export async function countRows(rest, table, query) {
  const rows = await rest.select(table, `select=id&${query}`);
  return rows.length;
}

// Creates disposable student profiles in the tenant. profiles.identifier is
// globally unique and doubles as the login email, so the marker keeps these
// unmistakably synthetic and collision-free.
export async function createLoadTestStudents(rest, { tenantId, departmentId, runId, count }) {
  const rows = Array.from({ length: count }, (_, i) => ({
    identifier: `${LOADTEST_MARKER}+${runId}-${i}@loadtest.invalid`,
    name: `부하테스트학생${i}`,
    role: "student",
    school_id: tenantId,
    department_id: departmentId ?? null,
  }));

  return rest.insert("profiles", rows);
}

export async function cleanupLoadTestRun(rest, { runId, studentIds = [] }) {
  const report = { counselingRequests: 0, notifications: 0, availability: 0, profiles: 0 };

  if (studentIds.length) {
    const idList = `(${studentIds.join(",")})`;
    const requests = await rest.remove("counseling_requests", `student_id=in.${idList}`);
    report.counselingRequests = requests?.length ?? 0;
  }

  const notifications = await rest.remove(
    "user_notifications",
    `body=like.*${LOADTEST_MARKER}*`,
  );
  report.notifications = notifications?.length ?? 0;

  const availability = await rest.remove(
    "professor_availability",
    `id=in.(${(await loadRunAvailabilityIds(rest, runId)).join(",") || randomUUID()})`,
  ).catch(() => []);
  report.availability = availability?.length ?? 0;

  const profiles = await rest.remove(
    "profiles",
    `identifier=like.*${LOADTEST_MARKER}+${runId}*`,
  );
  report.profiles = profiles?.length ?? 0;

  return report;
}

// professor_availability has no marker column; the harness records the ids it
// created in-process and passes them through, so this is a best-effort lookup
// used only when the caller did not track them.
let trackedAvailabilityIds = new Map();

export function trackAvailability(runId, ids) {
  const current = trackedAvailabilityIds.get(runId) ?? [];
  trackedAvailabilityIds.set(runId, current.concat(ids));
}

async function loadRunAvailabilityIds(_rest, runId) {
  return trackedAvailabilityIds.get(runId) ?? [];
}

// Extracts the bookable slots the server actually rendered for this student from
// the /counseling RSC payload, then rebuilds the slot id with the same rule the
// domain module uses (JSON array of professorId + ISO start + ISO end).
export function extractSlotIdsFromCounselingHtml(html) {
  const slots = [];
  const seen = new Set();
  const pattern =
    /\\"professorId\\":\\"([0-9a-fA-F-]{36})\\",\\"professorName\\":.*?\\"start\\":\\"([^"\\]+)\\",\\"end\\":\\"([^"\\]+)\\"/g;

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [, professorId, start, end] = match;
    const id = buildSlotId(professorId, start, end);
    if (!seen.has(id)) {
      seen.add(id);
      slots.push({ id, professorId, start, end });
    }
  }
  return slots;
}

export function buildSlotId(professorId, start, end) {
  return JSON.stringify([professorId, normalizeInstant(start), normalizeInstant(end)]);
}

function normalizeInstant(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}
