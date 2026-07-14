import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("notification page and header menu navigate with client-side routing", async () => {
  const listSource = await readFile(new URL("./notification-list.tsx", import.meta.url), "utf8");
  const menuSource = await readFile(new URL("./notification-menu.tsx", import.meta.url), "utf8");

  assert.match(listSource, /router\.push\(href\)/);
  assert.match(listSource, /markNotificationAsRead\(notification\.id\)/);
  assert.match(menuSource, /router\.push\(safeNotificationTargetHref\(item\.target_href\)\)/);
  assert.match(menuSource, /markNotificationAsRead\(item\.id\)/);
});
