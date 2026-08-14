// Codex round 4, finding 3 — the weekly advance must target ONE EXACT
// enrollment, and feedback must not be written by a caller that has not yet won.
//
// Three defects, all confirmed against the code and the live schema:
//
//   1. authorizeCourseForStudent() selected `course_id, current_week` and threw
//      the enrollment's PRIMARY KEY away.
//   2. The CAS therefore matched on `student_id + course_id + current_week` — a
//      broad predicate. `student_courses` is UNIQUE on
//      (student_id, course_id, STATUS), so several rows per (student, course)
//      are representable, and the app writes at least two statuses
//      ("interested" and "completed"). Every matching row advanced.
//   3. Feedback was upserted BEFORE the CAS ran, so a caller that went on to
//      lose the race had already written.
//
// The fake below holds a LIST of enrollments, so a broad predicate advances all
// of them and an exact one advances a single row. A single-row fake — which is
// what the round-3 test used — cannot see this defect at all.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const SESSION_STUB = toDataUrl("export const getDemoProfile = async () => globalThis.__exactProfile;");
const CLIENT_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__exactClient;",
);

let modulePromise;
async function loadActions() {
  modulePromise ??= (async () => {
    let source = readFileSync(fileURLToPath(new URL("./ai-tutor.actions.ts", import.meta.url)), "utf8");
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(CLIENT_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import");
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

const STUDENT = "11111111-1111-4111-8111-111111111111";
const SCHOOL = "22222222-2222-4222-8222-222222222222";
const COURSE = "33333333-3333-4333-8333-333333333333";
const ACTIVE = "aaaaaaaa-1111-4111-8111-111111111111";
const COMPLETED = "bbbbbbbb-2222-4222-8222-222222222222";

/**
 * Two enrollments for the SAME (student, course), differing only by status —
 * exactly what `UNIQUE (student_id, course_id, status)` permits and what the
 * app produces by writing both "interested" and "completed".
 *
 * The RPC is modelled the way Postgres behaves: the row is matched by primary
 * key AND expected week inside one transaction, so a loser matches nothing and
 * writes nothing.
 */
function createWorld({ startWeek = 5 } = {}) {
  const enrollments = [
    { id: ACTIVE, status: "interested", current_week: startWeek, updated_at: "2026-08-14T00:00:00Z" },
    { id: COMPLETED, status: "completed", current_week: startWeek, updated_at: "2026-01-01T00:00:00Z" },
  ];
  const state = { enrollments, feedbackWrites: [], missionWrites: [], rpcCalls: [], winners: 0 };

  const client = {
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      const row = enrollments.find((e) => e.id === args.p_enrollment_id);
      // Compare-and-set inside the "transaction": the expected week must still
      // be current. A loser writes NOTHING — not even feedback.
      if (!row || row.current_week !== args.p_expected_week) {
        return { data: { outcome: "stale" }, error: null };
      }
      state.feedbackWrites.push({ week: args.p_expected_week, feedback: args.p_feedback });
      row.current_week = args.p_expected_week + 1;
      state.winners += 1;
      return {
        data: { outcome: "advanced", advanced_to: row.current_week, course_id: COURSE },
        error: null,
      };
    },
    from(table) {
      const filters = {};
      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        async maybeSingle() {
          if (table === "student_courses") {
            // Deterministic pick: newest updated_at first, matching the action.
            const sorted = [...enrollments].sort((l, r) => (l.updated_at < r.updated_at ? 1 : -1));
            const chosen = sorted[0];
            return {
              data: {
                id: chosen.id,
                course_id: COURSE,
                current_week: chosen.current_week,
                course: { id: COURSE, school_id: SCHOOL },
              },
              error: null,
            };
          }
          if (table === "courses") {
            return { data: { name: "c", description: "d", syllabi: [] }, error: null };
          }
          if (table === "student_profiles") {
            return { data: { target_career: null, interests: [], weak_basics: [] }, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          return api.maybeSingle();
        },
        async upsert(row) {
          // generateWeeklyGuide legitimately upserts the AI-GENERATED MISSION
          // for the next week, and only the winner reaches it. What must never
          // happen outside the transaction is a FEEDBACK write — that is the
          // one the loser used to perform before finding out it had lost.
          if (row?.calibrated_by_ai) {
            state.missionWrites.push(row);
          } else {
            state.feedbackWrites.push({ viaAction: true, ...row });
          }
          return { error: null };
        },
        update() {
          const updateApi = {
            eq(column, value) {
              filters[column] = value;
              return updateApi;
            },
            async select() {
              // A broad UPDATE reaching the fake at all means the action is
              // still using the old predicate.
              state.brokeOut = true;
              return { data: [], error: null };
            },
            then(resolve) {
              return updateApi.select().then(resolve);
            },
          };
          return updateApi;
        },
      };
      return api;
    },
  };

  return { state, client };
}

function install(world) {
  globalThis.__exactClient = world.client;
  globalThis.__exactProfile = { id: STUDENT, role: "student", school_id: SCHOOL };
}

function countModelCalls() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      text: async () => "",
    };
  };
  process.env.OPENAI_API_KEY = "test-key";
  return () => calls;
}

test("a lone submission advances exactly ONE enrollment and generates one guide", async () => {
  // Supersedes the round-3 F6 test of the same name: that one used a
  // single-enrollment fake, which could not see the broad-predicate defect.
  const { submitProgressFeedback } = await loadActions();
  const world = createWorld({ startWeek: 5 });
  install(world);
  const modelCalls = countModelCalls();

  await submitProgressFeedback(COURSE, STUDENT, 5, "feedback");

  const [active, completed] = world.state.enrollments;
  assert.equal(active.current_week, 6, "the authorized enrollment must advance");
  assert.equal(
    completed.current_week,
    5,
    "the OTHER enrollment for the same student and course must not move",
  );
  assert.equal(modelCalls(), 1, `the legitimate path generates exactly one guide, got ${modelCalls()}`);
  assert.equal(world.state.missionWrites.length, 1, "and persists exactly one generated mission");
});

test("the CAS is addressed by enrollment id, not by a broad status-blind predicate", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createWorld({ startWeek: 5 });
  install(world);
  countModelCalls();

  await submitProgressFeedback(COURSE, STUDENT, 5, "feedback");

  assert.equal(world.state.rpcCalls.length, 1, "expected exactly one atomic transition call");
  const [call] = world.state.rpcCalls;
  assert.equal(call.args.p_enrollment_id, ACTIVE, "the exact enrollment PK must be carried through");
  assert.equal(call.args.p_expected_week, 5, "the expected state must be part of the transition");
  assert.ok(!world.state.brokeOut, "no broad UPDATE may reach student_courses from the action");
});

test("concurrent callers: one winner, one transition, one feedback write, one model call", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createWorld({ startWeek: 5 });
  install(world);
  const modelCalls = countModelCalls();

  await Promise.all([
    submitProgressFeedback(COURSE, STUDENT, 5, "a"),
    submitProgressFeedback(COURSE, STUDENT, 5, "b"),
    submitProgressFeedback(COURSE, STUDENT, 5, "c"),
    submitProgressFeedback(COURSE, STUDENT, 5, "d"),
  ]);

  assert.equal(world.state.winners, 1, `${world.state.winners} callers won`);
  assert.equal(world.state.enrollments[0].current_week, 6, "the week must advance exactly once");
  assert.equal(
    world.state.feedbackWrites.length,
    1,
    `a loser must not write feedback — ${world.state.feedbackWrites.length} writes`,
  );
  assert.equal(modelCalls(), 1, `losers must not call the model — ${modelCalls()} calls`);
});

test("a LOSER writes no feedback at all — the write is inside the transition", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createWorld({ startWeek: 5 });
  install(world);
  const modelCalls = countModelCalls();

  // First caller wins and moves the enrollment to week 6.
  await submitProgressFeedback(COURSE, STUDENT, 5, "winner");
  const afterWinner = world.state.feedbackWrites.length;

  // Second caller still believes it is week 5. Under the old design its
  // feedback upsert ran BEFORE the CAS, so it wrote and then lost.
  await submitProgressFeedback(COURSE, STUDENT, 5, "loser");

  assert.equal(
    world.state.feedbackWrites.length,
    afterWinner,
    "the losing caller must not have persisted anything",
  );
  assert.equal(modelCalls(), 1);
});

test("a zero-row transition is never treated as success", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createWorld({ startWeek: 7 });
  install(world);
  const modelCalls = countModelCalls();

  // The caller believes it is week 5; both enrollments are at 7.
  await submitProgressFeedback(COURSE, STUDENT, 5, "stale");

  assert.equal(world.state.rpcCalls.length, 0, "an unauthorized week must not reach the transition");
  assert.equal(world.state.feedbackWrites.length, 0);
  assert.equal(modelCalls(), 0);
  assert.equal(world.state.enrollments[0].current_week, 7, "nothing may move");
});

test("the transition is a single transactional RPC, not two round trips", () => {
  const source = readFileSync(fileURLToPath(new URL("./ai-tutor.actions.ts", import.meta.url)), "utf8");
  const code = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

  assert.match(code, /\.rpc\("advance_student_week"/, "the atomic transition must be an RPC");
  assert.match(code, /p_enrollment_id/, "the exact enrollment PK must be passed");
  // The old shape must be gone: no direct week update from the action.
  assert.doesNotMatch(
    code,
    /update\(\{ current_week/,
    "the action must not write current_week outside the transaction",
  );
  // Scope the assertion to submitProgressFeedback. generateWeeklyGuide keeps a
  // legitimate upsert of the AI-generated mission, which only the WINNER
  // reaches; what must be gone is a feedback write before the transition.
  const action = code.slice(code.indexOf("export async function submitProgressFeedback"));
  assert.doesNotMatch(
    action,
    /from\("student_mission_progress"\)/,
    "feedback must be written inside the transition, not before it",
  );
  assert.ok(
    action.indexOf('.rpc("advance_student_week"') > -1,
    "the transition must be the first and only write submitProgressFeedback performs",
  );
});

test("the RPC binds to the caller and re-verifies ownership itself", () => {
  const migration = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260814170000_stage9_ai_progress_atomic_advance.sql", import.meta.url)),
    "utf8",
  );
  const sql = migration
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  // An enrollment id arriving from the caller is untrusted input.
  assert.match(sql, /app_private\.current_profile_id\(\)/);
  assert.match(sql, /app_private\.current_school_id\(\)/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/);
  // The lock is what makes concurrent callers serialize on the exact row.
  assert.match(sql, /for update of sc/i);
  assert.match(sql, /sc\.current_week = p_expected_week/);
  // anon must never reach it.
  assert.match(sql, /revoke all on function public\.advance_student_week/i);
  assert.match(sql, /grant execute on function public\.advance_student_week[\s\S]*to authenticated/i);
});
