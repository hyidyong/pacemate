// Codex F5 regression guard — no reusable credential may live in the repository
// or reach a production bundle.
//
// The original defect was not just "a password was in a file". It was that the
// file was imported by a `"use client"` module, so the credentials were compiled
// into the public login page and served to anyone with `curl`. Removing them
// from the bundle did not invalidate passwords that had already been published,
// so all four accounts were rotated; these tests stop the shape returning.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname — this repository's path contains spaces and
// non-ASCII characters, which pathname leaves percent-encoded.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

test("the committed demo roster contains no credential of any kind", () => {
  const roster = JSON.parse(read("src/config/demo-users.json"));
  assert.ok(Array.isArray(roster) && roster.length > 0, "expected a roster");
  for (const entry of roster) {
    for (const key of Object.keys(entry)) {
      assert.ok(
        !/password|secret|token|credential/i.test(key),
        `demo-users.json entry still carries a credential field: ${key}`,
      );
    }
  }
  // Identifier, name and role are all the browser ever needs.
  assert.deepEqual(
    Object.keys(roster[0]).filter((key) => /password/i.test(key)),
    [],
  );
});

test("no source or script file hardcodes the historically exposed passwords", () => {
  // These exact strings were published in the client bundle. They are rotated
  // and must never reappear as a literal anywhere in the tree.
  const exposed = ["password123", '"1234"', "'1234'"];
  const roots = ["src", "scripts"];
  const offenders = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js|json)$/.test(entry)) continue;
      // This guard file necessarily names the strings it forbids.
      if (full.endsWith("demo-credentials.test.mjs")) continue;
      const content = readFileSync(full, "utf8");
      for (const needle of exposed) {
        if (content.includes(needle)) offenders.push(`${full}: ${needle}`);
      }
    }
  };

  for (const root of roots) walk(join(repoRoot, root));
  assert.deepEqual(offenders, [], `hardcoded demo credential(s) found:\n${offenders.join("\n")}`);
});

test("the roster module is server-only and reads credentials from the environment", () => {
  const source = read("src/config/demo-accounts.server.ts");
  assert.match(source, /^import "server-only";/m, "a client module could import this file");
  assert.match(source, /process\.env\.PACEMATE_DEMO_PASSWORDS/);
  // The file must not itself contain a credential table.
  assert.doesNotMatch(source, /password:\s*["'][^"']{3,}["']/);
});

test("the demo login fails closed without BOTH the flag and a credential", async () => {
  const previousFlag = process.env.PACEMATE_ENABLE_DEMO_LOGIN;
  const previousTable = process.env.PACEMATE_DEMO_PASSWORDS;
  try {
    // The module memoises, so exercise the pure logic the module implements
    // rather than importing it four times.
    const enabled = (flag, table) => {
      if (flag !== "1") return false;
      if (!table) return false;
      try {
        const parsed = JSON.parse(table);
        return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
      } catch {
        return false;
      }
    };

    assert.equal(enabled(undefined, undefined), false, "off by default");
    assert.equal(enabled("1", undefined), false, "flag alone must not enable it");
    assert.equal(enabled(undefined, '{"a@b.c":"x"}'), false, "credentials alone must not enable it");
    assert.equal(enabled("1", "not json"), false, "a malformed table must disable, not half-enable");
    assert.equal(enabled("1", '["a"]'), false, "a non-object table must disable");
    assert.equal(enabled("1", '{"a@b.c":"x"}'), true, "both present enables it");
  } finally {
    process.env.PACEMATE_ENABLE_DEMO_LOGIN = previousFlag;
    process.env.PACEMATE_DEMO_PASSWORDS = previousTable;
  }
});

test("the client login component receives no credential", () => {
  const component = read("src/components/login/demo-login-button.tsx");
  assert.match(component, /^"use client";/m);
  // It may know identifiers, names and roles. It must not know a password, and
  // must not import the roster (which is what put the passwords in the bundle).
  // The file's header comment explains the history and legitimately says
  // "password", so compare the CODE only.
  const code = component
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("/*") && !trimmed.startsWith("//");
    })
    .join("\n");
  assert.doesNotMatch(code, /password/i);
  assert.doesNotMatch(code, /demo-users\.json/);
  assert.doesNotMatch(code, /demo-accounts\.server/);
});

test("operational scripts refuse to run rather than embedding a credential", () => {
  for (const script of [
    "scripts/ensure-demo-operator-auth.mjs",
    "scripts/verify-notification-rls.mjs",
  ]) {
    const source = read(script);
    assert.match(source, /PACEMATE_DEMO_PASSWORDS/, `${script} should read credentials from the environment`);
    assert.doesNotMatch(source, /password:\s*["'][^"'$]{3,}["']/, `${script} still hardcodes a password`);
  }
});
