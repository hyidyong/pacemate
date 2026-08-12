import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Stage 3: the page and AppShell both resolve the session profile (and, on
// prop-less pages, the notification pair) during a single RSC render. React
// cache() collapses those into one query per request. These tests freeze the
// wrapping so a refactor back to plain functions re-introduces the duplicate
// profiles/user_notifications queries on ~20 routes.

test("getDemoProfile is request-scoped via React cache()", async () => {
  const source = await readFile(new URL("./session.service.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(
    source,
    /export const getDemoProfile = cache\(async \(\)/,
    "getDemoProfile must stay wrapped in cache() — AppShell re-resolves it on every prop-less route",
  );
});

test("notification list and unread count are request-scoped via React cache()", async () => {
  const source = await readFile(new URL("./notifications.service.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /export const getNotificationsForProfile = cache\(/);
  assert.match(source, /export const getUnreadNotificationCount = cache\(/);
});
