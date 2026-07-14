import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("session verification keeps malformed or unavailable secrets from escaping a route", async () => {
  const source = await readFile(new URL("./demo-session.ts", import.meta.url), "utf8");
  assert.match(source, /export function verifyDemoSessionToken[\s\S]*?try \{[\s\S]*?const \[payloadSegment, signature/);
  assert.match(source, /\} catch \{\s*return null;\s*\}/);
});
