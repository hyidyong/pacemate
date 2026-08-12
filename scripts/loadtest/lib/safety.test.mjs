import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeToMutate,
  evaluateMutationGuard,
  evaluateTargetGuard,
  isLoopbackUrl,
  projectRefFromSupabaseUrl,
} from "./safety.mjs";

// Stage 8 review findings 4 and 5. The booking harness provisions auth users
// and issues real bookings; previously its only protection was a cleanup step,
// which does nothing if the process is killed, if cleanup fails, or if the
// operator pointed at the wrong project. These guards must FAIL CLOSED.

const PROD_URL = "https://szztsqdnvenfbgxtylkl.supabase.co";
const STAGING_URL = "https://stagingref000000.supabase.co";

const FULLY_ALLOWED = {
  PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
  PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: "stagingref000000",
  PACEMATE_LOADTEST_TARGET_KIND: "non-production",
};

test("an empty environment refuses to mutate", () => {
  const result = evaluateMutationGuard({}, PROD_URL);
  assert.equal(result.allowed, false, "the default must be refusal, not permission");
  assert.ok(result.problems.length >= 3, "every missing confirmation should be reported at once");
});

test("the destructive opt-in alone is not enough", () => {
  const result = evaluateMutationGuard({ PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1" }, PROD_URL);
  assert.equal(result.allowed, false);
  assert.ok(
    result.problems.some((p) => p.includes("EXPECTED_PROJECT_REF")),
    "must still require the operator to name the project being mutated",
  );
});

test("a stale env pointing at a different project is refused", () => {
  // The operator believes they are on staging; .env.local still points at prod.
  const result = evaluateMutationGuard({ ...FULLY_ALLOWED }, PROD_URL);
  assert.equal(result.allowed, false, "a project-ref mismatch must fail closed");
  assert.ok(
    result.problems.some((p) => p.includes("szztsqdnvenfbgxtylkl")),
    "the refusal must name the project actually configured",
  );
});

test("a correctly declared non-production project is allowed", () => {
  const result = evaluateMutationGuard(FULLY_ALLOWED, STAGING_URL);
  assert.equal(result.allowed, true, result.problems.join("; "));
  assert.equal(result.projectRef, "stagingref000000");
  assert.equal(result.declaredNonProduction, true);
});

test("a shared project is allowed only with an explicitly isolated tenant", () => {
  const withoutTenant = evaluateMutationGuard(
    {
      PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
      PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: "szztsqdnvenfbgxtylkl",
    },
    PROD_URL,
  );
  assert.equal(withoutTenant.allowed, false, "no isolation declared — must refuse");

  const withTenant = evaluateMutationGuard(
    {
      PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
      PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: "szztsqdnvenfbgxtylkl",
      PACEMATE_LOADTEST_SCHOOL_ID: "99999999-0000-4000-8000-000000000099",
    },
    PROD_URL,
  );
  assert.equal(withTenant.allowed, true, withTenant.problems.join("; "));
  assert.equal(withTenant.isolatedSchoolId, "99999999-0000-4000-8000-000000000099");
});

test("loopback application targets need no opt-in", () => {
  for (const url of ["http://127.0.0.1:3000", "http://localhost:3000"]) {
    const result = evaluateTargetGuard({}, url);
    assert.equal(result.allowed, true, `${url} should be allowed`);
    assert.equal(result.loopback, true);
  }
});

test("a remote application target requires opt-in, https, and an expected host", () => {
  const bare = evaluateTargetGuard({}, "http://staging.example.edu");
  assert.equal(bare.allowed, false, "credentials must not leave the box by default");
  assert.ok(bare.problems.some((p) => p.includes("ALLOW_REMOTE")));
  assert.ok(bare.problems.some((p) => p.includes("https")));
  assert.ok(bare.problems.some((p) => p.includes("EXPECTED_HOST")));

  const wrongHost = evaluateTargetGuard(
    { PACEMATE_LOADTEST_ALLOW_REMOTE: "1", PACEMATE_LOADTEST_EXPECTED_HOST: "staging.example.edu" },
    "https://prod.example.edu",
  );
  assert.equal(wrongHost.allowed, false, "a host mismatch must fail closed");

  const ok = evaluateTargetGuard(
    { PACEMATE_LOADTEST_ALLOW_REMOTE: "1", PACEMATE_LOADTEST_EXPECTED_HOST: "staging.example.edu" },
    "https://staging.example.edu",
  );
  assert.equal(ok.allowed, true, ok.problems.join("; "));
});

test("assertSafeToMutate throws with an actionable message and does not claim cleanup protects anything", () => {
  let message = "";
  try {
    assertSafeToMutate({}, { supabaseUrl: PROD_URL, baseUrl: "http://127.0.0.1:3000" });
    assert.fail("expected a refusal");
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /Refusing to run/);
  assert.match(message, /Cleanup afterwards is not a safety mechanism/);
});

test("url helpers behave", () => {
  assert.equal(projectRefFromSupabaseUrl(PROD_URL), "szztsqdnvenfbgxtylkl");
  assert.equal(projectRefFromSupabaseUrl("not a url"), null);
  assert.equal(isLoopbackUrl("http://127.0.0.1:3000"), true);
  assert.equal(isLoopbackUrl("https://example.com"), false);
});
