import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 3 waterfall guard (deterministic proxy): getCounselingPageData used to
// await two Promise.all batches even though the second (courses + professors)
// consumed nothing from the first — a false sequential WAN stage. The fake
// client defers every resolution one macrotask, so the number of queries issued
// BEFORE the first resolution reveals the real await topology. Only the
// student_courses -> course_professors hop is a true data dependency.

function stubModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const SERVER_STUB = stubModule(
  "export const createSupabaseServerClient = async () => globalThis.__stage3FakeSupabase;",
);

async function loadCounselingService() {
  const source = await readFile(new URL("./counseling.service.ts", import.meta.url), "utf8");
  const domainUrl = new URL("../lib/counseling-slots.ts", import.meta.url).href;
  const rewritten = source
    .replace('import "server-only";', "")
    .replace('from "@/lib/counseling-slots"', `from ${JSON.stringify(domainUrl)}`)
    .replace('from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`);
  const compiled = transpileModule(rewritten, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function makeDeferredFakeSupabase() {
  const state = { counts: {}, issuedBeforeFirstResolve: 0, resolvedAny: false, order: [] };
  function makeBuilder(table) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve) => {
        setImmediate(() => {
          state.resolvedAny = true;
          resolve({ data: [], error: null, count: 0 });
        });
      },
    };
    return builder;
  }
  return {
    state,
    from(table) {
      state.counts[table] = (state.counts[table] ?? 0) + 1;
      state.order.push(table);
      if (!state.resolvedAny) {
        state.issuedBeforeFirstResolve += 1;
      }
      return makeBuilder(table);
    },
  };
}

const profile = {
  id: "p1",
  identifier: "student1@pacemate.edu",
  name: "김학생",
  role: "student",
  school_id: "s1",
  department_id: null,
};

test("getCounselingPageData issues every independent query in one batch", async () => {
  const service = await loadCounselingService();
  const fake = makeDeferredFakeSupabase();
  globalThis.__stage3FakeSupabase = fake;
  try {
    await service.getCounselingPageData(profile);
  } finally {
    delete globalThis.__stage3FakeSupabase;
  }

  // 7 of the 8 queries are mutually independent; only course_professors truly
  // waits on student_courses. Two serialized batches show only 5 here.
  assert.ok(
    fake.state.issuedBeforeFirstResolve >= 7,
    `expected >=7 independent queries issued before any WAN round trip resolved, got ${fake.state.issuedBeforeFirstResolve} (order: ${fake.state.order.join(", ")})`,
  );
});

test("getCounselingPageData query inventory is unchanged", async () => {
  const service = await loadCounselingService();
  const fake = makeDeferredFakeSupabase();
  globalThis.__stage3FakeSupabase = fake;
  try {
    await service.getCounselingPageData(profile);
  } finally {
    delete globalThis.__stage3FakeSupabase;
  }

  assert.deepEqual(fake.state.counts, {
    counseling_requests: 2, // student's own requests + global busy set
    professor_availability: 1,
    professor_teaching_slots: 1,
    professor_admin_tasks: 1,
    student_courses: 1,
    course_professors: 1,
    professors: 1,
  });
});
