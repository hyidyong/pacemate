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

import {
  LOOPBACK_HOSTS,
  SUPABASE_HOST_SUFFIXES,
  isLoopbackUrl,
  projectRefFromSupabaseUrl,
} from "../../security/lib/probe-guard.mjs";
import { KNOWN_PRODUCTION_PROJECT_REFS } from "../../security/lib/production-targets.mjs";

export {
  KNOWN_PRODUCTION_PROJECT_REFS,
  LOOPBACK_HOSTS,
  isLoopbackUrl,
  projectRefFromSupabaseUrl,
};

export const LOCAL_SUPABASE_PROJECT_REF = "pacemate-stage-10-local";

function evaluateSupabaseMutationOrigin(rawUrl, expectedRef) {
  const problems = [];
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      problems: [`Supabase target "${rawUrl}" is not a valid URL`],
      loopback: false,
      projectRef: null,
    };
  }

  if (url.username || url.password) {
    problems.push("the Supabase URL must not embed credentials");
  }

  const loopback = isLoopbackUrl(rawUrl);
  if (loopback) {
    if (!["http:", "https:"].includes(url.protocol)) {
      problems.push(`the local Supabase target must use http or https, got ${url.protocol.replace(":", "")}`);
    }
    if (expectedRef && expectedRef !== LOCAL_SUPABASE_PROJECT_REF) {
      problems.push(
        `loopback load testing is reserved for the repository-local project "${LOCAL_SUPABASE_PROJECT_REF}", not "${expectedRef}"`,
      );
    }
    return {
      problems,
      loopback: true,
      projectRef: expectedRef === LOCAL_SUPABASE_PROJECT_REF ? expectedRef : null,
    };
  }

  if (url.protocol !== "https:") {
    problems.push(
      `privileged credentials may only be sent to a cloud Supabase project over https, got ${url.protocol.replace(":", "")}`,
    );
  }
  if (url.port) {
    problems.push(`unexpected port ${url.port} on a cloud Supabase project host`);
  }

  const actualRef = projectRefFromSupabaseUrl(rawUrl);
  const expectedHosts = expectedRef
    ? SUPABASE_HOST_SUFFIXES.map((suffix) => `${expectedRef}${suffix}`)
    : [];
  if (expectedRef && !expectedHosts.includes(url.hostname)) {
    problems.push(
      `refusing to send privileged credentials to origin "${url.origin}"; expected exactly one of ${expectedHosts.join(", ")}`,
    );
  }

  return { problems, loopback: false, projectRef: actualRef };
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
 * A tenant may only be treated as isolated when the DATABASE says so. The
 * marker lives in `schools.slug`, is read back server-side, and cannot be
 * conjured by passing a UUID on the command line.
 */
export const TEST_TENANT_SLUG_PREFIX = "pacemate-loadtest-";

/**
 * Finding 4 — the database the harness will MUTATE.
 *
 * Round 2 of this guard was still bypassable, and both bypasses were
 * reproduced before this change:
 *
 *   A. `PACEMATE_LOADTEST_TARGET_KIND=non-production` on the production
 *      project — the operator simply asserts safety and is believed.
 *   B. `PACEMATE_LOADTEST_SCHOOL_ID=<the real tenant's uuid>` — an arbitrary
 *      UUID was accepted as proof of isolation.
 *
 * Self-assertion is therefore no longer evidence. Stage 10 tightens the rule:
 * a project in KNOWN_PRODUCTION_PROJECT_REFS is refused outright, even if a
 * marked tenant exists. Load testing belongs on a scratch project.
 *
 * This function stays pure and synchronous (env in, verdict out); the
 * server-side confirmation it demands is performed by assertSafeToMutate().
 */
export function evaluateMutationGuard(env, supabaseUrl) {
  const problems = [];
  const expectedRef = env.PACEMATE_LOADTEST_EXPECTED_PROJECT_REF;
  const target = evaluateSupabaseMutationOrigin(supabaseUrl, expectedRef);
  const actualRef = target.projectRef;
  const productionRef = [actualRef, expectedRef].find(
    (projectRef) => projectRef && KNOWN_PRODUCTION_PROJECT_REFS.has(projectRef),
  );
  const isKnownProduction = Boolean(productionRef);

  problems.push(...target.problems);

  if (env.PACEMATE_LOADTEST_ALLOW_MUTATIONS !== "1") {
    problems.push(
      "mutations are disabled by default; set PACEMATE_LOADTEST_ALLOW_MUTATIONS=1 to allow this run to create and book real rows",
    );
  }

  if (!expectedRef) {
    problems.push(
      "set PACEMATE_LOADTEST_EXPECTED_PROJECT_REF to the Supabase project ref you intend to mutate",
    );
  } else if (!actualRef && !target.loopback) {
    problems.push("could not derive a Supabase project ref from the configured URL");
  } else if (!target.loopback && expectedRef !== actualRef) {
    problems.push(
      `configured Supabase project is "${actualRef}" but PACEMATE_LOADTEST_EXPECTED_PROJECT_REF is "${expectedRef}"`,
    );
  }

  const isolatedSchoolId = env.PACEMATE_LOADTEST_SCHOOL_ID;
  const declaredNonProduction = env.PACEMATE_LOADTEST_TARGET_KIND === "non-production";

  if (isKnownProduction) {
    // Nothing the environment or a tenant marker says can make production a
    // permissible load-test target.
    problems.push(
      `project "${productionRef}" is a KNOWN PRODUCTION project and cannot be load tested`,
    );
  } else if (!declaredNonProduction && !isolatedSchoolId) {
    problems.push(
      'target is not declared non-production; set PACEMATE_LOADTEST_TARGET_KIND=non-production, or name a marked test tenant with PACEMATE_LOADTEST_SCHOOL_ID',
    );
  }

  return {
    allowed: problems.length === 0,
    problems,
    projectRef: actualRef,
    loopback: target.loopback,
    isKnownProduction,
    isolatedSchoolId: isolatedSchoolId ?? null,
    declaredNonProduction,
    // A claimed tenant is never trusted on its own; the caller must confirm it.
    requiresTenantVerification: Boolean(isolatedSchoolId) && !isKnownProduction,
  };
}

/**
 * Server-side confirmation that a claimed tenant really is a disposable test
 * tenant. Reads the row back and checks the marker the database holds — a UUID
 * on the command line proves nothing.
 */
export async function verifyIsolatedTenant(rest, schoolId) {
  const rows = await rest.select("schools", `select=id,name,slug&id=eq.${schoolId}`);
  const school = rows[0];

  if (!school) {
    return { verified: false, reason: `no schools row with id ${schoolId}` };
  }
  if (typeof school.slug !== "string" || !school.slug.startsWith(TEST_TENANT_SLUG_PREFIX)) {
    return {
      verified: false,
      reason: `tenant "${school.name}" (slug ${school.slug ?? "null"}) does not carry the test marker "${TEST_TENANT_SLUG_PREFIX}" — naming a real tenant's UUID does not make it isolated`,
    };
  }
  return { verified: true, school };
}

export async function assertSafeToMutate(env, { supabaseUrl, baseUrl, rest }) {
  const target = evaluateTargetGuard(env, baseUrl);
  const mutation = evaluateMutationGuard(env, supabaseUrl);
  const problems = [...target.problems, ...mutation.problems];

  // Confirm the claimed tenant against the database before anything is written.
  // Only attempted when the synchronous checks already passed, so a refusal is
  // never masked by a lookup error.
  if (!problems.length && mutation.requiresTenantVerification) {
    if (!rest) {
      problems.push("cannot verify the claimed test tenant: no database client was provided");
    } else {
      const verification = await verifyIsolatedTenant(rest, mutation.isolatedSchoolId);
      if (!verification.verified) {
        problems.push(verification.reason);
      }
    }
  }

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
