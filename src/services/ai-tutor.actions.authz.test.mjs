import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 P0-2. generateWeeklyGuide and submitProgressFeedback are exported
// server actions (registered action ids, bound on app/dashboard/page) that took
// `studentId` as a CALLER-SUPPLIED parameter and never resolved a session. Any
// caller who knows the action id could write another student's
// student_mission_progress, advance another student's current_week, and trigger
// unbounded paid OpenAI calls.
//
// These tests drive the real actions with a recording fake client and assert
// that no write targets a student other than the authenticated caller.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

// Resolves the client on every call, not once at module-evaluation time. The
// module is imported once and cached, so a snapshot binding would make every
// test after the first write into the first test's recorder — and a real
// vulnerability would look like a pass. (The production module is likewise a
// lazy Proxy, so this matches its shape.)
const ANON_STUB = toDataUrl(
  "export const supabase = { from: (...args) => globalThis.__stage8AiClient.from(...args) };",
);
const SESSION_SERVICE_STUB = toDataUrl(
  "export const getDemoProfile = async () => globalThis.__stage8AiProfile;",
);

let modulesPromise;
function loadActions() {
  modulesPromise ??= (async () => {
    let source = await readFile(new URL("./ai-tutor.actions.ts", import.meta.url), "utf8");
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "@/lib/supabase/client"', `from ${JSON.stringify(ANON_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_SERVICE_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(
      !compiled.includes('from "@/'),
      "unrewritten alias import remains in ai-tutor.actions.ts",
    );
    return import(toDataUrl(compiled));
  })();
  return modulesPromise;
}

const VICTIM = "99999999-0000-4000-8000-000000000099";
const ATTACKER = "11111111-0000-4000-8000-000000000001";
const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const COURSE = "cccccccc-0000-4000-8000-0000000000cc";
const FOREIGN_TENANT_COURSE = "dddddddd-0000-4000-8000-0000000000dd";
const UNENROLLED_COURSE = "eeeeeeee-0000-4000-8000-0000000000ee";

// Courses and enrollments the fake DB knows about. The acting student
// (ATTACKER) belongs to TENANT_A and is enrolled ONLY in COURSE.
const COURSE_ROWS = {
  [COURSE]: { id: COURSE, school_id: TENANT_A, name: "내 과목", description: "d", syllabi: [] },
  [FOREIGN_TENANT_COURSE]: {
    id: FOREIGN_TENANT_COURSE,
    school_id: TENANT_B,
    name: "다른 대학 과목",
    description: "secret syllabus",
    syllabi: [{ raw_extracted_text: "OTHER-UNIVERSITY-SYLLABUS", parsed_text: null }],
  },
  [UNENROLLED_COURSE]: {
    id: UNENROLLED_COURSE,
    school_id: TENANT_A,
    name: "수강하지 않는 과목",
    description: "d",
    syllabi: [],
  },
};

// The enrollment carries the AUTHORITATIVE week. A caller-supplied week that
// merely falls in 1..30 is not evidence of anything.
const AUTHORITATIVE_WEEK = 3;
const ENROLLMENTS = [
  { student_id: ATTACKER, course_id: COURSE, status: "interested", current_week: AUTHORITATIVE_WEEK },
];

function makeRecordingClient() {
  const writes = [];

  function query(rows) {
    const filters = [];
    const api = {
      select: () => api,
      eq: (column, value) => (filters.push({ column, value }), api),
      in: () => api,
      limit: () => api,
      order: () => api,
      single: () => Promise.resolve(resolveOne()),
      maybeSingle: () => Promise.resolve(resolveOne()),
      then: (resolve, reject) => Promise.resolve({ data: matched(), error: null }).then(resolve, reject),
    };
    function matched() {
      return rows.filter((row) =>
        filters.every((f) => {
          const value = f.column.split(".").reduce((v, k) => (v == null ? v : v[k]), row);
          return value === f.value;
        }),
      );
    }
    function resolveOne() {
      const found = matched();
      return { data: found[0] ?? null, error: found.length ? null : { code: "PGRST116" } };
    }
    return api;
  }

  return {
    writes,
    from(table) {
      if (table === "courses") {
        return { select: () => query(Object.values(COURSE_ROWS)) };
      }
      if (table === "student_courses") {
        const enrollmentRows = ENROLLMENTS.map((e) => ({
          ...e,
          course: COURSE_ROWS[e.course_id],
        }));
        return {
          select: () => query(enrollmentRows),
          update: (payload) => {
            const record = { table, op: "update", payload, filters: {} };
            writes.push(record);
            const api = {
              eq: (column, value) => {
                record.filters[column] = value;
                return api;
              },
              then: (resolve, reject) =>
                Promise.resolve({ data: null, error: null }).then(resolve, reject),
            };
            return api;
          },
        };
      }
      return {
        select: () => query([{ profile_id: ATTACKER, target_career: null, interests: [], weak_basics: [] }]),
        upsert: (payload) => {
          writes.push({ table, op: "upsert", payload });
          return Promise.resolve({ error: null });
        },
        update: (payload) => {
          const record = { table, op: "update", payload, filters: {} };
          writes.push(record);
          const api = {
            eq: (column, value) => {
              record.filters[column] = value;
              return api;
            },
            then: (resolve, reject) =>
              Promise.resolve({ data: null, error: null }).then(resolve, reject),
          };
          return api;
        },
      };
    },
  };
}

function actingStudent() {
  return {
    id: ATTACKER,
    identifier: "attacker@example.test",
    name: "공격자",
    role: "student",
    school_id: TENANT_A,
    department_id: null,
  };
}

function installFetchSpy() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(args[0]);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"predicted_progress_text":"x","prep_review_guide":"y"}' } }] }),
      text: async () => "",
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function writesTargeting(writes, studentId) {
  return writes.filter(
    (write) => write.payload && write.payload.student_id === studentId,
  );
}

test("generateWeeklyGuide ignores a caller-supplied studentId that is not the session user", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = {
    id: ATTACKER,
    identifier: "attacker@example.test",
    name: "공격자",
    role: "student",
    school_id: "aaaaaaaa-0000-4000-8000-000000000001",
    department_id: null,
  };

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(COURSE, VICTIM, AUTHORITATIVE_WEEK);
  } finally {
    spy.restore();
  }

  assert.equal(
    writesTargeting(client.writes, VICTIM).length,
    0,
    "must never write student_mission_progress for a student other than the caller",
  );
});

test("generateWeeklyGuide performs no write and no paid API call without a session", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = null;

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(COURSE, VICTIM, AUTHORITATIVE_WEEK);
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "an unauthenticated call must write nothing");
  assert.equal(spy.calls.length, 0, "an unauthenticated call must not spend OpenAI credits");
});

test("submitProgressFeedback never advances another student's course week", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = {
    id: ATTACKER,
    identifier: "attacker@example.test",
    name: "공격자",
    role: "student",
    school_id: "aaaaaaaa-0000-4000-8000-000000000001",
    department_id: null,
  };

  try {
    const actions = await loadActions();
    await actions.submitProgressFeedback(COURSE, VICTIM, AUTHORITATIVE_WEEK, "피드백");
  } finally {
    spy.restore();
  }

  assert.equal(
    writesTargeting(client.writes, VICTIM).length,
    0,
    "must never write progress rows for another student",
  );

  // Advancing the CALLER's own week is the legitimate behaviour; what must never
  // happen is that update landing on the victim's row.
  const weekUpdates = client.writes.filter((write) => write.table === "student_courses");
  for (const update of weekUpdates) {
    assert.notEqual(
      update.filters.student_id,
      VICTIM,
      "must never advance another student's current_week",
    );
    assert.equal(
      update.filters.student_id,
      ATTACKER,
      "the week update must be scoped to the authenticated caller",
    );
  }
});

test("submitProgressFeedback performs no write without a session", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = null;

  try {
    const actions = await loadActions();
    await actions.submitProgressFeedback(COURSE, VICTIM, AUTHORITATIVE_WEEK, "피드백");
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "an unauthenticated call must write nothing");
});

// --- Review finding 2: authorization beyond studentId ---------------------
//
// Deriving studentId from the session closed the identity hole but left
// courseId and currentWeek caller-supplied and unvalidated. A student could
// therefore name ANOTHER UNIVERSITY'S course id: its syllabus text would be
// read and sent to OpenAI (cross-tenant data exfiltration through the prompt),
// and progress rows would be written for a course the caller does not own.

test("generateWeeklyGuide refuses a course belonging to another tenant", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(FOREIGN_TENANT_COURSE, ATTACKER, 3);
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "must not write progress for a foreign-tenant course");
  assert.equal(
    spy.calls.length,
    0,
    "must not send another tenant's syllabus to OpenAI — cross-tenant exfiltration",
  );
});

test("generateWeeklyGuide refuses a same-tenant course the student is not enrolled in", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(UNENROLLED_COURSE, ATTACKER, 3);
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "must not write progress for an unenrolled course");
  assert.equal(spy.calls.length, 0, "must not spend OpenAI credits for an unenrolled course");
});

test("generateWeeklyGuide still works for the student's own enrolled course", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(COURSE, ATTACKER, AUTHORITATIVE_WEEK);
  } finally {
    spy.restore();
  }

  const progressWrites = client.writes.filter((w) => w.table === "student_mission_progress");
  assert.equal(progressWrites.length, 1, "the legitimate path must still write exactly one row");
  assert.equal(progressWrites[0].payload.student_id, ATTACKER);
  assert.equal(progressWrites[0].payload.course_id, COURSE);
  assert.equal(spy.calls.length, 1, "the legitimate path must still call OpenAI once");
});

test("an out-of-range week is rejected rather than written verbatim", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(COURSE, ATTACKER, 9999);
    await actions.generateWeeklyGuide(COURSE, ATTACKER, -1);
    await actions.generateWeeklyGuide(COURSE, ATTACKER, 1.5);
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "an implausible week must not create rows");
  assert.equal(spy.calls.length, 0, "an implausible week must not reach OpenAI");
});

test("submitProgressFeedback refuses a foreign-tenant course", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.submitProgressFeedback(FOREIGN_TENANT_COURSE, ATTACKER, 3, "피드백");
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "must not write or advance week for a foreign-tenant course");
  assert.equal(spy.calls.length, 0, "must not reach OpenAI for a foreign-tenant course");
});

// --- Review finding 2 (round 2): the week itself must be authorized ---------
//
// Bounding the week to 1..30 only rejects absurd input. A week inside that
// range is still caller-supplied and therefore proves nothing: a student could
// generate guides for, or overwrite progress at, any week of a course they are
// legitimately enrolled in — including weeks they have not reached, and stale
// weeks after their enrollment has moved on. The authoritative week lives on
// the enrollment row and must be read server-side.

test("a valid-range but unauthorized week is rejected before any side effect", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    // In range (1..30), enrolled course, right tenant — but not this student's
    // current week.
    await actions.generateWeeklyGuide(COURSE, ATTACKER, AUTHORITATIVE_WEEK + 2);
  } finally {
    spy.restore();
  }

  assert.equal(spy.calls.length, 0, "must not reach OpenAI for a week the student is not on");
  assert.equal(client.writes.length, 0, "must not write progress for an unauthorized week");
});

test("a stale week from an out-of-date client is rejected", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.generateWeeklyGuide(COURSE, ATTACKER, AUTHORITATIVE_WEEK - 1);
  } finally {
    spy.restore();
  }

  assert.equal(spy.calls.length, 0, "a stale week must not regenerate content");
  assert.equal(client.writes.length, 0, "a stale week must not overwrite progress");
});

test("submitProgressFeedback rejects a valid-range but unauthorized week", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.submitProgressFeedback(COURSE, ATTACKER, AUTHORITATIVE_WEEK + 5, "피드백");
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "must not write feedback for an unauthorized week");
  assert.equal(
    client.writes.filter((w) => w.table === "student_courses").length,
    0,
    "must not advance enrollment state from an unauthorized week",
  );
  assert.equal(spy.calls.length, 0, "must not reach OpenAI");
});

test("submitProgressFeedback advances the enrollment using the server-derived week", async () => {
  const client = makeRecordingClient();
  const spy = installFetchSpy();
  globalThis.__stage8AiClient = client;
  globalThis.__stage8AiProfile = actingStudent();

  try {
    const actions = await loadActions();
    await actions.submitProgressFeedback(COURSE, ATTACKER, AUTHORITATIVE_WEEK, "피드백");
  } finally {
    spy.restore();
  }

  const advance = client.writes.find((w) => w.table === "student_courses");
  assert.ok(advance, "the legitimate path must still advance the enrollment");
  assert.equal(
    advance.payload.current_week,
    AUTHORITATIVE_WEEK + 1,
    "the next week must be derived from the stored week, not from caller input",
  );
  assert.equal(advance.filters.student_id, ATTACKER, "the advance must be scoped to the caller");
});
