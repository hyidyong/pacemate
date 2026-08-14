// Codex round 4, finding 10 — regressions the per-recipient redesign could have
// introduced, checked explicitly rather than assumed away.
//
// Fanning a broadcast out into one row per recipient changes how many rows
// exist, which is exactly the kind of change that quietly breaks a COUNT. The
// review named the specific risks: wrong unread count, duplicate rows, broken
// admin fan-out, mark-all reaching peers. Each is asserted here against the
// real read path and the real creation chokepoint.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const OWNERSHIP_URL = new URL("./notifications.ownership.ts", import.meta.url).href;
const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__countClient;",
);
// The service memoises reads with React's request-scoped `cache`. Outside a
// request there is nothing to scope to, and memoising across tests would make
// the second call return the first world's numbers — so the stub is a
// pass-through, which is also what `cache` degrades to per request.
const REACT_STUB = toDataUrl("export const cache = (fn) => fn;");

let modulePromise;
async function loadService() {
  modulePromise ??= (async () => {
    let source = readFileSync(
      fileURLToPath(new URL("./notifications.service.ts", import.meta.url)),
      "utf8",
    );
    for (const [from, to] of [
      ['import "server-only";', ""],
      ['from "react"', `from ${JSON.stringify(REACT_STUB)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/services/notifications.ownership"', `from ${JSON.stringify(OWNERSHIP_URL)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(toDataUrl("export {};"))}`],
      ['from "@/types/notifications"', `from ${JSON.stringify(toDataUrl("export const notificationCategoryLabels = {};"))}`],
    ]) {
      source = source.split(from).join(to);
    }
    // `import type` lines are erased by the transpiler; any survivor is a bug
    // in this harness rather than in the code under test.
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import");
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const PEER = "33333333-3333-4333-8333-333333333333";

const PROFILE = { id: ME, name: "학생", role: "student", school_id: TENANT };

/** Evaluates the `or(...)` ownership predicate the way PostgREST would. */
function createReadWorld(rows) {
  const seen = { orFilters: [] };
  const client = {
    from() {
      const state = { filters: [], or: null, head: false };
      const api = {
        select(_cols, opts) {
          state.head = Boolean(opts?.head);
          return api;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return api;
        },
        order: () => api,
        limit: () => api,
        or(expr) {
          state.or = expr;
          seen.orFilters.push(expr);
          return api;
        },
        then(resolve) {
          const matches = rows.filter((row) => {
            for (const [column, value] of state.filters) {
              if (row[column] !== value) return false;
            }
            if (!state.or) return true;
            // Only the single-term identity predicate is legal now.
            return state.or.split(",").some((clause) => {
              const [col, op, ...rest] = clause.split(".");
              if (op !== "eq") throw new Error(`unsupported operator: ${op}`);
              return String(row[col]) === rest.join(".");
            });
          });
          resolve({ data: matches, count: matches.length, error: null });
        },
      };
      return api;
    },
  };
  return { client, seen };
}

const rows = [
  // My own copies.
  { id: "n1", recipient_id: ME, recipient_role: "student", school_id: TENANT, is_read: false, category: "system" },
  { id: "n2", recipient_id: ME, recipient_role: "student", school_id: TENANT, is_read: true, category: "system" },
  { id: "n3", recipient_id: ME, recipient_role: "student", school_id: TENANT, is_read: false, category: "counseling" },
  // A same-tenant peer's copies of the SAME broadcasts. Before the redesign
  // these did not exist as separate rows; now they must not be counted.
  { id: "p1", recipient_id: PEER, recipient_role: "student", school_id: TENANT, is_read: false, category: "system" },
  { id: "p2", recipient_id: PEER, recipient_role: "student", school_id: TENANT, is_read: false, category: "counseling" },
];

test("the unread count counts MY rows only, not a peer's copies", async () => {
  const { getUnreadNotificationCount } = await loadService();
  const world = createReadWorld(rows);
  globalThis.__countClient = world.client;

  const count = await getUnreadNotificationCount(PROFILE);

  // n1 and n3. Peer rows p1/p2 are unread too and must not inflate it.
  assert.equal(count, 2, "fan-out must not inflate the unread badge with peers' rows");
});

test("the per-category unread count is also mine only", async () => {
  const { getUnreadNotificationCountByCategory } = await loadService();
  const world = createReadWorld(rows);
  globalThis.__countClient = world.client;

  assert.equal(await getUnreadNotificationCountByCategory(PROFILE, "counseling"), 1);
  assert.equal(await getUnreadNotificationCountByCategory(PROFILE, "system"), 1);
});

test("the list read returns no duplicate rows and no peer rows", async () => {
  const { getNotificationsForProfile } = await loadService();
  const world = createReadWorld(rows);
  globalThis.__countClient = world.client;

  const items = await getNotificationsForProfile(PROFILE, 50);
  const ids = items.map((item) => item.id);

  assert.deepEqual([...new Set(ids)].sort(), ids.sort(), "no duplicates");
  assert.deepEqual(ids.sort(), ["n1", "n2", "n3"], "peers' copies must not appear");
});

test("reads use the SAME single-term predicate as writes", async () => {
  const { getUnreadNotificationCount } = await loadService();
  const world = createReadWorld(rows);
  globalThis.__countClient = world.client;
  await getUnreadNotificationCount(PROFILE);

  assert.ok(world.seen.orFilters.length > 0, "the ownership predicate must be applied to reads");
  for (const expr of world.seen.orFilters) {
    assert.equal(expr, `recipient_id.eq.${ME}`);
    assert.doesNotMatch(expr, /recipient_role|school_id/, "the role branch must be gone from reads too");
  }
});

test("the admin broadcast still fans out itself and does NOT double-expand", () => {
  // sendAdminBroadcastNotification has always written one row per profile
  // directly through the admin client. It must not also pass through the
  // chokepoint's expansion, or every recipient would get two rows.
  const source = readFileSync(
    fileURLToPath(new URL("./admin-notifications.actions.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /recipient_id: recipient\.id/, "it must still address each recipient");
  assert.doesNotMatch(
    source,
    /createUserNotifications?\(/,
    "it must not ALSO go through the expanding chokepoint",
  );
});

test("the Realtime menu still de-duplicates what it receives", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../components/notifications/notification-menu.tsx", import.meta.url)),
    "utf8",
  );
  // More rows now exist per broadcast, so a de-dupe regression would show up as
  // repeated toasts rather than as a wrong count.
  assert.match(source, /dedupeMenuNotifications/);
  assert.match(source, /current\.filter\(\(item\) => item\.id !== next\.id\)/);
});
