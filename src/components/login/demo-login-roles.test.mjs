// Post-Stage-10 UX restoration — four role buttons, server-side sign-in.
//
// Shape guards for the client/server boundary: the browser receives a list of
// ROLES and posts a ROLE back; the identifier and password never leave the
// server. These complement the executable policy tests in
// src/config/demo-login-policy.test.mjs and the Stage 9 bundle guard in
// src/config/demo-credentials.test.mjs.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const stripComments = (source) =>
  source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("/*") && !trimmed.startsWith("//");
    })
    .join("\n");

test("the client component offers the four role buttons with the restored labels", async () => {
  const source = await read("./demo-login-button.tsx");
  assert.match(source, /^"use client";/m);
  assert.match(source, /학생 데모 로그인/);
  assert.match(source, /교수 데모 로그인/);
  assert.match(source, /조교 데모 로그인/);
  assert.match(source, /관리자 데모 로그인/);
  // The panel is no longer collapsed behind a "펼치기" toggle — one click signs in.
  assert.doesNotMatch(source, /펼치기/);
  // Buttons post a role, not an identifier, and are identifiable in rendered QA.
  assert.match(source, /signInAsDemoRole\(role\)/);
  assert.match(source, /data-testid=\{`demo-login-\$\{role\}`\}/);
  // A failed attempt is surfaced inline instead of silently re-enabling.
  assert.match(source, /role="alert"/);
});

test("the client component knows roles only — no identifier, password, or roster import", async () => {
  const code = stripComments(await read("./demo-login-button.tsx"));
  assert.doesNotMatch(code, /password/i);
  assert.doesNotMatch(code, /identifier/i);
  assert.doesNotMatch(code, /@pacemate\.edu/);
  assert.doesNotMatch(code, /demo-users\.json/);
  assert.doesNotMatch(code, /demo-accounts\.server/);
  assert.doesNotMatch(code, /process\.env/);
  // It must not reintroduce the pre-Stage-9 prefill trick.
  assert.doesNotMatch(code, /querySelector\(['"]input\[name=/);
  assert.doesNotMatch(code, /\.value\s*=/);
});

test("the server action accepts a role, validates it, and fails closed before touching credentials", async () => {
  const source = await read("../../services/demo-login.actions.ts");
  assert.match(source, /^"use server";/m);
  assert.match(source, /export async function signInAsDemoRole\(role: unknown\)/);
  // Validation order: enabled? -> valid role? -> credential present? -> sign in.
  const enabledIdx = source.search(/if \(!isDemoLoginEnabled\(\)\)/);
  const roleIdx = source.search(/if \(!isDemoLoginRole\(role\)\)/);
  const credentialIdx = source.search(/findDemoCredentialForRole\(role\)/);
  const signInIdx = source.search(/await createDemoSession\(formData\)/);
  assert.ok(enabledIdx >= 0 && roleIdx > enabledIdx && credentialIdx > roleIdx && signInIdx > credentialIdx);
  // The identifier-keyed action is gone: the only public entry point takes a role.
  assert.doesNotMatch(source, /export async function signInAsDemoAccount/);
  // The role is never echoed with a credential into the response.
  assert.doesNotMatch(source, /message:[^\n]*password/i);
});

test("the login page hands the client a role list from the server-only roster module", async () => {
  const source = await read("../../app/login/page.tsx");
  assert.match(source, /import \{ listDemoLoginRoles \} from "@\/config\/demo-accounts\.server"/);
  assert.match(source, /<DemoLoginButton roles=\{listDemoLoginRoles\(\)\} \/>/);
  assert.doesNotMatch(source, /listDemoAccounts/);
  // Normal password login stays exactly as it was.
  assert.match(source, /<form action=\{createDemoSession\} className="form-stack">/);
  assert.match(source, /name="identifier"/);
  assert.match(source, /name="password"[\s\S]*type="password"/);
  assert.match(source, /data-testid="login-submit"/);
});

test("the server roster module derives roles through the shared fail-closed policy", async () => {
  const source = await read("../../config/demo-accounts.server.ts");
  assert.match(source, /^import "server-only";/m);
  assert.match(source, /from "@\/config\/demo-login-policy"/);
  assert.match(source, /export function listDemoLoginRoles\(\)/);
  assert.match(source, /export function findDemoCredentialForRole\(/);
  assert.match(source, /process\.env\.PACEMATE_ENABLE_DEMO_LOGIN/);
  assert.match(source, /process\.env\.PACEMATE_DEMO_PASSWORDS/);
  assert.doesNotMatch(source, /password:\s*["'][^"']{3,}["']/);
});
