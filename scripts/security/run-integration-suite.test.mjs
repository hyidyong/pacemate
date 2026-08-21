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

test("production ref plus loopback URL is refused before any child process", () => {
  let spawnCount = 0;
  const result = runIntegrationSuite({
    env: {
      ...SCRATCH_ENV,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
      PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl",
    },
    spawn: () => {
      spawnCount += 1;
      return { status: 0 };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /KNOWN PRODUCTION/);
  assert.equal(spawnCount, 0, "production identity must be refused before the first spawn");
});

test("mismatched cloud URL and configured ref are refused before any child process", () => {
  let spawnCount = 0;
  const result = runIntegrationSuite({
    env: {
      ...SCRATCH_ENV,
      PACEMATE_SECURITY_PROBE_PROJECT_REF: "different-scratch-ref",
    },
    spawn: () => {
      spawnCount += 1;
      return { status: 0 };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /does not match|expected exactly/);
  assert.equal(spawnCount, 0, "identity disagreement must be refused before the first spawn");
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

// ---------------------------------------------------------------------------
// Final Stage 10 verifier blocker — adversarial configured-ref matrix with an
// injected spawn. No unsafe identity may reach a child process.
// ---------------------------------------------------------------------------

const PROD_REF = "szztsqdnvenfbgxtylkl";
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const LOOPBACK_URL = "http://127.0.0.1:54321";
const LOOPBACK_ENV = {
  ...SCRATCH_ENV,
  NEXT_PUBLIC_SUPABASE_URL: LOOPBACK_URL,
  PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
  PACEMATE_SECURITY_PROBE_PROJECT_REF: "fakeproject",
};

function runWithCountingSpawn(env) {
  let spawnCount = 0;
  const result = runIntegrationSuite({
    env,
    spawn: () => {
      spawnCount += 1;
      return { status: 0 };
    },
  });
  return { result, spawnCount };
}

test("production ref variants are refused with zero spawns on loopback and cloud URLs", () => {
  const variants = [
    PROD_REF,
    ` ${PROD_REF}`,
    `${PROD_REF} `,
    PROD_REF.toUpperCase(),
    "SzZtSqDnVeNfBgXtYlKl",
  ];
  for (const ref of variants) {
    for (const base of [LOOPBACK_ENV, SCRATCH_ENV, { ...SCRATCH_ENV, NEXT_PUBLIC_SUPABASE_URL: PROD_URL }]) {
      const { result, spawnCount } = runWithCountingSpawn({
        ...base,
        PACEMATE_SECURITY_PROBE_PROJECT_REF: ref,
      });
      assert.equal(result.ok, false, `${JSON.stringify(ref)} on ${base.NEXT_PUBLIC_SUPABASE_URL} must be refused`);
      assert.match(result.message, /KNOWN PRODUCTION/);
      assert.equal(spawnCount, 0, `${JSON.stringify(ref)} must never reach a child process`);
    }
  }
});

test("malformed configured refs are refused with zero spawns on an opted-in loopback target", () => {
  const malformed = [
    "not/a/ref",
    "",
    "   ",
    "https://example.com",
    "foo.supabase.co",
    "ref?x=1",
    "ref#frag",
    "ref:5432",
    "ref/path",
    " fakeproject",
    "fakeproject ",
    "FakeProject",
  ];
  for (const ref of malformed) {
    const { result, spawnCount } = runWithCountingSpawn({
      ...LOOPBACK_ENV,
      PACEMATE_SECURITY_PROBE_PROJECT_REF: ref,
    });
    assert.equal(result.ok, false, `${JSON.stringify(ref)} must be refused`);
    assert.equal(spawnCount, 0, `${JSON.stringify(ref)} must never reach a child process`);
  }
});

test("identity disagreement is refused with zero spawns in every shape", () => {
  const cases = [
    { NEXT_PUBLIC_SUPABASE_URL: SCRATCH_ENV.NEXT_PUBLIC_SUPABASE_URL, PACEMATE_SECURITY_PROBE_PROJECT_REF: "otherscratch0000" },
    { NEXT_PUBLIC_SUPABASE_URL: LOOPBACK_URL, PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1", PACEMATE_SECURITY_PROBE_PROJECT_REF: PROD_REF },
    { NEXT_PUBLIC_SUPABASE_URL: "not a URL", PACEMATE_SECURITY_PROBE_PROJECT_REF: PROD_REF },
    { NEXT_PUBLIC_SUPABASE_URL: "https://unrelated.example", PACEMATE_SECURITY_PROBE_PROJECT_REF: PROD_REF },
    { NEXT_PUBLIC_SUPABASE_URL: "", PACEMATE_SECURITY_PROBE_PROJECT_REF: PROD_REF },
    { NEXT_PUBLIC_SUPABASE_URL: LOOPBACK_URL, PACEMATE_SECURITY_PROBE_PROJECT_REF: PROD_REF },
  ];
  for (const overrides of cases) {
    const { result, spawnCount } = runWithCountingSpawn({ ...SCRATCH_ENV, ...overrides });
    assert.equal(result.ok, false, `${JSON.stringify(overrides)} must be refused`);
    assert.equal(spawnCount, 0, `${JSON.stringify(overrides)} must never reach a child process`);
    if (overrides.PACEMATE_SECURITY_PROBE_PROJECT_REF === PROD_REF) {
      assert.match(
        result.message,
        /KNOWN PRODUCTION/,
        "a production identity must be named even when the URL is missing or malformed",
      );
    }
  }
});

test("a valid opted-in loopback environment with the harness's local identity runs every command", () => {
  const spawned = [];
  const result = runIntegrationSuite({
    env: LOOPBACK_ENV,
    spawn: (executable, args) => {
      spawned.push([executable, args]);
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { ok: true, completed: INTEGRATION_COMMANDS.length });
  assert.deepEqual(spawned.map(([, args]) => args), INTEGRATION_COMMANDS);
});
