import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 5 behavior tests for the REAL updateCounselingStatus (matrix M4/M5 +
// KI-015 cancel copy), driven through the repo's transpile-loader convention
// (see counseling.actions.test.mjs). The fake client's .eq/.in filters really
// filter fixture rows, so the compare-and-set from-state predicate is tested
// behaviorally: a transition whose predicate matches zero rows gets PostgREST's
// PGRST116, exactly like the live API.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__stage5AdminClient;",
);
const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__stage5AdminClient;",
);
const ANON_STUB = toDataUrl("export const supabase = globalThis.__stage5AdminClient;");
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
const ROADMAP_STUB = toDataUrl(
  "export const textareaToList = (value) => (value ? value.split('\\n').filter(Boolean) : []);",
);

const domainUrl = new URL("../lib/counseling-slots.ts", import.meta.url).href;

let modulesPromise;
function loadActions() {
  modulesPromise ??= (async () => {
    let source = await readFile(new URL("./professor.actions.ts", import.meta.url), "utf8");
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "@/lib/supabase/client"', `from ${JSON.stringify(ANON_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFY_STUB)}`],
      ['from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`],
      ['from "@/services/roadmap-revisions.service"', `from ${JSON.stringify(ROADMAP_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_SERVICE_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import remains in professor.actions.ts");
    return import(toDataUrl(compiled));
  })();
  return modulesPromise;
}

function makeFakeDb() {
  const state = { fixtures: {}, updates: [] };

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
      update: (values) => ((q.op = "update"), (q.values = values), builder),
      single: () => ((q.single = true), builder),
      maybeSingle: () => ((q.maybe = true), builder),
      then: (resolve, reject) => run().then(resolve, reject),
    };

    async function run() {
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
      return { data: rows, error: null };
    }

    return builder;
  }

  return { state, from: (table) => makeBuilder(table) };
}

const PROFESSOR_PROFILE = {
  id: "prof-profile-1",
  identifier: "prof1@pacemate.edu",
  name: "김교수",
  role: "professor",
  school_id: "s1",
  department_id: null,
};

function requestRow(status = "pending") {
  return {
    id: "req-1",
    student_id: "student-1",
    professor_id: "prof-1",
    topic: "학업 상담",
    requested_start: "2026-09-07T01:00:00.000Z",
    requested_end: "2026-09-07T01:30:00.000Z",
    professor_note: null,
    suggested_start: null,
    suggested_end: null,
    status,
  };
}

function setupWorld(rows) {
  const db = makeFakeDb();
  db.state.fixtures.counseling_requests = rows;
  globalThis.__stage5AdminClient = db;
  globalThis.__stage5Profile = PROFESSOR_PROFILE;
  globalThis.__stage5Notifications = [];
  globalThis.__stage5Revalidated = [];
  globalThis.__stage5NotificationResult = { ok: true };
  return db;
}

function teardownWorld() {
  delete globalThis.__stage5AdminClient;
  delete globalThis.__stage5Profile;
  delete globalThis.__stage5Notifications;
  delete globalThis.__stage5Revalidated;
  delete globalThis.__stage5NotificationResult;
}

function transitionForm(status, extra = {}) {
  const form = new FormData();
  form.set("requestId", "req-1");
  form.set("status", status);
  for (const [key, value] of Object.entries(extra)) {
    form.set(key, value);
  }
  return form;
}

const CONFLICT_MESSAGE = "이미 처리된 상담 신청입니다. 최신 상태를 확인해 주세요.";

test("characterization: approving a pending request succeeds and notifies the student", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("pending")]);
  try {
    const result = await actions.updateCounselingStatus(transitionForm("approved"));

    assert.equal(result.ok, true, result.message);
    assert.equal(db.state.fixtures.counseling_requests[0].status, "approved");
    assert.equal(globalThis.__stage5Notifications.length, 1);
    assert.equal(globalThis.__stage5Notifications[0].title, "상담 신청이 승인됐습니다");
    assert.deepEqual(globalThis.__stage5Revalidated, ["/professor", "/counseling"]);
  } finally {
    teardownWorld();
  }
});

test("characterization: rejecting a pending request keeps its required fields and copy", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("pending")]);
  try {
    const missing = await actions.updateCounselingStatus(transitionForm("rejected"));
    assert.equal(missing.ok, false);
    assert.match(missing.message, /거절 사유와 추천 시간대/);

    const result = await actions.updateCounselingStatus(
      transitionForm("rejected", {
        professorNote: "이번 주는 어렵습니다.",
        suggestedStart: "2026-09-08T01:00:00.000Z",
        suggestedEnd: "2026-09-08T01:30:00.000Z",
      }),
    );
    assert.equal(result.ok, true, result.message);
    assert.equal(db.state.fixtures.counseling_requests[0].status, "rejected");
    assert.equal(globalThis.__stage5Notifications[0].title, "상담 시간이 조정 필요합니다");
  } finally {
    teardownWorld();
  }
});

test("M5: a terminal (cancelled) request cannot be resurrected to approved", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("cancelled")]);
  try {
    const result = await actions.updateCounselingStatus(transitionForm("approved"));

    assert.equal(result.ok, false, "resurrecting a cancelled request must be a controlled conflict");
    assert.equal(result.message, CONFLICT_MESSAGE);
    assert.equal(
      db.state.fixtures.counseling_requests[0].status,
      "cancelled",
      "the terminal row must be untouched",
    );
    assert.equal(globalThis.__stage5Notifications.length, 0, "no notification for a lost transition");
    assert.deepEqual(
      globalThis.__stage5Revalidated,
      ["/professor", "/counseling"],
      "a lost transition proves the data changed — the stale workspace must revalidate",
    );
  } finally {
    teardownWorld();
  }
});

test("M4: competing transitions on one request — exactly one wins, one notification", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("pending")]);
  try {
    const first = await actions.updateCounselingStatus(transitionForm("approved"));
    const second = await actions.updateCounselingStatus(transitionForm("approved"));

    assert.equal(first.ok, true, first.message);
    assert.equal(second.ok, false, "the losing transition must not report success");
    assert.equal(second.message, CONFLICT_MESSAGE);
    assert.equal(db.state.fixtures.counseling_requests[0].status, "approved");
    assert.equal(
      globalThis.__stage5Notifications.length,
      1,
      "the student must not receive contradictory notifications",
    );
  } finally {
    teardownWorld();
  }
});

test("M4: reject loses against an already-approved request", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("approved")]);
  try {
    const result = await actions.updateCounselingStatus(
      transitionForm("rejected", {
        professorNote: "이번 주는 어렵습니다.",
        suggestedStart: "2026-09-08T01:00:00.000Z",
      }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.message, CONFLICT_MESSAGE);
    assert.equal(db.state.fixtures.counseling_requests[0].status, "approved");
  } finally {
    teardownWorld();
  }
});

test("M5: pending is not an accepted target status", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("cancelled")]);
  try {
    const result = await actions.updateCounselingStatus(transitionForm("pending"));

    assert.equal(result.ok, false, "cancelled→pending resurrection must be rejected");
    assert.equal(db.state.updates.length, 0, "no UPDATE may be issued for an illegal target");
    assert.equal(db.state.fixtures.counseling_requests[0].status, "cancelled");
  } finally {
    teardownWorld();
  }
});

test("cancelling an approved request is legal and sends honest copy (KI-015)", async () => {
  const actions = await loadActions();
  const db = setupWorld([requestRow("approved")]);
  try {
    const result = await actions.updateCounselingStatus(transitionForm("cancelled"));

    assert.equal(result.ok, true, result.message);
    assert.equal(db.state.fixtures.counseling_requests[0].status, "cancelled");
    assert.equal(globalThis.__stage5Notifications.length, 1);
    const notification = globalThis.__stage5Notifications[0];
    assert.notEqual(
      notification.title,
      "상담 시간이 조정 필요합니다",
      "a cancellation must not masquerade as a time adjustment",
    );
    assert.match(notification.title, /취소/);
    assert.doesNotMatch(
      notification.body,
      /추천 시간으로 다시 예약/,
      "cancel copy must not promise a suggested time it just nulled out",
    );
    assert.doesNotMatch(notification.body, /^\s/, "no leading-space body built from an empty note");
  } finally {
    teardownWorld();
  }
});
