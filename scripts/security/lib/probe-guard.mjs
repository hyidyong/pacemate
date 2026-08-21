// Safety guards for the Stage 9 security probe harness.
//
// The harness provisions two disposable tenants, two auth users and a small set
// of rows in each, then attacks them from the anon key and from each tenant's
// user. Stage 10 forbids running it against every compiled production project;
// cleanup is not a safety mechanism. These guards run BEFORE the first write
// and fail closed, in the same spirit as scripts/loadtest/lib/safety.mjs.
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

import { isKnownProductionProjectRef } from "./production-targets.mjs";
import { parseProjectRef } from "./project-ref.mjs";

/**
 * Codex round 5, F6 — OWNERSHIP MUST BE EXECUTION-SPECIFIC.
 *
 * `PROBE_MARKER` used to be one fixed string shared by every run, and the sweep
 * matched it with `like.*marker*` — a substring search. Two consequences, both
 * of them a data-loss risk against a live project:
 *
 *   * a genuine post, FAQ or course review whose text merely CONTAINED the
 *     phrase would be deleted by a sweep that had never created it;
 *   * two runs (a developer and CI, say) could not be told apart, so one run's
 *     recovery sweep would delete the other run's live fixtures mid-flight.
 *
 * The family prefix below is now only for DISCOVERY by an operator who is
 * explicitly cleaning up after a crash. Every automatic path is keyed on a
 * per-execution random token, and matching is by PREFIX rather than substring,
 * so ownership is provable rather than probable.
 */
export const PROBE_MARKER_FAMILY = "pacemate-probe";
const RUN_MARKER_RE = /^pacemate-probe-[0-9a-f]{32}$/;
const OWNED_VALUE_RE = /^(pacemate-probe-[0-9a-f]{32})(?=$|[-\s])/;
const PROBE_AUTH_EMAIL_RE =
  /^(pacemate-probe-[0-9a-f]{32})-(?:(?:prof-)?[ab]|(?:assistant|admin)-a|notif-(?:a|b|foreign))-[a-z0-9]{5,}@probe\.invalid$/;

/**
 * A marker that belongs to exactly one execution.
 *
 * 128 bits of randomness: the point is not secrecy, it is that no real row can
 * plausibly carry it and no other run can collide with it.
 */
export function createRunMarker(randomHex) {
  const token =
    randomHex ??
    // Node 18+ everywhere this runs; the import is local so the module stays
    // dependency-free for the pure-function tests.
    // eslint-disable-next-line no-undef
    globalThis.crypto.randomUUID().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(token)) {
    throw new Error(`probe run marker must be exactly 32 hex characters, got "${token}"`);
  }
  return `${PROBE_MARKER_FAMILY}-${token}`;
}

export function isRunMarker(value) {
  return typeof value === "string" && RUN_MARKER_RE.test(value);
}

/** Return the exact run marker only when a value starts with its full structure. */
export function runMarkerFromOwnedValue(value) {
  if (typeof value !== "string") return null;
  return OWNED_VALUE_RE.exec(value)?.[1] ?? null;
}

/** Auth identities have a stricter shape than ordinary marker-bearing text. */
export function runMarkerFromProbeAuthEmail(email) {
  if (typeof email !== "string") return null;
  return PROBE_AUTH_EMAIL_RE.exec(email)?.[1] ?? null;
}

/**
 * Ownership predicate for a PostgREST filter. Prefix, never substring: a row
 * whose text merely contains the marker somewhere is not this run's row.
 */
export function ownedByRun(runMarker) {
  if (!isRunMarker(runMarker)) {
    throw new Error(`refusing to build an ownership filter from "${runMarker}"`);
  }
  // The predicate is interpolated into a query STRING, where a bare `%` begins
  // a percent-escape — PostgREST answered 500 on the unencoded form. `%25` is
  // the LIKE wildcard once decoded.
  return `like.${runMarker}%25`;
}

// Retained so the SLUG shape stays derivable from whichever marker is in play.
export const tenantSlugPrefix = (runMarker) => `${runMarker}-`;

/**
 * DEPRECATED for ownership. Still exported because the operator-run recovery
 * sweep needs to find rows from runs whose token it does not know, and because
 * older fixtures in a crashed project may still carry it.
 */
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
        // A ref is a single label. `a.b.supabase.co` is not a project host, and
        // the label must satisfy the same shape the configured ref must, so the
        // two identities are compared on equal terms. (`URL` already lower-cases
        // the hostname, so a canonical production ref is still recognised.)
        // Shape-only here: a well-formed PRODUCTION label must be returned so
        // the caller can refuse it by name, not disappear into `null`.
        const label = hostname.slice(0, -suffix.length);
        return parseProjectRef(label).wellFormed ? label : null;
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
export function evaluateHostGuard(env, rawUrl, rawExpectedRef) {
  const problems = [];
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, problems: [`"${rawUrl}" is not a valid URL`], loopback: false };
  }

  // The expected ref is structured input too: an unvalidated value must never
  // be spliced into the trusted-host list. Callers normally pass an already
  // parsed ref; re-parsing here keeps this function safe when called directly.
  const expected = parseProjectRef(rawExpectedRef, {
    source: "PACEMATE_SECURITY_PROBE_PROJECT_REF",
  });
  problems.push(...expected.problems);
  const expectedRef = expected.ref;

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
 *
 * Order matters and is deliberate: both identities — the one derived from the
 * URL and the one the operator configured — are parsed and validated FIRST.
 * Production is recognised on the canonical form of each, so whitespace, case,
 * a loopback URL, both opt-ins, or a missing/malformed URL cannot hide a
 * production identity supplied in the other place. Only a ref the parser
 * accepted is ever used for the host or equality decisions that follow.
 */
export function evaluateProbeGuard(env, supabaseUrl) {
  const problems = [];
  const actualRef = projectRefFromSupabaseUrl(supabaseUrl);
  const configured = parseProjectRef(env.PACEMATE_SECURITY_PROBE_PROJECT_REF, {
    source: "PACEMATE_SECURITY_PROBE_PROJECT_REF",
  });
  const expectedRef = configured.ref;

  const productionRefs = new Set(configured.productionRefs);
  if (actualRef && isKnownProductionProjectRef(actualRef)) productionRefs.add(actualRef);
  for (const productionRef of productionRefs) {
    problems.push(
      `project "${productionRef}" is a KNOWN PRODUCTION project and cannot be probed`,
    );
  }
  // Shape/canonical-form problems for the configured ref (production problems
  // were already reported above, once per ref).
  problems.push(...configured.problems.filter((problem) => !problem.includes("KNOWN PRODUCTION")));

  if (env.PACEMATE_SECURITY_PROBE_ALLOW_WRITES !== "1") {
    problems.push(
      "this harness creates disposable tenants, auth users and rows; set PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 to allow it",
    );
  }

  // Only the validated ref reaches the host guard; an invalid one is passed as
  // null so it can never shape the trusted-host list.
  const host = evaluateHostGuard(env, supabaseUrl, expectedRef);
  problems.push(...host.problems);

  if (!configured.present) {
    problems.push(
      "set PACEMATE_SECURITY_PROBE_PROJECT_REF to the Supabase project ref you intend to probe",
    );
  } else if (configured.valid && !host.loopback) {
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
export function isProbeTenant(school, runMarker) {
  if (!school || typeof school.slug !== "string") return false;
  // Codex round 5, F6: when a run marker is supplied the tenant must belong to
  // THIS execution, not merely to the probe family. Passing no marker keeps the
  // family check, which is what the operator recovery sweep needs when it is
  // cleaning up after a run whose token nobody recorded.
  const marker = runMarkerFromOwnedValue(school.slug);
  if (!marker) return false;
  if (runMarker && marker !== runMarker) return false;
  return new RegExp(`^${marker}-[ab]-[a-z0-9]{5,}$`).test(school.slug);
}

/**
 * Guard for every marker-scoped delete: the filter must actually constrain the
 * delete to this run's rows. A filter that would delete a whole table is a bug,
 * not a cleanup.
 */
export function assertScopedFilter(filter) {
  // Codex round 5, F6: a filter is scoped if it names an id, or if it carries
  // an execution-specific marker from the probe family. The old check looked
  // for one hard-coded legacy string, which a per-run marker does not contain.
  const scoped =
    typeof filter === "string" &&
    (/(^|[^0-9a-f])pacemate-probe-[0-9a-f]{32}(?=$|[^0-9a-f])/.test(filter) ||
      filter.includes(PROBE_MARKER) ||
      /(^|&)id=(eq|in)\./.test(filter));
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
