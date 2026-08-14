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
  evaluateProbeGuard,
  isProbeTenant,
  projectRefFromSupabaseUrl,
} from "./probe-guard.mjs";

const URL_A = "https://szztsqdnvenfbgxtylkl.supabase.co";
const OK_ENV = {
  PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
  PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl",
};

test("writes are refused unless explicitly enabled", () => {
  const verdict = evaluateProbeGuard(
    { PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl" },
    URL_A,
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join(" "), /ALLOW_WRITES/);
});

test("the operator must name the project they intend to touch", () => {
  const verdict = evaluateProbeGuard({ PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1" }, URL_A);
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join(" "), /PROJECT_REF/);
});

test("a mismatched project ref is refused, so a stale env cannot redirect the run", () => {
  const verdict = evaluateProbeGuard(
    { ...OK_ENV, PACEMATE_SECURITY_PROBE_PROJECT_REF: "someotherproject" },
    URL_A,
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.problems.join(" "), /someotherproject/);
});

test("a correctly declared run is allowed", () => {
  const verdict = evaluateProbeGuard(OK_ENV, URL_A);
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.projectRef, "szztsqdnvenfbgxtylkl");
});

test("assertSafeToProbe throws rather than returning a falsy verdict", () => {
  assert.throws(() => assertSafeToProbe({}, URL_A), /Refusing to run/);
  assert.doesNotThrow(() => assertSafeToProbe(OK_ENV, URL_A));
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
  assert.equal(projectRefFromSupabaseUrl(URL_A), "szztsqdnvenfbgxtylkl");
  assert.equal(projectRefFromSupabaseUrl("not a url"), null);
});
