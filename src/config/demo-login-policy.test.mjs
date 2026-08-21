// Post-Stage-10 UX restoration — role-based demo quick login.
//
// The browser only ever names a ROLE ("student", "professor", "assistant",
// "admin"). Everything else — which roster identity that role maps to and the
// credential for it — is resolved here, on the server, from runtime-only
// configuration. These tests exercise the pure policy so every fail-closed
// branch is executed rather than re-implemented in the test.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_LOGIN_ROLES,
  isDemoLoginRole,
  listAvailableDemoLoginRoles,
  parseDemoPasswordTable,
  resolveDemoCredentialForRole,
} from "./demo-login-policy.ts";

const roster = [
  { identifier: "student1@pacemate.edu", name: "김학생", role: "student" },
  { identifier: "prof1@pacemate.edu", name: "이교수", role: "professor" },
  { identifier: "assistant1@pacemate.edu", name: "박조교", role: "assistant" },
  { identifier: "admin1@pacemate.edu", name: "최관리자", role: "admin" },
];

const fullTable = {
  "student1@pacemate.edu": "s-runtime",
  "prof1@pacemate.edu": "p-runtime",
  "assistant1@pacemate.edu": "a-runtime",
  "admin1@pacemate.edu": "m-runtime",
};

test("exactly the four intended roles are demo-login roles; anything else is rejected", () => {
  assert.deepEqual([...DEMO_LOGIN_ROLES], ["student", "professor", "assistant", "admin"]);
  for (const role of DEMO_LOGIN_ROLES) assert.equal(isDemoLoginRole(role), true);
  for (const bad of ["", "root", "Student", "ADMIN", "service_role", 1, null, undefined, {}, ["admin"]]) {
    assert.equal(isDemoLoginRole(bad), false, `accepted invalid role ${JSON.stringify(bad)}`);
  }
});

test("the password table fails closed on absent, malformed, or non-object values", () => {
  assert.equal(parseDemoPasswordTable(undefined), null, "absent");
  assert.equal(parseDemoPasswordTable(""), null, "empty");
  assert.equal(parseDemoPasswordTable("not json"), null, "malformed");
  assert.equal(parseDemoPasswordTable('["a"]'), null, "array");
  assert.equal(parseDemoPasswordTable('"string"'), null, "string");
  assert.equal(parseDemoPasswordTable("null"), null, "null literal");
  assert.deepEqual(parseDemoPasswordTable('{"a@b.c":"x"}'), { "a@b.c": "x" });
});

test("disabled by default: no flag means no role is offered and no credential resolves", () => {
  assert.deepEqual(listAvailableDemoLoginRoles({ flag: undefined, table: fullTable, roster }), []);
  assert.equal(
    resolveDemoCredentialForRole("student", { flag: undefined, table: fullTable, roster }),
    null,
  );
});

test("the flag alone is not enough; a flag value other than the exact '1' is not enough", () => {
  assert.deepEqual(listAvailableDemoLoginRoles({ flag: "1", table: null, roster }), []);
  assert.equal(resolveDemoCredentialForRole("admin", { flag: "1", table: null, roster }), null);
  for (const notOn of ["true", "yes", "0", " 1", "1 ", "on"]) {
    assert.deepEqual(listAvailableDemoLoginRoles({ flag: notOn, table: fullTable, roster }), [], notOn);
  }
});

test("enabled only under explicit server-side configuration, each role maps to its own identity", () => {
  const config = { flag: "1", table: fullTable, roster };
  assert.deepEqual(listAvailableDemoLoginRoles(config), ["student", "professor", "assistant", "admin"]);

  assert.deepEqual(resolveDemoCredentialForRole("student", config), {
    identifier: "student1@pacemate.edu",
    password: "s-runtime",
  });
  assert.deepEqual(resolveDemoCredentialForRole("professor", config), {
    identifier: "prof1@pacemate.edu",
    password: "p-runtime",
  });
  assert.deepEqual(resolveDemoCredentialForRole("assistant", config), {
    identifier: "assistant1@pacemate.edu",
    password: "a-runtime",
  });
  assert.deepEqual(resolveDemoCredentialForRole("admin", config), {
    identifier: "admin1@pacemate.edu",
    password: "m-runtime",
  });
});

test("a role whose runtime credential is missing or empty is neither offered nor resolvable", () => {
  const partial = { ...fullTable };
  delete partial["admin1@pacemate.edu"];
  partial["assistant1@pacemate.edu"] = "";
  const config = { flag: "1", table: partial, roster };

  assert.deepEqual(listAvailableDemoLoginRoles(config), ["student", "professor"]);
  assert.equal(resolveDemoCredentialForRole("admin", config), null);
  assert.equal(resolveDemoCredentialForRole("assistant", config), null);
  assert.ok(resolveDemoCredentialForRole("student", config));
});

test("an invalid role is rejected even when everything is enabled, and never falls back", () => {
  const config = { flag: "1", table: fullTable, roster };
  for (const bad of ["root", "Student", "", "student1@pacemate.edu", undefined, null, 42]) {
    assert.equal(resolveDemoCredentialForRole(bad, config), null, `resolved invalid role ${JSON.stringify(bad)}`);
  }
});

test("a roster entry with an unknown role cannot be reached through the role login", () => {
  const config = {
    flag: "1",
    table: { ...fullTable, "svc@pacemate.edu": "x" },
    roster: [...roster, { identifier: "svc@pacemate.edu", name: "svc", role: "service_role" }],
  };
  assert.deepEqual(listAvailableDemoLoginRoles(config), ["student", "professor", "assistant", "admin"]);
  assert.equal(resolveDemoCredentialForRole("service_role", config), null);
});

test("the policy module itself contains no credential and no fallback literal", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./demo-login-policy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /password\s*[:=]\s*["'][^"']{3,}["']/);
  assert.doesNotMatch(source, /@pacemate\.edu/, "identities come from the roster, not literals");
  assert.doesNotMatch(source, /process\.env/, "the pure policy must not read the environment itself");
});
