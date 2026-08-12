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
const COURSE = "cccccccc-0000-4000-8000-0000000000cc";

function makeRecordingClient() {
  const writes = [];

  function chain(result) {
    const api = {
      select: () => api,
      eq: () => api,
      single: () => Promise.resolve({ data: result, error: null }),
      maybeSingle: () => Promise.resolve({ data: result, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return api;
  }

  return {
    writes,
    from(table) {
      return {
        select: () => chain(table === "courses" ? { name: "테스트", description: "d", syllabi: [] } : {}),
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
    await actions.generateWeeklyGuide(COURSE, VICTIM, 3);
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
    await actions.generateWeeklyGuide(COURSE, VICTIM, 3);
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
    await actions.submitProgressFeedback(COURSE, VICTIM, 3, "피드백");
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
    await actions.submitProgressFeedback(COURSE, VICTIM, 3, "피드백");
  } finally {
    spy.restore();
  }

  assert.equal(client.writes.length, 0, "an unauthenticated call must write nothing");
});
