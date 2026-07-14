import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("admin broadcasts fan out only to student and professor recipients", () => {
  assert.match(action, /profile\.role !== "admin"/);
  assert.match(action, /\.in\("role", \["student", "professor"\]\)/);
  assert.match(action, /targetGroup === "STUDENT"[\s\S]*?\.eq\("role", "student"\)/);
  assert.match(action, /targetGroup === "PROFESSOR"[\s\S]*?\.eq\("role", "professor"\)/);
  assert.match(action, /data\.map\(\(recipient\) => \(\{[\s\S]*?recipient_id: recipient\.id/);
  assert.match(action, /target_group: targetGroup/);
  assert.match(action, /is_read: false/);
});

test("notification schema records the target group and unread per-recipient rows", () => {
  assert.match(migration, /add column if not exists target_group text not null default 'all'/);
  assert.match(migration, /check \(target_group in \('all', 'student', 'professor'\)\)/);
  assert.match(migration, /user_notifications_target_group_created_idx.*?\(target_group, created_at desc\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.user_notifications/);
  assert.match(types, /NotificationTargetGroup = "ALL" \| "STUDENT" \| "PROFESSOR"/);
  assert.match(types, /target_group: NotificationTargetGroup/);
});

test("broadcast UI is in-app, recipient-scoped, and newest first", () => {
  assert.match(consoleComponent, /<select name="targetGroup"/);
  assert.match(consoleComponent, /<input name="title"/);
  assert.match(consoleComponent, /<textarea name="content"/);
  assert.match(consoleComponent, /shadow-md/);
  assert.match(menu, /filter: `recipient_id=eq\.\$\{profileId\}`/);
  assert.match(menu, /function newestFirst/);
  assert.match(menu, /newestFirst\(\[next,/);
  assert.match(menu, /markNotificationAsRead\(id\)/);
  assert.match(menu, /shadow-lg/);
  assert.doesNotMatch(preferences, /\bNotification\./);
  assert.doesNotMatch(preferences, /requestPermission/);
});
