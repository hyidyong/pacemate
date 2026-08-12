// Safety guards for the load harnesses (Stage 8, review findings 4 and 5).
//
// The booking-contention harness PROVISIONS auth users and profiles and then
// issues real booking mutations. Its only previous protection was a cleanup
// step in a `finally` block — which is not protection at all: it does not help
// if the process is killed, if cleanup itself fails, or if the operator pointed
// it at the wrong project. Guards must run BEFORE the first mutation and must
// fail closed.
//
// Everything here is a pure function over an env bag so it can be tested
// without touching a network or a database.

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function projectRefFromSupabaseUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    // https://<ref>.supabase.co
    const [ref] = hostname.split(".");
    return ref || null;
  } catch {
    return null;
  }
}

/**
 * Finding 5 — the application target.
 *
 * Virtual users send real credentials (passwords, session cookies) to whatever
 * --baseUrl says. Loopback is therefore the default and anything else needs a
 * deliberate opt-in, HTTPS, and a declared expected host, so a typo or a stale
 * flag cannot ship credentials to an unintended origin.
 */
export function evaluateTargetGuard(env, baseUrl) {
  const problems = [];

  if (isLoopbackUrl(baseUrl)) {
    return { allowed: true, problems, loopback: true };
  }

  if (env.PACEMATE_LOADTEST_ALLOW_REMOTE !== "1") {
    problems.push(
      `target ${baseUrl} is not loopback; set PACEMATE_LOADTEST_ALLOW_REMOTE=1 to send credentials off-box`,
    );
  }

  let host = null;
  try {
    const url = new URL(baseUrl);
    host = url.host;
    if (url.protocol !== "https:") {
      problems.push(`remote target must use https, got ${url.protocol.replace(":", "")}`);
    }
  } catch {
    problems.push(`target ${baseUrl} is not a valid URL`);
  }

  const expectedHost = env.PACEMATE_LOADTEST_EXPECTED_HOST;
  if (!expectedHost) {
    problems.push("remote target requires PACEMATE_LOADTEST_EXPECTED_HOST to confirm the destination");
  } else if (host && expectedHost !== host) {
    problems.push(`target host ${host} does not match PACEMATE_LOADTEST_EXPECTED_HOST=${expectedHost}`);
  }

  return { allowed: problems.length === 0, problems, loopback: false };
}

/**
 * Finding 4 — the database the harness will MUTATE.
 *
 * Three independent confirmations are required, and all of them must be
 * explicit. Cleanup is not one of them.
 *
 *  1. `PACEMATE_LOADTEST_ALLOW_MUTATIONS=1` — a deliberate destructive opt-in.
 *  2. `PACEMATE_LOADTEST_EXPECTED_PROJECT_REF` equal to the ref actually derived
 *     from the configured Supabase URL — proves the operator knows WHICH
 *     project is about to be written to, so a stale .env.local cannot silently
 *     redirect the run at production.
 *  3. Either the target is declared non-production
 *     (`PACEMATE_LOADTEST_TARGET_KIND=non-production`) or an explicitly
 *     isolated tenant is named (`PACEMATE_LOADTEST_SCHOOL_ID`), so a shared
 *     project can still be used without touching real tenants' data.
 */
export function evaluateMutationGuard(env, supabaseUrl) {
  const problems = [];
  const actualRef = projectRefFromSupabaseUrl(supabaseUrl);

  if (env.PACEMATE_LOADTEST_ALLOW_MUTATIONS !== "1") {
    problems.push(
      "mutations are disabled by default; set PACEMATE_LOADTEST_ALLOW_MUTATIONS=1 to allow this run to create and book real rows",
    );
  }

  const expectedRef = env.PACEMATE_LOADTEST_EXPECTED_PROJECT_REF;
  if (!expectedRef) {
    problems.push(
      "set PACEMATE_LOADTEST_EXPECTED_PROJECT_REF to the Supabase project ref you intend to mutate",
    );
  } else if (!actualRef) {
    problems.push("could not derive a Supabase project ref from the configured URL");
  } else if (expectedRef !== actualRef) {
    problems.push(
      `configured Supabase project is "${actualRef}" but PACEMATE_LOADTEST_EXPECTED_PROJECT_REF is "${expectedRef}"`,
    );
  }

  const targetKind = env.PACEMATE_LOADTEST_TARGET_KIND;
  const isolatedSchoolId = env.PACEMATE_LOADTEST_SCHOOL_ID;
  if (targetKind !== "non-production" && !isolatedSchoolId) {
    problems.push(
      'target is not declared non-production; set PACEMATE_LOADTEST_TARGET_KIND=non-production, or name an isolated tenant with PACEMATE_LOADTEST_SCHOOL_ID',
    );
  }

  return {
    allowed: problems.length === 0,
    problems,
    projectRef: actualRef,
    isolatedSchoolId: isolatedSchoolId ?? null,
    declaredNonProduction: targetKind === "non-production",
  };
}

export function assertSafeToMutate(env, { supabaseUrl, baseUrl }) {
  const target = evaluateTargetGuard(env, baseUrl);
  const mutation = evaluateMutationGuard(env, supabaseUrl);
  const problems = [...target.problems, ...mutation.problems];

  if (problems.length) {
    throw new Error(
      [
        "Refusing to run: this harness creates auth users, profiles and real bookings.",
        "Cleanup afterwards is not a safety mechanism — these checks run first.",
        "",
        ...problems.map((problem) => `  - ${problem}`),
        "",
        "See docs/upgrade/stage-08/LOAD_TEST_PLAN.md for the intended setup.",
      ].join("\n"),
    );
  }

  return mutation;
}

export function assertSafeTarget(env, baseUrl) {
  const target = evaluateTargetGuard(env, baseUrl);
  if (!target.allowed) {
    throw new Error(
      [
        `Refusing to send credentials to ${baseUrl}.`,
        "",
        ...target.problems.map((problem) => `  - ${problem}`),
      ].join("\n"),
    );
  }
  return target;
}
