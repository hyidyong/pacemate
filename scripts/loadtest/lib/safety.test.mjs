import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWN_PRODUCTION_PROJECT_REFS,
  TEST_TENANT_SLUG_PREFIX,
  assertSafeToMutate,
  evaluateMutationGuard,
  evaluateTargetGuard,
  isLoopbackUrl,
  projectRefFromSupabaseUrl,
  verifyIsolatedTenant,
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

const LOCAL_ENV = {
  PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
  PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: "pacemate-stage-10-local",
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

test("a plaintext cloud Supabase origin is refused", () => {
  const result = evaluateMutationGuard(FULLY_ALLOWED, "http://stagingref000000.supabase.co");
  assert.equal(result.allowed, false, "service-role credentials must never use plaintext HTTP");
  assert.match(result.problems.join("\n"), /https/);
});

test("an attacker suffix after a plausible Supabase hostname is refused", () => {
  const result = evaluateMutationGuard(
    FULLY_ALLOWED,
    "https://stagingref000000.supabase.co.attacker.example",
  );
  assert.equal(result.allowed, false, "a matching first label must not authorize an attacker origin");
  assert.match(result.problems.join("\n"), /exactly|canonical|origin/);
});

test("an arbitrary domain carrying a plausible project-ref label is refused", () => {
  const result = evaluateMutationGuard(FULLY_ALLOWED, "https://stagingref000000.evil.test");
  assert.equal(result.allowed, false, "project identity must not be inferred from the first label");
  assert.match(result.problems.join("\n"), /exactly|canonical|origin/);
});

test("non-canonical cloud Supabase origin variants are refused", () => {
  for (const url of [
    "https://stagingref000000.attacker.supabase.co",
    "https://stagingref000000.supabase.co:444",
    "https://user@stagingref000000.supabase.co",
    "https://stagingref000000.supabase.co.",
  ]) {
    const result = evaluateMutationGuard(FULLY_ALLOWED, url);
    assert.equal(result.allowed, false, `${url} must not be accepted as the declared project origin`);
  }
});

test("the repository-local Supabase origin remains available with its explicit local identity", () => {
  for (const url of ["http://127.0.0.1:54321", "http://localhost:54321"]) {
    const result = evaluateMutationGuard(LOCAL_ENV, url);
    assert.equal(result.allowed, true, `${url}: ${result.problems.join("; ")}`);
    assert.equal(result.projectRef, "pacemate-stage-10-local");
  }
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

test("assertSafeToMutate rejects with an actionable message and does not claim cleanup protects anything", async () => {
  let message = "";
  try {
    // Async since round 2: a claimed tenant is confirmed against the database.
    await assertSafeToMutate({}, { supabaseUrl: PROD_URL, baseUrl: "http://127.0.0.1:3000" });
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

// --- Review finding 4 (round 2): self-assertion is not evidence -------------
//
// Both bypasses below were reproduced against the previous guard before this
// change: it allowed destructive runs against the PRODUCTION project either by
// declaring it non-production, or by naming an arbitrary school UUID (including
// the real tenant's) as "isolated".

const PROD_REF = "szztsqdnvenfbgxtylkl";
const REAL_TENANT_UUID = "862b661c-810a-4440-ba76-722b2fcf8d6a";

test("BYPASS A: declaring the production project non-production is refused", () => {
  const result = evaluateMutationGuard(
    {
      PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
      PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: PROD_REF,
      PACEMATE_LOADTEST_TARGET_KIND: "non-production",
    },
    PROD_URL,
  );

  assert.equal(result.allowed, false, "a self-asserted label must not make production safe");
  assert.ok(
    result.problems.some((p) => p.includes("self-asserted") || p.includes("KNOWN PRODUCTION")),
    `refusal must name the reason, got: ${result.problems.join("; ")}`,
  );
});

test("BYPASS B: an arbitrary school UUID on production is not proof of isolation", async () => {
  const sync = evaluateMutationGuard(
    {
      PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
      PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: PROD_REF,
      PACEMATE_LOADTEST_SCHOOL_ID: REAL_TENANT_UUID,
    },
    PROD_URL,
  );
  // Production is refused before any database lookup. A tenant id cannot make
  // the target eligible for verification in the first place.
  assert.equal(sync.allowed, false);
  assert.equal(sync.requiresTenantVerification, false);
  assert.match(sync.problems.join("\n"), /KNOWN PRODUCTION/);

  // The database says this tenant carries no test marker.
  const rest = {
    select: async () => [{ id: REAL_TENANT_UUID, name: "계명대학교", slug: "kmu" }],
  };
  const verification = await verifyIsolatedTenant(rest, REAL_TENANT_UUID);
  assert.equal(verification.verified, false, "a real tenant must not verify as isolated");
  assert.match(verification.reason, /does not carry the test marker/);

  await assert.rejects(
    () =>
      assertSafeToMutate(
        {
          PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
          PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: PROD_REF,
          PACEMATE_LOADTEST_SCHOOL_ID: REAL_TENANT_UUID,
        },
        { supabaseUrl: PROD_URL, baseUrl: "http://127.0.0.1:3000", rest },
      ),
    /KNOWN PRODUCTION/,
    "naming any tenant UUID must not authorize destructive work on production",
  );
});

test("even a genuinely marked test tenant cannot authorize load testing on production", async () => {
  const markedId = "77777777-0000-4000-8000-000000000077";
  const rest = {
    select: async () => [
      { id: markedId, name: "load test university", slug: `${TEST_TENANT_SLUG_PREFIX}alpha` },
    ],
  };

  await assert.rejects(
    () => assertSafeToMutate(
      {
        PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
        PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: PROD_REF,
        PACEMATE_LOADTEST_SCHOOL_ID: markedId,
      },
      { supabaseUrl: PROD_URL, baseUrl: "http://127.0.0.1:3000", rest },
    ),
    /KNOWN PRODUCTION/,
  );
});

test("a claimed tenant that does not exist is refused", async () => {
  const rest = { select: async () => [] };
  const verification = await verifyIsolatedTenant(rest, "12345678-0000-4000-8000-000000000000");
  assert.equal(verification.verified, false);
  assert.match(verification.reason, /no schools row/);
});

test("verification cannot be skipped by omitting the database client", async () => {
  await assert.rejects(
    () =>
      assertSafeToMutate(
        {
          PACEMATE_LOADTEST_ALLOW_MUTATIONS: "1",
          PACEMATE_LOADTEST_EXPECTED_PROJECT_REF: "stagingref000000",
          PACEMATE_LOADTEST_SCHOOL_ID: REAL_TENANT_UUID,
        },
        { supabaseUrl: STAGING_URL, baseUrl: "http://127.0.0.1:3000" },
      ),
    /cannot verify the claimed test tenant/,
  );
});

test("the production denylist is compiled in, not environment-supplied", () => {
  assert.ok(
    KNOWN_PRODUCTION_PROJECT_REFS.has(PROD_REF),
    "the live project must be listed as production in the repository itself",
  );
});
