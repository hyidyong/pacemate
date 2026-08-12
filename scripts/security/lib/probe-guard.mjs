// Safety guards for the Stage 9 security probe harness.
//
// The harness provisions two disposable tenants, two auth users and a small set
// of rows in each, then attacks them from the anon key and from each tenant's
// user. It runs against the LIVE project because that is the only database this
// project has (KI-021), so the protection cannot be "we clean up afterwards" —
// cleanup is not a safety mechanism. These guards run BEFORE the first write and
// fail closed, in the same spirit as scripts/loadtest/lib/safety.mjs.
//
// The rules:
//
//   1. Every row the harness creates carries PROBE_MARKER in a text column, and
//      every delete is scoped by that marker or by an id the harness itself
//      minted in this run. Nothing else is ever touched.
//   2. The harness may only mutate tenants whose `schools.slug` starts with
//      PROBE_TENANT_SLUG_PREFIX. It creates those tenants itself; it will never
//      accept a tenant id from the environment.
//   3. Writes are opt-in (PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1) and the
//      operator must name the project ref they intend to touch, which must match
//      the configured URL.
//
// Everything here is a pure function over an env bag plus small helpers, so the
// decision logic is unit-testable with no network.

export const PROBE_MARKER = "pacemate-stage9-probe";
export const PROBE_TENANT_SLUG_PREFIX = `${PROBE_MARKER}-`;

export function projectRefFromSupabaseUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    const [ref] = hostname.split(".");
    return ref || null;
  } catch {
    return null;
  }
}

/**
 * Synchronous verdict on whether this run may write anything at all.
 */
export function evaluateProbeGuard(env, supabaseUrl) {
  const problems = [];
  const actualRef = projectRefFromSupabaseUrl(supabaseUrl);

  if (env.PACEMATE_SECURITY_PROBE_ALLOW_WRITES !== "1") {
    problems.push(
      "this harness creates disposable tenants, auth users and rows; set PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 to allow it",
    );
  }

  const expectedRef = env.PACEMATE_SECURITY_PROBE_PROJECT_REF;
  if (!expectedRef) {
    problems.push(
      "set PACEMATE_SECURITY_PROBE_PROJECT_REF to the Supabase project ref you intend to probe",
    );
  } else if (!actualRef) {
    problems.push("could not derive a Supabase project ref from the configured URL");
  } else if (expectedRef !== actualRef) {
    problems.push(
      `configured Supabase project is "${actualRef}" but PACEMATE_SECURITY_PROBE_PROJECT_REF is "${expectedRef}"`,
    );
  }

  return { allowed: problems.length === 0, problems, projectRef: actualRef };
}

/**
 * A tenant is disposable only if the DATABASE says so. Used both before writing
 * into a probe tenant and before deleting one.
 */
export function isProbeTenant(school) {
  return (
    Boolean(school) &&
    typeof school.slug === "string" &&
    school.slug.startsWith(PROBE_TENANT_SLUG_PREFIX)
  );
}

/**
 * Guard for every marker-scoped delete: the filter must actually constrain the
 * delete to this run's rows. A filter that would delete a whole table is a bug,
 * not a cleanup.
 */
export function assertScopedFilter(filter) {
  const scoped =
    typeof filter === "string" &&
    (filter.includes(PROBE_MARKER) || /(^|&)id=(eq|in)\./.test(filter));
  if (!scoped) {
    throw new Error(
      `Refusing an unscoped delete: filter ${JSON.stringify(filter)} is neither marker-scoped nor id-scoped`,
    );
  }
  return filter;
}

export function assertSafeToProbe(env, supabaseUrl) {
  const verdict = evaluateProbeGuard(env, supabaseUrl);
  if (!verdict.allowed) {
    throw new Error(
      [
        "Refusing to run the security probe harness.",
        "It provisions disposable tenants and auth users against a live project;",
        "these checks run before the first write, not after.",
        "",
        ...verdict.problems.map((problem) => `  - ${problem}`),
        "",
        "See docs/upgrade/stage-09/SECURITY_TEST_MATRIX.md for the intended setup.",
      ].join("\n"),
    );
  }
  return verdict;
}
