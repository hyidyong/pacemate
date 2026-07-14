import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const componentUrl = new URL("./notification-menu.tsx", import.meta.url);
const headerUrl = new URL("../layout/app-header-professor-safe.tsx", import.meta.url);

test("only one responsive notification menu subscribes to Supabase Realtime", async () => {
  const [menu, header] = await Promise.all([
    readFile(fileURLToPath(componentUrl), "utf8"),
    readFile(fileURLToPath(headerUrl), "utf8"),
  ]);

  assert.match(menu, /if \(!enableRealtime \|\| !profileId\) return;/);
  assert.match(header, /<NotificationMenu[\s\S]*?enableRealtime/);
});
