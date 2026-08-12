import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Stage 6 cross-tenant isolation suite (ISOLATION_TEST_MATRIX.md). Drives the
// REAL counseling service/actions and the REAL professor status action against
// a deterministic TWO-TENANT fixture (University A / University B), through the
// repo's transpile-loader convention. Proves isolation at the authoritative
// server boundary — not UI visibility. The DB WITH CHECK backstop (matrix M-7)
// and the Stage 5 GiST behaviour under tenancy (M-13/M-14) are proven by the
// live probe recorded in the Stage 6 handoff; this suite pins the server layer.

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__tenantSessionClient;",
);
const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__tenantAdminClient;",
);
const SESSION_STUB = toDataUrl(
  "export const getDemoProfile = async () => globalThis.__tenantProfile;",
);
const NOTIFY_STUB = toDataUrl(
  `export const createUserNotification = async (n) => { (globalThis.__tenantNotifications ??= []).push(n); return { ok: true }; };
   export const createUserNotifications = async () => ({ ok: true });
   export const createUserNotificationsWithClient = async () => ({ ok: true });`,
);
const CACHE_STUB = toDataUrl("export const revalidatePath = () => {};");
const ROADMAP_STUB = toDataUrl("export const textareaToList = (v) => (v ? v.split('\\n').filter(Boolean) : []);");
const ANON_STUB = toDataUrl("export const supabase = globalThis.__tenantAdminClient;");

const domainUrl = new URL("../lib/counseling-slots.ts", import.meta.url).href;
const tenantUrl = new URL("../lib/tenant.ts", import.meta.url).href;
const uuidUrl = new URL("../lib/uuid.ts", import.meta.url).href;

async function compile(url, replacements) {
  let source = await readFile(url, "utf8");
  for (const [from, to] of replacements) source = source.split(from).join(to);
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  assert.ok(!compiled.includes('from "@/'), `unrewritten alias import in ${url}`);
  return toDataUrl(compiled);
}

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const serviceUrl = await compile(new URL("./counseling.service.ts", import.meta.url), [
      ['import "server-only";', ""],
      ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
      ['from "@/lib/tenant"', `from ${JSON.stringify(tenantUrl)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
    ]);
    const actionsUrl = await compile(new URL("./counseling.actions.ts", import.meta.url), [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
      ['from "@/lib/tenant"', `from ${JSON.stringify(tenantUrl)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/lib/uuid"', `from ${JSON.stringify(uuidUrl)}`],
      ['from "@/services/counseling.service"', `from ${JSON.stringify(serviceUrl)}`],
      ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFY_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
    ]);
    const professorUrl = await compile(new URL("./professor.actions.ts", import.meta.url), [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "@/lib/supabase/client"', `from ${JSON.stringify(ANON_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFY_STUB)}`],
      ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
      ['from "@/services/roadmap-revisions.service"', `from ${JSON.stringify(ROADMAP_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
    ]);
    const [service, actions, professor, domain] = await Promise.all([
      import(serviceUrl), import(actionsUrl), import(professorUrl), import(domainUrl),
    ]);
    return { service, actions, professor, domain };
  })();
  return modulesPromise;
}

// ---- Two-tenant fixture -----------------------------------------------------

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const PROF_A = { id: "prof-a", name: "A교수", office: "A-1", email: "a@a.edu", bio: null, school_id: SCHOOL_A, profile_id: "prof-a-profile" };
const PROF_B = { id: "prof-b", name: "B교수", office: "B-1", email: "b@b.edu", bio: null, school_id: SCHOOL_B, profile_id: "prof-b-profile" };
const STUDENT_A = { id: "student-a", identifier: "sa@a.edu", name: "A학생", role: "student", school_id: SCHOOL_A, department_id: null };

// One recurring Monday 10:00-11:00 window per professor — identical wall time
// across tenants, so a leak would surface as B's slots appearing for A.
function availabilityRow(prof) {
  return {
    professor_id: prof.id,
    day_of_week: 1,
    specific_date: null,
    start_time: "10:00",
    end_time: "11:00",
    slot_minutes: 30,
    is_active: true,
    professor: { id: prof.id, name: prof.name, office: prof.office, email: prof.email, school_id: prof.school_id },
  };
}

function readColumn(row, col) {
  return col.split(".").reduce((v, k) => (v == null ? v : v[k]), row);
}

function makeFakeDb(name) {
  const state = { name, fixtures: {}, inserts: [] };
  function apply(rows, filters) {
    return rows.filter((row) =>
      filters.every((f) => (f.op === "eq" ? readColumn(row, f.col) === f.val : f.val.includes(readColumn(row, f.col)))),
    );
  }
  function makeBuilder(table) {
    const q = { op: "select", filters: [], values: null, single: false, maybe: false };
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (col, val) => (q.filters.push({ op: "eq", col, val }), builder),
      in: (col, val) => (q.filters.push({ op: "in", col, val }), builder),
      insert: (values) => ((q.op = "insert"), (q.values = values), builder),
      update: (values) => ((q.op = "update"), (q.values = values), builder),
      single: () => ((q.single = true), builder),
      maybeSingle: () => ((q.maybe = true), builder),
      then: (resolve, reject) => run().then(resolve, reject),
    };
    async function run() {
      if (q.op === "insert") {
        state.inserts.push({ table, values: q.values });
        const row = { id: `${name}-${state.inserts.length}`, ...q.values };
        (state.fixtures[table] ??= []).push(row);
        return { data: q.single ? { id: row.id } : [row], error: null };
      }
      const rows = apply(state.fixtures[table] ?? [], q.filters);
      if (q.op === "update") for (const row of rows) Object.assign(row, q.values);
      if (q.single) {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: `${rows.length} rows` } };
      }
      if (q.maybe) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null, count: rows.length };
    }
    return builder;
  }
  return { state, from: (table) => makeBuilder(table) };
}

function setupTwoTenants() {
  const session = makeFakeDb("session");
  const admin = makeFakeDb("admin");
  const both = {
    professor_availability: [availabilityRow(PROF_A), availabilityRow(PROF_B)],
    professor_teaching_slots: [],
    professor_admin_tasks: [],
    professors: [PROF_A, PROF_B],
    counseling_requests: [],
  };
  session.state.fixtures = JSON.parse(JSON.stringify(both));
  admin.state.fixtures = JSON.parse(JSON.stringify(both));
  globalThis.__tenantSessionClient = session;
  globalThis.__tenantAdminClient = admin;
  globalThis.__tenantProfile = STUDENT_A;
  globalThis.__tenantNotifications = [];
  return { session, admin };
}

function teardown() {
  delete globalThis.__tenantSessionClient;
  delete globalThis.__tenantAdminClient;
  delete globalThis.__tenantProfile;
  delete globalThis.__tenantNotifications;
}

// ---- Matrix ----------------------------------------------------------------

test("M-2/M-3: a student's slot feed contains only their own tenant's professors", async () => {
  const { service } = await loadModules();
  setupTwoTenants();
  try {
    const slots = await service.getAvailableCounselingSlots(SCHOOL_A);
    assert.ok(slots.length > 0, "tenant A must have bookable slots");
    assert.ok(slots.every((s) => s.professorId === PROF_A.id), "no foreign-tenant professor may appear in the feed");
    assert.ok(!slots.some((s) => s.professorId === PROF_B.id), "tenant B's professor must be absent");
  } finally {
    teardown();
  }
});

test("M-4: a student books their own tenant's professor (allow)", async () => {
  const { service, actions, domain } = await loadModules();
  const { session } = setupTwoTenants();
  try {
    const slots = await service.getAvailableCounselingSlots(SCHOOL_A);
    const slotId = domain.getCounselingSlotId(slots[0]);
    const form = new FormData();
    form.set("slotId", slotId);
    form.set("topic", "상담");
    const result = await actions.createCounselingRequest(form);
    assert.equal(result.ok, true, result.message);
    // The booking insert runs on the session client (RLS-scoped in prod).
    assert.equal(session.state.inserts.length, 1, "the booking must insert exactly one row");
    assert.equal(session.state.inserts[0].values.professor_id, PROF_A.id);
  } finally {
    teardown();
  }
});

test("M-5/M-6: a student cannot book a foreign-tenant professor via a crafted slotId (deny, no insert)", async () => {
  const { actions, domain } = await loadModules();
  const { session } = setupTwoTenants();
  try {
    // Craft a slotId naming PROF_B (tenant B) at a legitimate wall time — the
    // exact IDOR a malicious student would attempt.
    const foreignSlotId = domain.getCounselingSlotId({
      professorId: PROF_B.id,
      start: "2026-09-07T01:00:00.000Z",
      end: "2026-09-07T01:30:00.000Z",
    });
    const form = new FormData();
    form.set("slotId", foreignSlotId);
    form.set("topic", "cross-tenant attempt");
    const result = await actions.createCounselingRequest(form);
    assert.equal(result.ok, false, "booking a foreign-tenant professor must be denied");
    assert.equal(session.state.inserts.length, 0, "no counseling row may be inserted for a cross-tenant booking");
  } finally {
    teardown();
  }
});

test("M-8: a professor approves their own tenant's request (allow)", async () => {
  const { professor } = await loadModules();
  const { admin } = setupTwoTenants();
  admin.state.fixtures.counseling_requests = [
    { id: "req-a", student_id: "student-a", professor_id: PROF_A.id, topic: "t", requested_start: "2026-09-07T01:00:00.000Z", suggested_start: null, status: "pending" },
  ];
  globalThis.__tenantProfile = { id: "prof-a-profile", identifier: "pa", name: "A교수", role: "professor", school_id: SCHOOL_A, department_id: null };
  try {
    const form = new FormData();
    form.set("requestId", "req-a");
    form.set("status", "approved");
    const result = await professor.updateCounselingStatus(form);
    assert.equal(result.ok, true, result.message);
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "approved");
  } finally {
    teardown();
  }
});

test("M-9/M-10: a professor cannot approve a foreign-tenant request (IDOR, deny)", async () => {
  const { professor } = await loadModules();
  const { admin } = setupTwoTenants();
  // A request owned by PROF_B (tenant B). Professor A knows/guesses its id.
  admin.state.fixtures.counseling_requests = [
    { id: "req-b", student_id: "student-b", professor_id: PROF_B.id, topic: "t", requested_start: "2026-09-07T01:00:00.000Z", suggested_start: null, status: "pending" },
  ];
  globalThis.__tenantProfile = { id: "prof-a-profile", identifier: "pa", name: "A교수", role: "professor", school_id: SCHOOL_A, department_id: null };
  try {
    const form = new FormData();
    form.set("requestId", "req-b");
    form.set("status", "approved");
    const result = await professor.updateCounselingStatus(form);
    assert.equal(result.ok, false, "approving a foreign-tenant request must be denied");
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "pending", "the foreign request must be untouched");
  } finally {
    teardown();
  }
});
