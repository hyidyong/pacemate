import assert from "node:assert/strict";
import test from "node:test";

import {
  INTEGRATION_COMMANDS,
  runIntegrationSuite,
  validateIntegrationEnv,
} from "./run-integration-suite.mjs";

const SCRATCH_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://stagingref000000.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-value",
  PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
  PACEMATE_SECURITY_PROBE_PROJECT_REF: "stagingref000000",
};

test("credentialed integration fails before spawning when required env is absent", () => {
  const validation = validateIntegrationEnv({});
  assert.equal(validation.ok, false);
  assert.match(validation.message, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(validation.message, /SUPABASE_SERVICE_ROLE_KEY/);

  let spawnCount = 0;
  const result = runIntegrationSuite({
    env: {},
    spawn: () => {
      spawnCount += 1;
      return { status: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(spawnCount, 0, "validation must finish before the first child process");
});

test("credentialed integration refuses the compiled production ref", () => {
  const validation = validateIntegrationEnv({
    ...SCRATCH_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://szztsqdnvenfbgxtylkl.supabase.co",
    PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl",
  });
  assert.equal(validation.ok, false);
  assert.match(validation.message, /KNOWN PRODUCTION/);
});

test("the scratch integration command order is explicit and stops at first failure", () => {
  assert.deepEqual(INTEGRATION_COMMANDS, [
    ["scripts/security/rls-probe.mjs"],
    ["scripts/verify-notification-rls.mjs"],
  ]);

  const spawned = [];
  const result = runIntegrationSuite({
    env: SCRATCH_ENV,
    spawn: (executable, args) => {
      spawned.push([executable, args]);
      return { status: spawned.length === 1 ? 9 : 0 };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedScript, "scripts/security/rls-probe.mjs");
  assert.equal(spawned.length, 1, "a failed probe must prevent later probes from running");
  assert.equal(spawned[0][0], process.execPath);
  assert.deepEqual(spawned[0][1], ["scripts/security/rls-probe.mjs"]);
});

test("a valid scratch environment runs every configured command", () => {
  const spawned = [];
  const result = runIntegrationSuite({
    env: SCRATCH_ENV,
    spawn: (executable, args) => {
      spawned.push([executable, args]);
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { ok: true, completed: INTEGRATION_COMMANDS.length });
  assert.deepEqual(spawned.map(([, args]) => args), INTEGRATION_COMMANDS);
});
