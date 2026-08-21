// The probe harness provisions tenants and auth users against the live project.
// Stage 8 established the rule these tests enforce: a guard that can be talked
// out of refusing is not a guard, and cleanup in a `finally` is not protection.
import assert from "node:assert/strict";
import test from "node:test";

import {
  PROBE_MARKER,
  PROBE_TENANT_SLUG_PREFIX,
  assertScopedFilter,
  assertSafeToProbe,
  createRunMarker,
  evaluateHostGuard,
  evaluateProbeGuard,
  isProbeTenant,
  projectRefFromSupabaseUrl,
  runMarkerFromProbeAuthEmail,
} from "./probe-guard.mjs";

const PROD_URL = "https://szztsqdnvenfbgxtylkl.supabase.co";
const SCRATCH_REF = "stagingref000000";
const SCRATCH_URL = `https://${SCRATCH_REF}.supabase.co`;
const OK_ENV = {
  PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
  PACEMATE_SECURITY_PROBE_PROJECT_REF: SCRATCH_REF,
};

test("writes are refused unless explicitly enabled", () => {
  const verdict = evaluateProbeGuard(
    { PACEMATE_SECURITY_PROBE_PROJECT_REF: SCRATCH_REF },
    SCRATCH_URL,
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join(" "), /ALLOW_WRITES/);
});

test("the operator must name the project they intend to touch", () => {
  const verdict = evaluateProbeGuard({ PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1" }, SCRATCH_URL);
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join(" "), /PROJECT_REF/);
});

test("a mismatched project ref is refused, so a stale env cannot redirect the run", () => {
  const verdict = evaluateProbeGuard(
    { ...OK_ENV, PACEMATE_SECURITY_PROBE_PROJECT_REF: "someotherproject" },
    SCRATCH_URL,
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join(" "), /someotherproject/);
});

test("a correctly declared non-production run is allowed", () => {
  const verdict = evaluateProbeGuard(OK_ENV, SCRATCH_URL);
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.projectRef, SCRATCH_REF);
});

test("assertSafeToProbe throws rather than returning a falsy verdict", () => {
  assert.throws(() => assertSafeToProbe({}, SCRATCH_URL), /Refusing to run/);
  assert.doesNotThrow(() => assertSafeToProbe(OK_ENV, SCRATCH_URL));
});

test("the known production project is refused even with every write opt-in", () => {
  const verdict = evaluateProbeGuard(
    {
      PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
      PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl",
    },
    PROD_URL,
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join("\n"), /KNOWN PRODUCTION/);
});

test("a configured production ref is refused for loopback, malformed, and unrelated URLs", () => {
  const productionEnv = {
    PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
    PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
    PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl",
  };

  for (const url of [
    "http://127.0.0.1:54321",
    "not a URL",
    "https://unrelated.example",
  ]) {
    const verdict = evaluateProbeGuard(productionEnv, url);
    assert.equal(verdict.allowed, false, `${url} must not hide a configured production identity`);
    assert.match(verdict.problems.join("\n"), /KNOWN PRODUCTION/);
  }
});

test("an explicitly opted-in loopback probe remains allowed for a non-production local identity", () => {
  const verdict = evaluateProbeGuard(
    {
      PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
      PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
      PACEMATE_SECURITY_PROBE_PROJECT_REF: "fakeproject",
    },
    "http://127.0.0.1:54321",
  );
  assert.equal(verdict.allowed, true, verdict.problems.join("; "));
  assert.equal(verdict.loopback, true);
});

test("a tenant is disposable only when the database row carries the marker", () => {
  const runMarker = createRunMarker("a".repeat(32));
  assert.equal(isProbeTenant({ slug: `${runMarker}-a-run123` }, runMarker), true);
  assert.equal(isProbeTenant({ slug: `${runMarker}-a-run123` }), true);
  assert.equal(isProbeTenant({ slug: `${PROBE_TENANT_SLUG_PREFIX}a-123` }), false);
  // Naming the real tenant, or any tenant without the marker, proves nothing.
  assert.equal(isProbeTenant({ slug: null }), false);
  assert.equal(isProbeTenant({ slug: "kmu" }), false);
  assert.equal(isProbeTenant(null), false);
  assert.equal(isProbeTenant({ name: `${PROBE_MARKER} university` }), false);
});

test("deletes must be marker-scoped or id-scoped — never a whole table", () => {
  assert.throws(() => assertScopedFilter(""), /Refusing an unscoped delete/);
  assert.throws(() => assertScopedFilter("is_read=eq.false"), /Refusing an unscoped delete/);
  assert.throws(() => assertScopedFilter(undefined), /Refusing an unscoped delete/);
  assert.equal(assertScopedFilter("id=eq.abc"), "id=eq.abc");
  assert.equal(assertScopedFilter("id=in.(a,b)"), "id=in.(a,b)");
  const runMarker = createRunMarker("b".repeat(32));
  assert.equal(
    assertScopedFilter(`title=like.${runMarker}%25`),
    `title=like.${runMarker}%25`,
  );
});

test("project refs are derived from the URL, not from the environment", () => {
  assert.equal(projectRefFromSupabaseUrl(PROD_URL), "szztsqdnvenfbgxtylkl");
  assert.equal(projectRefFromSupabaseUrl(SCRATCH_URL), SCRATCH_REF);
  assert.equal(projectRefFromSupabaseUrl("not a url"), null);
});

test("Realtime foreign-tenant auth fixtures retain exact-run recovery ownership", () => {
  const runMarker = createRunMarker("c".repeat(32));
  assert.equal(
    runMarkerFromProbeAuthEmail(`${runMarker}-notif-foreign-run123@probe.invalid`),
    runMarker,
  );
  assert.equal(
    runMarkerFromProbeAuthEmail(`${runMarker}-notif-foreign@real.example`),
    null,
  );
});

// ---------------------------------------------------------------------------
// Final Stage 10 verifier blocker — configured project identity must be parsed
// and validated before any production/host/equality decision.
// ---------------------------------------------------------------------------

const PROD_REF = "szztsqdnvenfbgxtylkl";
const LOOPBACK_URL = "http://127.0.0.1:54321";
const FULL_OPT_IN = {
  PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
  PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
};
const PRODUCTION_VARIANTS = [
  PROD_REF,
  ` ${PROD_REF}`,
  `${PROD_REF} `,
  PROD_REF.toUpperCase(),
  "SzZtSqDnVeNfBgXtYlKl",
];

test("production ref variants (whitespace, case) are refused on every URL, with both opt-ins", () => {
  for (const ref of PRODUCTION_VARIANTS) {
    for (const url of [PROD_URL, LOOPBACK_URL, SCRATCH_URL, "not a URL", "https://unrelated.example"]) {
      const verdict = evaluateProbeGuard(
        { ...FULL_OPT_IN, PACEMATE_SECURITY_PROBE_PROJECT_REF: ref },
        url,
      );
      assert.equal(verdict.allowed, false, `${JSON.stringify(ref)} on ${url} must be refused`);
      assert.match(
        verdict.problems.join("\n"),
        /KNOWN PRODUCTION/,
        `${JSON.stringify(ref)} on ${url} must be identified as production`,
      );
    }
  }
});

test("malformed configured refs fail closed even on an opted-in loopback target", () => {
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
    for (const url of [LOOPBACK_URL, SCRATCH_URL]) {
      const verdict = evaluateProbeGuard(
        { ...FULL_OPT_IN, PACEMATE_SECURITY_PROBE_PROJECT_REF: ref },
        url,
      );
      assert.equal(verdict.allowed, false, `${JSON.stringify(ref)} on ${url} must be refused`);
      assert.match(verdict.problems.join("\n"), /PACEMATE_SECURITY_PROBE_PROJECT_REF/);
    }
  }
});

test("a malformed expected ref is never used to build the trusted host list", () => {
  const verdict = evaluateHostGuard({}, SCRATCH_URL, " stagingref000000");
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join("\n"), /not a valid Supabase project ref|lowercase/);
});

test("URL-derived refs pass through the same validator as configured refs", () => {
  assert.equal(projectRefFromSupabaseUrl("https://under_score.supabase.co"), null);
  assert.equal(projectRefFromSupabaseUrl("https://-leading.supabase.co"), null);
  assert.equal(projectRefFromSupabaseUrl(`https://${PROD_REF.toUpperCase()}.supabase.co`), PROD_REF);
});

test("a configured production ref is refused when the URL yields no ref and loopback is not opted in", () => {
  const verdict = evaluateProbeGuard(
    { PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1", PACEMATE_SECURITY_PROBE_PROJECT_REF: PROD_REF },
    LOOPBACK_URL,
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join("\n"), /KNOWN PRODUCTION/);
});
