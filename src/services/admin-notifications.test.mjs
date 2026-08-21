import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const action = read("src", "services", "admin-notifications.actions.ts");
const menu = read("src", "components", "notifications", "notification-menu.tsx");
const consoleComponent = read("src", "components", "admin", "admin-notification-console.tsx");
const preferences = read("src", "components", "notifications", "notification-preferences-panel.tsx");
const types = read("src", "types", "notifications.ts");
const migration = read("supabase", "migrations", "20260714160429_add_admin_broadcast_notifications.sql")
  .replace(/\s+/g, " ")
  .toLowerCase();

const NEXT_CACHE_STUB = toDataUrl(
  "export const revalidatePath = (path) => globalThis.__stage10Revalidated.push(path);",
);
const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__stage10AdminClient;",
);
const LOG_STUB = toDataUrl(
  "export const classifyPostgresError = (code) => code ?? 'unknown';",
);
const AUDIT_STUB = toDataUrl(
  "export const recordSecurityEvent = async (event) => globalThis.__stage10SecurityEvents.push(event);",
);
const SESSION_STUB = toDataUrl(
  "export const getDemoProfile = async () => globalThis.__stage10AdminProfile;",
);

let adminActionPromise;
function loadAdminAction() {
  adminActionPromise ??= (async () => {
    let source = action.replace('"use server";', "");
    for (const [from, to] of [
      ['from "next/cache"', `from ${JSON.stringify(NEXT_CACHE_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/lib/observability/log"', `from ${JSON.stringify(LOG_STUB)}`],
      ['from "@/lib/observability/security-audit"', `from ${JSON.stringify(AUDIT_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import remains in admin action");
    return import(toDataUrl(compiled));
  })();
  return adminActionPromise;
}

let menuHelpersPromise;
function loadMenuHelpers() {
  menuHelpersPromise ??= (async () => {
    const start = menu.indexOf("function asNotification");
    const end = menu.indexOf("export function NotificationMenu");
    assert.ok(start >= 0 && end > start, "notification menu helpers must be extractable");
    const helperSource = menu
      .slice(start, end)
      .replace("function newestFirst", "export function newestFirst")
      .replace("function dedupeMenuNotifications", "export function dedupeMenuNotifications")
      .replace("function safeNotificationTargetHref", "export function safeNotificationTargetHref");
    const compiled = transpileModule(
      `type UserNotification = Record<string, any> & { created_at: string; category: string; title: string; body: string; target_href: string };\n${helperSource}`,
      { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } },
    ).outputText;
    return import(toDataUrl(compiled));
  })();
  return menuHelpersPromise;
}

function createAdminNotificationWorld(profiles, recentNotifications = []) {
  const inserted = [];
  return {
    inserted,
    client: {
      from(table) {
        const filters = new Map();
        const inFilters = new Map();
        let requireLinkedAuth = false;
        const api = {
          select: () => api,
          eq(column, value) {
            filters.set(column, value);
            return api;
          },
          in(column, values) {
            inFilters.set(column, values);
            return api;
          },
          not(column, operator, value) {
            if (column === "auth_user_id" && operator === "is" && value === null) {
              requireLinkedAuth = true;
            }
            return api;
          },
          gte: () => api,
          insert(rows) {
            inserted.push(...rows);
            return Promise.resolve({ error: null });
          },
          then(resolve, reject) {
            const rows = table === "profiles" ? profiles : recentNotifications;
            const matched = rows.filter((row) =>
              [...filters].every(([column, value]) => row[column] === value) &&
              [...inFilters].every(([column, values]) => values.includes(row[column])) &&
              (!requireLinkedAuth || row.auth_user_id !== null));
            return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
          },
        };
        return api;
      },
    },
  };
}

test("admin broadcasts fan out only to student and professor recipients", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const studentId = "22222222-2222-4222-8222-222222222222";
  const professorId = "33333333-3333-4333-8333-333333333333";
  const world = createAdminNotificationWorld([
    { id: studentId, role: "student", school_id: tenantId, auth_user_id: "student-auth" },
    { id: professorId, role: "professor", school_id: tenantId, auth_user_id: "professor-auth" },
    { id: "44444444-4444-4444-8444-444444444444", role: "admin", school_id: tenantId, auth_user_id: "admin-auth" },
    { id: "55555555-5555-4555-8555-555555555555", role: "student", school_id: "other-tenant", auth_user_id: "other-auth" },
    { id: "66666666-6666-4666-8666-666666666666", role: "professor", school_id: tenantId, auth_user_id: null },
  ]);
  globalThis.__stage10AdminClient = world.client;
  globalThis.__stage10AdminProfile = { id: "admin", role: "admin", school_id: tenantId };
  globalThis.__stage10Revalidated = [];
  globalThis.__stage10SecurityEvents = [];

  const { sendAdminBroadcastNotification } = await loadAdminAction();
  const formData = new FormData();
  formData.set("targetGroup", "ALL");
  formData.set("title", "Maintenance");
  formData.set("content", "Tonight at 22:00");
  const result = await sendAdminBroadcastNotification({ ok: false, message: "" }, formData);

  assert.equal(result.ok, true);
  assert.deepEqual(world.inserted, [
    {
      recipient_id: studentId,
      recipient_role: "student",
      school_id: tenantId,
      target_group: "ALL",
      category: "system",
      title: "Maintenance",
      body: "Tonight at 22:00",
      target_href: "/notifications",
      is_read: false,
    },
    {
      recipient_id: professorId,
      recipient_role: "professor",
      school_id: tenantId,
      target_group: "ALL",
      category: "system",
      title: "Maintenance",
      body: "Tonight at 22:00",
      target_href: "/notifications",
      is_read: false,
    },
  ]);
});

test("notification schema records the target group and unread per-recipient rows", () => {
  assert.match(migration, /add column if not exists target_group text not null default 'all'/);
  assert.match(migration, /check \(target_group in \('all', 'student', 'professor'\)\)/);
  assert.match(migration, /user_notifications_target_group_created_idx.*?\(target_group, created_at desc\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.user_notifications/);
  assert.match(types, /NotificationTargetGroup = "ALL" \| "STUDENT" \| "PROFESSOR"/);
  assert.match(types, /target_group: NotificationTargetGroup/);
});

test("broadcast UI is in-app, recipient-scoped, and newest first", async () => {
  assert.match(consoleComponent, /<select name="targetGroup"/);
  assert.match(consoleComponent, /<input name="title"/);
  assert.match(consoleComponent, /<textarea name="content"/);
  assert.match(consoleComponent, /shadow-md/);
  assert.match(menu, /\{ event: "INSERT", schema: "public", table: "user_notifications" \}/);
  assert.doesNotMatch(menu, /filter:\s*`recipient_id=eq\./);
  assert.match(menu, /if \(recipientId !== profileId\) return;/);
  assert.match(menu, /useId/);
  assert.match(menu, /channel\(`in-app-notifications:\$\{profileId\}:\$\{channelInstanceId\}`\)/);
  assert.match(menu, /shadow-lg/);
  assert.doesNotMatch(preferences, /\bNotification\./);
  assert.doesNotMatch(preferences, /requestPermission/);

  const { newestFirst, dedupeMenuNotifications, safeNotificationTargetHref } = await loadMenuHelpers();
  const oldSystem = {
    id: "old",
    category: "system",
    title: "Maintenance",
    body: "Tonight",
    target_href: "/notifications",
    created_at: "2026-08-20T10:00:00.000Z",
  };
  const newSystem = { ...oldSystem, id: "new", created_at: "2026-08-21T10:00:00.000Z" };
  const question = {
    ...oldSystem,
    id: "question",
    category: "question",
    title: "Question answered",
    created_at: "2026-08-19T10:00:00.000Z",
  };

  assert.deepEqual(newestFirst([oldSystem, newSystem]).map((item) => item.id), ["new", "old"]);
  assert.deepEqual(
    dedupeMenuNotifications([oldSystem, question, newSystem]).map((item) => item.id),
    ["new", "question"],
    "the newest copy of a repeated system broadcast is shown once",
  );
  assert.equal(safeNotificationTargetHref("/notifications"), "/notifications");
  assert.equal(safeNotificationTargetHref("https://attacker.example"), "/notifications");
});
