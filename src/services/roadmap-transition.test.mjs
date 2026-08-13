// Codex round 3, F5 — roadmap revision transitions are a compare-and-set with
// exactly one winner.
//
// The update previously matched on id + school_id only, with no expected prior
// state. That made terminal decisions reversible (approved -> assistant_reviewed),
// let a rejected request be revived, and let two admins deciding at once BOTH
// succeed — last write wins, and each fanned out a student-facing notification.
//
// These tests drive the real action against a fake whose UPDATE honours the
// `in("status", ...)` predicate, so a losing caller genuinely matches zero rows.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__roadmapClient;",
);
const SESSION_STUB = toDataUrl("export const getDemoProfile = async () => globalThis.__roadmapProfile;");
const NOTIFY_STUB = toDataUrl(`
  export const createUserNotification = async (n) => { globalThis.__roadmapNotifications.push(n); return { ok: true }; };
`);
const AUDIT_STUB = toDataUrl("export const recordSecurityEvent = async () => {};");
const CACHE_STUB = toDataUrl("export const revalidatePath = () => {};");
const NAV_STUB = toDataUrl(`
  export const redirect = (to) => { const e = new Error("REDIRECT:" + to); e.__redirect = to; throw e; };
`);

const compile = (path) =>
  transpileModule(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;

// The transition matrix is NOT stubbed — the real table is compiled, and both
// the action and the matrix test below run against it. It lives outside the
// `"use server"` module because every export of one becomes a remotely
// invocable endpoint and must be async; see server-action-contract.test.mjs.
const TRANSITIONS_URL = toDataUrl(compile("./roadmap-transitions.ts"));

let modulePromise;
async function loadAction() {
  modulePromise ??= (async () => {
    let source = readFileSync(
      fileURLToPath(new URL("./admin-approval.actions.ts", import.meta.url)),
      "utf8",
    );
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "next/navigation"', `from ${JSON.stringify(NAV_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFY_STUB)}`],
      ['from "@/lib/observability/security-audit"', `from ${JSON.stringify(AUDIT_STUB)}`],
      ['from "@/services/roadmap-transitions"', `from ${JSON.stringify(TRANSITIONS_URL)}`],
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

const SCHOOL = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

/** A store whose UPDATE honours id + school_id + an `in(status, ...)` CAS. */
function createWorld({ status = "pending" } = {}) {
  const row = { id: REQUEST, school_id: SCHOOL, status, title: "revision", course_id: null, course_code: "X" };
  const state = { row, attempts: 0, winners: 0 };
  const client = {
    from() {
      const filters = { statusIn: null };
      const api = {
        update(patch) {
          api.__patch = patch;
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        in(column, values) {
          if (column === "status") filters.statusIn = values;
          return api;
        },
        async select() {
          state.attempts += 1;
          const matches =
            filters.id === row.id &&
            filters.school_id === row.school_id &&
            (filters.statusIn === null || filters.statusIn.includes(row.status));
          if (!matches) return { data: [], error: null };
          Object.assign(row, api.__patch);
          state.winners += 1;
          return { data: [{ ...row }], error: null };
        },
      };
      return api;
    },
  };
  return { state, client };
}

function install(world, role = "admin") {
  globalThis.__roadmapClient = world.client;
  globalThis.__roadmapProfile = { id: "admin-1", name: "Admin", role, school_id: SCHOOL };
  globalThis.__roadmapNotifications = [];
}

async function decide(status, { adminNote = "note" } = {}) {
  const { updateRoadmapRevisionStatus } = await loadAction();
  const form = new FormData();
  form.set("requestId", REQUEST);
  form.set("status", status);
  form.set("adminNote", adminNote);
  try {
    await updateRoadmapRevisionStatus(form);
    return { redirect: null };
  } catch (error) {
    if (error.__redirect) return { redirect: error.__redirect };
    throw error;
  }
}

test("the transition matrix names legal prior states, and terminal states have none", async () => {
  const { legalSourcesFor } = await import(TRANSITIONS_URL);
  assert.deepEqual(legalSourcesFor("assistant_reviewed"), ["pending"]);
  assert.deepEqual(legalSourcesFor("approved"), ["pending", "assistant_reviewed"]);
  assert.deepEqual(legalSourcesFor("rejected"), ["pending", "assistant_reviewed"]);
  assert.equal(legalSourcesFor("pending"), null, "nothing may transition BACK to pending");
  assert.equal(legalSourcesFor("nonsense"), null);
});

test("a pending request can be approved, and the winner notifies", async () => {
  const world = createWorld({ status: "pending" });
  install(world);

  const result = await decide("approved");

  assert.equal(world.state.winners, 1);
  assert.equal(world.state.row.status, "approved");
  assert.match(result.redirect, /result=approved/);
  assert.equal(globalThis.__roadmapNotifications.length, 1, "the winner must notify exactly once");
});

test("an APPROVED request cannot be walked back to assistant_reviewed", async () => {
  const world = createWorld({ status: "approved" });
  install(world);

  const result = await decide("assistant_reviewed");

  assert.equal(world.state.winners, 0, "a terminal state must not be reverted");
  assert.equal(world.state.row.status, "approved");
  assert.match(result.redirect, /result=stale/);
  assert.equal(globalThis.__roadmapNotifications.length, 0, "a loser must not notify");
});

test("a REJECTED request cannot be revived", async () => {
  const world = createWorld({ status: "rejected" });
  install(world);

  const result = await decide("assistant_reviewed");

  assert.equal(world.state.winners, 0);
  assert.equal(world.state.row.status, "rejected");
  assert.match(result.redirect, /result=stale/);
  assert.equal(globalThis.__roadmapNotifications.length, 0);
});

test("a duplicate approval is reported as stale and does not notify twice", async () => {
  const world = createWorld({ status: "pending" });
  install(world);

  const first = await decide("approved");
  const second = await decide("approved");

  assert.equal(world.state.winners, 1, "only the first approval may win");
  assert.match(first.redirect, /result=approved/);
  assert.match(second.redirect, /result=stale/);
  assert.equal(globalThis.__roadmapNotifications.length, 1, "the second must not notify");
});

test("concurrent approve and reject resolve to exactly one winner and one notification", async () => {
  const world = createWorld({ status: "pending" });
  install(world);

  const results = await Promise.all([decide("approved"), decide("rejected")]);

  assert.equal(world.state.winners, 1, `${world.state.winners} deciders won`);
  assert.ok(["approved", "rejected"].includes(world.state.row.status));
  const stale = results.filter((r) => /result=stale/.test(r.redirect ?? ""));
  assert.equal(stale.length, 1, "exactly one decider must lose");
  assert.equal(
    globalThis.__roadmapNotifications.length,
    1,
    "publication must happen only for the actual winner",
  );
});

test("the action performs a real CAS, not an unconditional update", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./admin-approval.actions.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /\.in\("status", legalSources as string\[\]\)/, "no expected-state predicate");
  assert.match(source, /updated\.length !== 1/, "zero matched rows must be treated as stale");
  assert.match(source, /result=stale/);
  // The tenant term from the previous round must survive.
  assert.match(source, /\.eq\("school_id", profile\.school_id\)/);
  // The matrix must be imported, not defined here: a `"use server"` module
  // publishes every export as an endpoint, so it must export only async
  // functions. Defining it inline broke `next build`.
  assert.match(source, /from "@\/services\/roadmap-transitions"/);
  assert.doesNotMatch(source, /export function legalSourcesFor/);
});
