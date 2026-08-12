import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 P1-1. The busy feed (`getBusyRequests`) filtered only on
// status IN (pending, approved) — no professor, no tenant, and critically no
// TIME WINDOW. An `approved` row never leaves that status, so the result set
// grew with cumulative platform-wide bookings forever, on every /counseling
// render AND inside every booking action.
//
// The bound is provably behaviour-preserving rather than heuristic: the slot
// builder only considers local dates today+1..today+14
// (counseling-slots.ts:107), so a booking whose range ended before now cannot
// overlap any bookable slot, and one starting beyond the horizon cannot either.
//
// These tests assert the QUERY is bounded and that a long-past booking no
// longer reaches the slot builder, while an in-horizon booking still does —
// the D-011 cross-student visibility that makes displayed availability honest.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__stage8CounselingSession;",
);
const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__stage8CounselingAdmin;",
);
const SESSION_SERVICE_STUB = toDataUrl(
  "export const getDemoProfile = async () => globalThis.__stage8CounselingProfile;",
);

const domainUrl = new URL("../lib/counseling-slots.ts", import.meta.url).href;
const tenantUrl = new URL("../lib/tenant.ts", import.meta.url).href;

let modulesPromise;
function loadService() {
  modulesPromise ??= (async () => {
    let source = await readFile(new URL("./counseling.service.ts", import.meta.url), "utf8");
    source = source.replace('import "server-only";', "");
    for (const [from, to] of [
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_SERVICE_STUB)}`],
      ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
      ['from "@/lib/tenant"', `from ${JSON.stringify(tenantUrl)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(
      !compiled.includes('from "@/'),
      "unrewritten alias import remains in counseling.service.ts",
    );
    return import(toDataUrl(compiled));
  })();
  return modulesPromise;
}

const TENANT = "862b661c-810a-4440-ba76-722b2fcf8d6a";
const PROFESSOR = "d5104d02-ece2-400a-8c51-d8b26d34754f";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysFromNow(days, hour = 3) {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

// Busy rows: one from a year ago (must be filtered out at the DB), one inside
// the slot horizon (must still be seen — other students' bookings).
const ANCIENT_BUSY = {
  professor_id: PROFESSOR,
  status: "approved",
  requested_start: isoDaysFromNow(-365),
  requested_end: isoDaysFromNow(-365, 4),
};
const IN_HORIZON_BUSY = {
  professor_id: PROFESSOR,
  status: "approved",
  requested_start: isoDaysFromNow(3),
  requested_end: isoDaysFromNow(3, 4),
};

function makeQuery(rows, record) {
  const filters = [];
  const api = {
    select() {
      return api;
    },
    eq(col, val) {
      filters.push({ op: "eq", col, val });
      return api;
    },
    in(col, val) {
      filters.push({ op: "in", col, val });
      return api;
    },
    gte(col, val) {
      filters.push({ op: "gte", col, val });
      return api;
    },
    gt(col, val) {
      filters.push({ op: "gt", col, val });
      return api;
    },
    lt(col, val) {
      filters.push({ op: "lt", col, val });
      return api;
    },
    lte(col, val) {
      filters.push({ op: "lte", col, val });
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    then(resolve, reject) {
      if (record) record.filters = filters;
      const matched = rows.filter((row) =>
        filters.every((f) => {
          const value = row[f.col];
          if (f.op === "eq") return value === f.val;
          if (f.op === "in") return f.val.includes(value);
          if (f.op === "gte") return String(value) >= String(f.val);
          if (f.op === "gt") return String(value) > String(f.val);
          if (f.op === "lt") return String(value) < String(f.val);
          if (f.op === "lte") return String(value) <= String(f.val);
          return true;
        }),
      );
      return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
    },
  };
  return api;
}

function setupClients() {
  const busyRecord = {};
  const busyRows = [ANCIENT_BUSY, IN_HORIZON_BUSY];

  globalThis.__stage8CounselingAdmin = {
    from(table) {
      if (table === "counseling_requests") {
        return makeQuery(busyRows, busyRecord);
      }
      return makeQuery([], null);
    },
  };

  // Availability that produces bookable slots for the professor every weekday.
  const availabilityRows = [
    {
      professor_id: PROFESSOR,
      day_of_week: null,
      specific_date: null,
      start_time: "09:00:00",
      end_time: "18:00:00",
      slot_minutes: 30,
      is_active: true,
      professor: { id: PROFESSOR, name: "박성은", office: null, email: null, school_id: TENANT },
    },
  ];

  globalThis.__stage8CounselingSession = {
    from(table) {
      if (table === "professor_availability") {
        // day_of_week null + specific_date null would be rejected by the DB, so
        // emit one row per weekday instead.
        return makeQuery(
          [0, 1, 2, 3, 4, 5, 6].map((day) => ({ ...availabilityRows[0], day_of_week: day })),
          null,
        );
      }
      return makeQuery([], null);
    },
  };

  globalThis.__stage8CounselingProfile = {
    id: "11111111-0000-4000-8000-000000000001",
    identifier: "student@example.test",
    name: "학생",
    role: "student",
    school_id: TENANT,
    department_id: null,
  };

  return { busyRecord };
}

test("the busy feed query is bounded by a time window", async () => {
  const { busyRecord } = setupClients();
  const service = await loadService();
  await service.getAvailableCounselingSlots(TENANT);

  const filters = busyRecord.filters ?? [];
  const timeBounds = filters.filter(
    (f) =>
      ["gte", "gt", "lt", "lte"].includes(f.op) &&
      ["requested_start", "requested_end"].includes(f.col),
  );

  assert.ok(
    timeBounds.length > 0,
    `the busy feed must carry a time bound, got filters: ${JSON.stringify(filters)}`,
  );
});

test("a long-past booking is excluded while an in-horizon booking is still seen", async () => {
  const { busyRecord } = setupClients();
  const service = await loadService();
  const slots = await service.getAvailableCounselingSlots(TENANT);

  const filters = busyRecord.filters ?? [];
  const matched = [ANCIENT_BUSY, IN_HORIZON_BUSY].filter((row) =>
    filters.every((f) => {
      const value = row[f.col];
      if (f.op === "eq") return value === f.val;
      if (f.op === "in") return f.val.includes(value);
      if (f.op === "gte") return String(value) >= String(f.val);
      if (f.op === "gt") return String(value) > String(f.val);
      if (f.op === "lt") return String(value) < String(f.val);
      if (f.op === "lte") return String(value) <= String(f.val);
      return true;
    }),
  );

  assert.ok(
    !matched.includes(ANCIENT_BUSY),
    "a booking that ended a year ago must not be fetched — it can never overlap a bookable slot",
  );
  assert.ok(
    matched.includes(IN_HORIZON_BUSY),
    "an in-horizon booking must still be fetched (D-011 cross-student visibility)",
  );

  // And it must actually consume availability: the slot it occupies is gone.
  const occupiedId = slots.find(
    (slot) =>
      slot.professorId === PROFESSOR &&
      new Date(slot.start).getTime() === new Date(IN_HORIZON_BUSY.requested_start).getTime(),
  );
  assert.equal(
    occupiedId,
    undefined,
    "the in-horizon booking must still remove its slot from the bookable set",
  );
});
