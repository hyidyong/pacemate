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

/**
 * Hosts a Supabase project can legitimately live on. The check below requires
 * the hostname to equal `<ref><suffix>` EXACTLY — not merely to start with the
 * ref, which is what the previous implementation did.
 */
export const SUPABASE_HOST_SUFFIXES = [".supabase.co", ".supabase.in"];
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function projectRefFromSupabaseUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    for (const suffix of SUPABASE_HOST_SUFFIXES) {
      if (hostname.endsWith(suffix)) {
        const ref = hostname.slice(0, -suffix.length);
        // A ref is a single label. `a.b.supabase.co` is not a project host.
        return ref && !ref.includes(".") ? ref : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isLoopbackUrl(rawUrl) {
  try {
    return LOOPBACK_HOSTS.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Codex round 3, F1 — where privileged credentials may be sent.
 *
 * The old guard derived the "project ref" as `hostname.split(".")[0]` and
 * compared that to the expected ref. Measured against the real function, ALL of
 * these passed while carrying the service-role key:
 *
 *   https://<ref>.supabase.co.attacker.example   crafted suffix
 *   https://<ref>.evil.test                      unrelated domain
 *   http://<ref>.supabase.co                     no TLS
 *
 * The hostname must now equal `<expectedRef><supabase suffix>` exactly, over
 * HTTPS, on the default port, with no embedded credentials.
 *
 * Loopback is permitted only with an explicit opt-in, and exists so the
 * harness's own subprocess tests can drive the real runner against a local
 * stand-in. It is never a path to a remote host.
 */
export function evaluateHostGuard(env, rawUrl, expectedRef) {
  const problems = [];
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, problems: [`"${rawUrl}" is not a valid URL`], loopback: false };
  }

  if (url.username || url.password) {
    problems.push("the Supabase URL must not embed credentials");
  }

  if (isLoopbackUrl(rawUrl)) {
    if (env.PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK !== "1") {
      problems.push(
        "loopback targets require PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK=1 (this exists for the harness's own tests)",
      );
    }
    return { allowed: problems.length === 0, problems, loopback: true };
  }

  if (url.protocol !== "https:") {
    problems.push(`privileged credentials may only be sent over https, got ${url.protocol.replace(":", "")}`);
  }
  if (url.port) {
    problems.push(`unexpected port ${url.port} on a Supabase project host`);
  }

  const expectedHosts = expectedRef
    ? SUPABASE_HOST_SUFFIXES.map((suffix) => `${expectedRef}${suffix}`)
    : [];
  if (expectedRef && !expectedHosts.includes(url.hostname)) {
    problems.push(
      `refusing to send privileged credentials to "${url.hostname}"; expected exactly one of ${expectedHosts.join(", ")}`,
    );
  }

  return { allowed: problems.length === 0, problems, loopback: false };
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
  const host = evaluateHostGuard(env, supabaseUrl, expectedRef);
  problems.push(...host.problems);

  if (!expectedRef) {
    problems.push(
      "set PACEMATE_SECURITY_PROBE_PROJECT_REF to the Supabase project ref you intend to probe",
    );
  } else if (!host.loopback) {
    if (!actualRef) {
      problems.push("could not derive a Supabase project ref from the configured URL");
    } else if (expectedRef !== actualRef) {
      problems.push(
        `configured Supabase project is "${actualRef}" but PACEMATE_SECURITY_PROBE_PROJECT_REF is "${expectedRef}"`,
      );
    }
  }

  return { allowed: problems.length === 0, problems, projectRef: actualRef, loopback: host.loopback };
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
