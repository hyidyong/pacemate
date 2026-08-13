// Codex round 3, F6 — the weekly-progress compare-and-set must have exactly one
// winner, and only the winner may spend a paid model call.
//
// The CAS previously inspected only the query's `error`. A CAS that matches ZERO
// rows is not an error — it is a loser — so every concurrent caller fell through
// to generateWeeklyGuide() and every one of them called OpenAI.
//
// The fake below models zero-row CAS correctly: `update(...).eq(...).select()`
// returns the rows it actually matched, and the week only advances once.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const SESSION_STUB = toDataUrl("export const getDemoProfile = async () => globalThis.__casProfile;");
const CLIENT_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__casClient;",
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

/**
 * Minimal Supabase stand-in with ONE shared enrolment row, so a CAS on
 * `current_week` genuinely has one winner.
 */
function createCasWorld({ startWeek = 5 } = {}) {
  const state = { week: startWeek, upserts: 0, casAttempts: 0, casWinners: 0 };

  const builder = (table) => {
    const filters = {};
    const api = {
      select() {
        return api;
      },
      eq(column, value) {
        filters[column] = value;
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        if (table === "student_courses") {
          return {
            data: { course_id: COURSE, current_week: state.week, course: { id: COURSE, school_id: SCHOOL } },
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
      async upsert() {
        state.upserts += 1;
        return { error: null };
      },
      update(patch) {
        const updateApi = {
          eq(column, value) {
            filters[column] = value;
            return updateApi;
          },
          // The CAS: matches only if the expected week is still current.
          async select() {
            state.casAttempts += 1;
            if (filters.current_week === state.week) {
              state.week = patch.current_week;
              state.casWinners += 1;
              return { data: [{ id: "enrolment" }], error: null };
            }
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
  };

  return { state, client: { from: (table) => builder(table) } };
}

function installWorld(world) {
  globalThis.__casClient = world.client;
  globalThis.__casProfile = { id: STUDENT, role: "student", school_id: SCHOOL };
}

test("a lone submission advances the week and generates exactly one guide", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createCasWorld({ startWeek: 5 });
  installWorld(world);

  let modelCalls = 0;
  globalThis.fetch = async () => {
    modelCalls += 1;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      text: async () => "",
    };
  };
  process.env.OPENAI_API_KEY = "test-key";

  await submitProgressFeedback(COURSE, STUDENT, 5, "feedback");

  assert.equal(world.state.casWinners, 1, "the CAS should have exactly one winner");
  assert.equal(world.state.week, 6, "the week should advance once");
  assert.equal(modelCalls, 1, `expected 1 model call, got ${modelCalls}`);
});

test("concurrent submissions produce ONE winner and ONE paid model call", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createCasWorld({ startWeek: 5 });
  installWorld(world);

  let modelCalls = 0;
  globalThis.fetch = async () => {
    modelCalls += 1;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      text: async () => "",
    };
  };
  process.env.OPENAI_API_KEY = "test-key";

  // Four callers race the same expected state.
  await Promise.all([
    submitProgressFeedback(COURSE, STUDENT, 5, "a"),
    submitProgressFeedback(COURSE, STUDENT, 5, "b"),
    submitProgressFeedback(COURSE, STUDENT, 5, "c"),
    submitProgressFeedback(COURSE, STUDENT, 5, "d"),
  ]);

  assert.ok(world.state.casAttempts >= 2, "expected the callers to contend");
  assert.equal(world.state.casWinners, 1, `${world.state.casWinners} callers won the CAS`);
  assert.equal(world.state.week, 6, "the week must advance exactly once");
  assert.equal(modelCalls, 1, `losers must not call the model — total calls: ${modelCalls}`);
});

test("a stale week is rejected before any write or model call", async () => {
  const { submitProgressFeedback } = await loadActions();
  const world = createCasWorld({ startWeek: 7 });
  installWorld(world);

  let modelCalls = 0;
  globalThis.fetch = async () => {
    modelCalls += 1;
    return { ok: true, json: async () => ({ choices: [] }), text: async () => "" };
  };

  // The caller believes it is week 5; the enrolment is already at 7.
  await submitProgressFeedback(COURSE, STUDENT, 5, "stale");

  assert.equal(world.state.casAttempts, 0, "an unauthorized week must not reach the CAS");
  assert.equal(world.state.upserts, 0, "an unauthorized week must not write progress");
  assert.equal(modelCalls, 0, "an unauthorized week must not call the model");
});

test("the CAS requires evidence of the matched row, not merely absence of an error", () => {
  const source = readFileSync(fileURLToPath(new URL("./ai-tutor.actions.ts", import.meta.url)), "utf8");
  const cas = source.slice(source.indexOf('.eq("current_week", authorizedWeek)'));
  assert.match(cas.slice(0, 400), /\.select\(/, "the CAS must return the matched row");
  assert.match(source, /advanced\.length !== 1/, "a zero-row CAS must be treated as a loser");
});
