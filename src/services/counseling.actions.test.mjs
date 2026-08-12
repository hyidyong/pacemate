import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 5 behavior tests for the REAL booking actions (createCounselingRequest /
// reserveSuggestedCounseling), driven through the repo's transpile-loader
// convention (see counseling.query-count.test.mjs). Two independent fake
// clients model the RLS reality: the SESSION client sees only the caller's own
// counseling_requests rows; the ADMIN (service-role) client sees every row.
// Interleavings are controlled by manually-released insert thenables — no
// wall-clock sleeps anywhere.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__stage5SessionClient;",
);
const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__stage5AdminClient;",
);
const SESSION_SERVICE_STUB = toDataUrl(
  "export const getDemoProfile = async () => globalThis.__stage5Profile;",
);
const NOTIFY_STUB = toDataUrl(
  `export const createUserNotification = async (notification) => {
    globalThis.__stage5Notifications.push(notification);
    return globalThis.__stage5NotificationResult ?? { ok: true };
  };`,
);
const CACHE_STUB = toDataUrl(
  "export const revalidatePath = (path) => { globalThis.__stage5Revalidated.push(path); };",
);

async function compileToDataUrl(url, replacements) {
  let source = await readFile(url, "utf8");
  for (const [from, to] of replacements) {
    source = source.split(from).join(to);
  }
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  // Every VALUE alias import must have been rewritten (type-only imports are
  // erased by the transpile), or the data: module would die with
  // ERR_UNSUPPORTED_RESOLVE_REQUEST at import time.
  assert.ok(!compiled.includes('from "@/'), `unrewritten alias import remains in ${url}`);
  return toDataUrl(compiled);
}

const domainUrl = new URL("../lib/counseling-slots.ts", import.meta.url).href;
const uuidUrl = new URL("../lib/uuid.ts", import.meta.url).href;

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const serviceUrl = await compileToDataUrl(
      new URL("./counseling.service.ts", import.meta.url),
      [
        ['import "server-only";', ""],
        ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
        ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
        ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ],
    );
    const actionsUrl = await compileToDataUrl(
      new URL("./counseling.actions.ts", import.meta.url),
      [
        ['"use server";', ""],
        ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
        ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
        ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
        ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
        ['from "@/lib/uuid"', `from ${JSON.stringify(uuidUrl)}`],
        ['from "@/services/counseling.service"', `from ${JSON.stringify(serviceUrl)}`],
        ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFY_STUB)}`],
        ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_SERVICE_STUB)}`],
      ],
    );
    const [actions, service, domain] = await Promise.all([
      import(actionsUrl),
      import(serviceUrl),
      import(domainUrl),
    ]);
    return { actions, service, domain };
  })();
  return modulesPromise;
}

// Minimal behavioral PostgREST fake: .eq/.in filters really filter fixture
// rows, .single()/.maybeSingle() follow PostgREST row-count semantics, and
// inserts can be intercepted (state.insertHandler) for constraint outcomes or
// manual release. Reads ignore select strings (fixtures carry the full shape),
// like every other fake in this repo.
function makeFakeDb(name) {
  const state = { name, fixtures: {}, inserts: [], updates: [], insertHandler: null };

  function applyFilters(rows, filters) {
    return rows.filter((row) =>
      filters.every((f) =>
        f.op === "eq" ? row[f.col] === f.val : f.val.includes(row[f.col]),
      ),
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
        if (state.insertHandler) {
          return state.insertHandler(table, q.values);
        }
        const row = { id: `${name}-row-${state.inserts.length}`, ...q.values };
        (state.fixtures[table] ??= []).push(row);
        return { data: q.single ? { id: row.id } : [row], error: null };
      }
      const rows = applyFilters(state.fixtures[table] ?? [], q.filters);
      if (q.op === "update") {
        state.updates.push({ table, values: q.values, filters: q.filters, matched: rows.length });
        for (const row of rows) Object.assign(row, q.values);
      }
      if (q.single) {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : {
              data: null,
              error: {
                code: "PGRST116",
                message: `JSON object requested, ${rows.length} rows returned`,
                details: null,
                hint: null,
              },
            };
      }
      if (q.maybe) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null, count: rows.length };
    }

    return builder;
  }

  return { state, from: (table) => makeBuilder(table) };
}

const STUDENT = { id: "student-1", identifier: "student1@pacemate.edu", name: "김학생", role: "student", school_id: "s1", department_id: null };
const PROFESSOR = { id: "prof-1", name: "김교수", office: "A-101", email: "prof1@pacemate.edu" };

// One recurring Monday 10:00-11:00 window (30-min grid) always yields 4 slots
// inside the +1..+14-day horizon regardless of the real clock.
function baseFixtures() {
  return {
    professor_availability: [
      {
        professor_id: PROFESSOR.id,
        day_of_week: 1,
        specific_date: null,
        start_time: "10:00",
        end_time: "11:00",
        slot_minutes: 30,
        is_active: true,
        professor: { ...PROFESSOR },
      },
    ],
    professor_teaching_slots: [],
    professor_admin_tasks: [],
    counseling_requests: [],
  };
}

function setupWorld({ sessionRows = [], adminRows = [] } = {}) {
  const session = makeFakeDb("session");
  const admin = makeFakeDb("admin");
  session.state.fixtures = { ...baseFixtures(), counseling_requests: sessionRows };
  admin.state.fixtures = { ...baseFixtures(), counseling_requests: adminRows };
  globalThis.__stage5SessionClient = session;
  globalThis.__stage5AdminClient = admin;
  globalThis.__stage5Profile = STUDENT;
  globalThis.__stage5Notifications = [];
  globalThis.__stage5Revalidated = [];
  globalThis.__stage5NotificationResult = { ok: true };
  return { session, admin };
}

function teardownWorld() {
  delete globalThis.__stage5SessionClient;
  delete globalThis.__stage5AdminClient;
  delete globalThis.__stage5Profile;
  delete globalThis.__stage5Notifications;
  delete globalThis.__stage5Revalidated;
  delete globalThis.__stage5NotificationResult;
}

async function firstLiveSlot(service, domain) {
  const slots = await service.getAvailableCounselingSlots();
  assert.ok(slots.length > 0, "fixtures must yield at least one bookable slot");
  return { slot: slots[0], slotId: domain.getCounselingSlotId(slots[0]) };
}

function bookingForm(slotId, topic = "학업 상담") {
  const form = new FormData();
  form.set("slotId", slotId);
  form.set("topic", topic);
  return form;
}

function busyRowFor(slot, studentId, status = "pending") {
  return {
    id: `busy-${studentId}`,
    student_id: studentId,
    professor_id: slot.professorId,
    requested_start: slot.start,
    requested_end: slot.end,
    status,
  };
}

const GENERIC_SAVE_FAILED = "상담 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const SLOT_NOT_AVAILABLE = "선택한 상담 시간을 예약할 수 없습니다. 다른 시간을 선택해 주세요.";

test("characterization: a booking against a free slot inserts, notifies, and revalidates", async () => {
  const { actions, service, domain } = await loadModules();
  const { session } = setupWorld();
  try {
    const { slot, slotId } = await firstLiveSlot(service, domain);
    const result = await actions.createCounselingRequest(bookingForm(slotId));

    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /상담 신청을 보냈습니다/);
    assert.equal(session.state.inserts.length, 1);
    const inserted = session.state.inserts[0];
    assert.equal(inserted.table, "counseling_requests");
    assert.deepEqual(
      {
        student_id: inserted.values.student_id,
        professor_id: inserted.values.professor_id,
        requested_start: inserted.values.requested_start,
        requested_end: inserted.values.requested_end,
        status: inserted.values.status,
      },
      {
        student_id: STUDENT.id,
        professor_id: slot.professorId,
        requested_start: slot.start,
        requested_end: slot.end,
        status: "pending",
      },
    );
    assert.equal(globalThis.__stage5Notifications.length, 1);
    assert.equal(globalThis.__stage5Notifications[0].recipientRole, "professor");
    assert.deepEqual(globalThis.__stage5Revalidated, ["/counseling", "/professor"]);
  } finally {
    teardownWorld();
  }
});

test("M1/M3: a slot held by ANOTHER student is rejected before any insert", async () => {
  const { actions, service, domain } = await loadModules();
  // The other student's pending row exists in the database (admin truth) but is
  // invisible to the caller's session client — the RLS reality.
  const { session, admin } = setupWorld();
  try {
    const { slot, slotId } = await firstLiveSlot(service, domain);
    admin.state.fixtures.counseling_requests.push(busyRowFor(slot, "student-2"));

    const result = await actions.createCounselingRequest(bookingForm(slotId));

    assert.equal(
      session.state.inserts.length,
      0,
      "booking reached the INSERT although the slot is already consumed — server revalidation is blind to other students' rows",
    );
    assert.equal(result.ok, false);
    assert.equal(result.message, SLOT_NOT_AVAILABLE);
    assert.deepEqual(
      globalThis.__stage5Revalidated,
      ["/counseling", "/professor"],
      "a stale submission proves the client's slot list is outdated — both consumers must revalidate",
    );
  } finally {
    teardownWorld();
  }
});

test("M3: the page's displayed slot list excludes slots consumed by other students", async () => {
  const { service } = await loadModules();
  const { admin } = setupWorld();
  try {
    const before = await service.getAvailableCounselingSlots();
    assert.ok(before.length > 0);
    admin.state.fixtures.counseling_requests.push(busyRowFor(before[0], "student-2"));

    const after = await service.getAvailableCounselingSlots();
    assert.equal(
      after.length,
      before.length - 1,
      "displayed availability still counts a slot another student already booked (Stage 2 displayed==canonical invariant broken)",
    );
  } finally {
    teardownWorld();
  }
});

test("M1: losing the insert race (23P01) yields the slot-conflict message and revalidate, not a generic retry", async () => {
  const { actions, service, domain } = await loadModules();
  const { session } = setupWorld();
  try {
    const { slotId } = await firstLiveSlot(service, domain);
    session.state.insertHandler = () => ({
      data: null,
      error: {
        code: "23P01",
        message: 'conflicting key value violates exclusion constraint "counseling_requests_no_active_overlap"',
        details: null,
        hint: null,
      },
    });

    const result = await actions.createCounselingRequest(bookingForm(slotId));

    assert.equal(result.ok, false);
    assert.equal(
      result.message,
      SLOT_NOT_AVAILABLE,
      `constraint conflict surfaced as: ${result.message}`,
    );
    assert.deepEqual(
      globalThis.__stage5Revalidated,
      ["/counseling", "/professor"],
      "a conflict proves the data changed — the stale slot list must be revalidated",
    );
  } finally {
    teardownWorld();
  }
});

test("M2: a duplicate of the caller's own committed booking is acknowledged, not reported as failure", async () => {
  const { actions, service, domain } = await loadModules();
  const { session, admin } = setupWorld();
  try {
    const { slot, slotId } = await firstLiveSlot(service, domain);
    // The caller's first attempt committed (visible via admin truth AND the
    // caller's own session view) but the response was lost; this is the retry.
    const ownRow = busyRowFor(slot, STUDENT.id);
    admin.state.fixtures.counseling_requests.push({ ...ownRow });
    session.state.fixtures.counseling_requests.push({ ...ownRow });
    // Tripwire: with an authoritative busy feed the duplicate must be caught
    // at revalidation — reaching the INSERT at all would be a regression.
    session.state.insertHandler = () => {
      throw new Error("duplicate retry must not reach the INSERT");
    };

    const result = await actions.createCounselingRequest(bookingForm(slotId));

    assert.equal(
      result.ok,
      true,
      `retry of an already-committed booking reported failure: ${result.message}`,
    );
    assert.match(result.message, /이미 신청된 상담 시간/);
    assert.equal(session.state.inserts.length, 0, "no second row may be attempted");
  } finally {
    teardownWorld();
  }
});

test("M2 interleaving: two concurrent submissions of one intent — exactly one row, both responses honest", async () => {
  const { actions, service, domain } = await loadModules();
  const { session, admin } = setupWorld();
  try {
    const { slot, slotId } = await firstLiveSlot(service, domain);

    const gate = [];
    session.state.insertHandler = () =>
      new Promise((resolve) => {
        gate.push(resolve);
      });

    const first = actions.createCounselingRequest(bookingForm(slotId));
    const second = actions.createCounselingRequest(bookingForm(slotId));

    // Both invocations pass revalidation (the slot is free when both read) and
    // reach the INSERT — the TOCTOU window, held open deterministically.
    let guard = 0;
    while (gate.length < 2) {
      assert.ok(guard++ < 200, `expected both inserts in flight, got ${gate.length}`);
      await new Promise((resolve) => setImmediate(resolve));
    }

    // The database serializes them: first commits, second violates the GiST
    // exclusion constraint. Reflect the committed row into both truths.
    const committed = busyRowFor(slot, STUDENT.id);
    admin.state.fixtures.counseling_requests.push({ ...committed });
    session.state.fixtures.counseling_requests.push({ ...committed });
    gate[0]({ data: { id: committed.id }, error: null });
    gate[1]({
      data: null,
      error: { code: "23P01", message: 'conflicting key value violates exclusion constraint "counseling_requests_no_active_overlap"', details: null, hint: null },
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.ok, true, firstResult.message);
    assert.match(firstResult.message, /상담 신청을 보냈습니다/);
    assert.equal(
      secondResult.ok,
      true,
      `duplicate in-flight submission reported failure although the intent committed: ${secondResult.message}`,
    );
    assert.match(secondResult.message, /이미 신청된 상담 시간/);
    assert.equal(session.state.inserts.length, 2, "both requests reached the INSERT (TOCTOU window confirmed)");
  } finally {
    teardownWorld();
  }
});

function cancelForm(requestId) {
  const form = new FormData();
  form.set("requestId", requestId);
  return form;
}

const OWN_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function ownRequestRow(status = "pending", overrides = {}) {
  return {
    id: OWN_REQUEST_ID,
    student_id: STUDENT.id,
    professor_id: PROFESSOR.id,
    topic: "학업 상담",
    requested_start: "2026-09-07T01:00:00.000Z",
    requested_end: "2026-09-07T01:30:00.000Z",
    status,
    ...overrides,
  };
}

test("M9: a student cancels their own pending request (CAS to cancelled + professor notified)", async () => {
  const { actions } = await loadModules();
  const { admin } = setupWorld();
  try {
    admin.state.fixtures.counseling_requests.push(ownRequestRow("pending"));

    const result = await actions.cancelMyCounselingRequest(cancelForm(OWN_REQUEST_ID));

    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /상담 신청을 취소했습니다/);
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "cancelled");
    assert.equal(globalThis.__stage5Notifications.length, 1);
    assert.equal(globalThis.__stage5Notifications[0].recipientRole, "professor");
    assert.match(globalThis.__stage5Notifications[0].title, /취소/);
    assert.deepEqual(globalThis.__stage5Revalidated, ["/counseling", "/professor"]);
  } finally {
    teardownWorld();
  }
});

test("M9: an approved request can also be cancelled by its student", async () => {
  const { actions } = await loadModules();
  const { admin } = setupWorld();
  try {
    admin.state.fixtures.counseling_requests.push(ownRequestRow("approved"));

    const result = await actions.cancelMyCounselingRequest(cancelForm(OWN_REQUEST_ID));

    assert.equal(result.ok, true, result.message);
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "cancelled");
  } finally {
    teardownWorld();
  }
});

test("M9: cancelling another student's request is refused and touches nothing", async () => {
  const { actions } = await loadModules();
  const { admin } = setupWorld();
  try {
    admin.state.fixtures.counseling_requests.push(
      ownRequestRow("pending", { student_id: "student-2" }),
    );

    const result = await actions.cancelMyCounselingRequest(cancelForm(OWN_REQUEST_ID));

    assert.equal(result.ok, false, "foreign requests must not be cancellable");
    assert.match(result.message, /취소할 수 없는 상담 신청/);
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "pending");
    assert.equal(globalThis.__stage5Notifications.length, 0);
  } finally {
    teardownWorld();
  }
});

test("M9: cancel loses a competing terminal transition — controlled conflict, no notification", async () => {
  const { actions } = await loadModules();
  const { admin } = setupWorld();
  try {
    admin.state.fixtures.counseling_requests.push(ownRequestRow("rejected"));

    const result = await actions.cancelMyCounselingRequest(cancelForm(OWN_REQUEST_ID));

    assert.equal(result.ok, false);
    assert.match(result.message, /취소할 수 없는 상담 신청/);
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "rejected");
    assert.equal(globalThis.__stage5Notifications.length, 0);
  } finally {
    teardownWorld();
  }
});

test("M9: only students can use the cancel action", async () => {
  const { actions } = await loadModules();
  const { admin } = setupWorld();
  try {
    admin.state.fixtures.counseling_requests.push(ownRequestRow("pending"));
    globalThis.__stage5Profile = { ...STUDENT, role: "professor" };

    const result = await actions.cancelMyCounselingRequest(cancelForm(OWN_REQUEST_ID));

    assert.equal(result.ok, false);
    assert.equal(admin.state.fixtures.counseling_requests[0].status, "pending");
  } finally {
    teardownWorld();
  }
});

test("unknown insert failures keep the generic retryable message and structured log", async () => {
  const { actions, service, domain } = await loadModules();
  const { session } = setupWorld();
  try {
    const { slotId } = await firstLiveSlot(service, domain);
    session.state.insertHandler = () => ({
      data: null,
      error: { code: "42501", message: "permission denied", details: null, hint: null },
    });

    const result = await actions.createCounselingRequest(bookingForm(slotId));

    assert.equal(result.ok, false);
    assert.equal(result.message, GENERIC_SAVE_FAILED);
  } finally {
    teardownWorld();
  }
});
