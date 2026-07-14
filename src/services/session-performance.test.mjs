import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("checks the signed session cookie before doing a network auth lookup", async () => {
  const source = await readFile(new URL("./session.service.ts", import.meta.url), "utf8");
  const cookieIndex = source.indexOf("const session = await readDemoSession()");
  const authIndex = source.indexOf("const { data: authData } = await supabase.auth.getUser()");

  assert.ok(cookieIndex >= 0, "signed session lookup is missing");
  assert.ok(authIndex >= 0, "Supabase auth fallback is missing");
  assert.ok(cookieIndex < authIndex, "the signed session should avoid the auth network call for normal requests");
});

test("login-only session lookup does not call Supabase auth fallback", async () => {
  const source = await readFile(new URL("./session.service.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getSignedDemoProfile");
  const end = source.indexOf("\n}", start) + 2;
  const functionSource = source.slice(start, end);

  assert.ok(start >= 0, "signed-only profile helper is missing");
  assert.doesNotMatch(functionSource, /auth\.getUser/);
});
