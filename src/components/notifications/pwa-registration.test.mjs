import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unregisters service workers on localhost before any new registration", async () => {
  const source = await readFile(new URL("./pwa-registration.tsx", import.meta.url), "utf8");

  assert.match(source, /const CACHE_PREFIX = "pacemate-static-"/);
  assert.match(source, /const DEV_RESET_KEY = "pacemate-dev-sw-reset"/);
  assert.match(source, /isLocalhost\(window\.location\.hostname\)/);
  assert.match(source, /navigator\.serviceWorker\.getRegistrations\(\)/);
  assert.match(source, /registration\.unregister\(\)/);
  assert.match(source, /caches\.keys\(\)/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
});
