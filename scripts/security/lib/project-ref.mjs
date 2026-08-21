// Supabase project identity as security-sensitive structured input.
//
// Stage 10's final independent verification reproduced a bypass in the probe
// guard: PACEMATE_SECURITY_PROBE_PROJECT_REF was compared LITERALLY against the
// compiled production denylist, so " <prod>", "<prod> ", "<PROD>" and shape-
// invalid values such as "not/a/ref" were not recognised as production, and on
// an opted-in loopback target the integration wrapper went on to spawn its
// child processes. The canonical spelling was refused; every variant was not.
//
// This module is the ONE parser every guard path uses before a production
// denylist check, a host/local-target decision, a URL/ref equality decision, or
// a child-process spawn. Its contract:
//
//   * Canonicalisation is limited to what a DNS label permits — trimming outer
//     whitespace and lower-casing — and is used ONLY to recognise a production
//     identity. A canonicalised value is never handed back as a usable ref.
//   * A value is usable only if it is ALREADY canonical and matches the
//     repository-supported shape: one lowercase DNS label, the thing that can
//     form `<ref>.supabase.co`. Everything else is rejected fail-closed with no
//     ref at all, so no downstream comparison can run on garbage.
//   * Production is detected on the canonical form AND as an embedded label, so
//     a hostname or URL pasted into the ref variable is still named as
//     production rather than silently failing for a different reason.
//
// The shape is derived from the repository, not invented: the compiled
// production ref, the scratch fixtures (`stagingref000000`), the subprocess
// harness's explicit loopback identity (`fakeproject`) and the URL-derived
// label are all single lowercase DNS labels. Refs with other characters never
// appear on a Supabase host, so they are refused.

import { KNOWN_PRODUCTION_PROJECT_REFS } from "./production-targets.mjs";

/** One lowercase DNS label: 1–63 chars of [a-z0-9-], no leading/trailing hyphen. */
export const CLOUD_PROJECT_REF_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Parse a configured or derived project ref.
 *
 * @returns {{
 *   present: boolean,        // a value was supplied at all
 *   wellFormed: boolean,     // already canonical and shape-valid (may still be production)
 *   valid: boolean,          // wellFormed AND not production — safe to act on
 *   ref: string|null,        // the usable ref, ONLY when valid
 *   production: boolean,     // a compiled production ref was recognised
 *   productionRefs: string[],// which ones
 *   problems: string[],      // operator-facing refusal reasons
 * }}
 */
export function parseProjectRef(raw, { source = "project ref" } = {}) {
  const absent = {
    present: false,
    wellFormed: false,
    valid: false,
    ref: null,
    production: false,
    productionRefs: [],
    problems: [],
  };
  if (raw === undefined || raw === null || raw === "") return absent;

  const problems = [];
  if (typeof raw !== "string") {
    return {
      ...absent,
      present: true,
      problems: [`${source} must be a string, got ${typeof raw}`],
    };
  }

  const canonical = raw.trim().toLowerCase();
  const productionRefs = [...KNOWN_PRODUCTION_PROJECT_REFS].filter(
    (productionRef) => canonical === productionRef || containsLabel(canonical, productionRef),
  );
  for (const productionRef of productionRefs) {
    problems.push(`project "${productionRef}" is a KNOWN PRODUCTION project and cannot be probed`);
  }

  if (raw !== canonical) {
    problems.push(
      `${source} ${JSON.stringify(raw)} must be lowercase with no surrounding whitespace`,
    );
  }
  if (!CLOUD_PROJECT_REF_RE.test(canonical)) {
    problems.push(
      `${source} ${JSON.stringify(raw)} is not a valid Supabase project ref (expected a single lowercase DNS label)`,
    );
  }

  const wellFormed = raw === canonical && CLOUD_PROJECT_REF_RE.test(canonical);
  const valid = problems.length === 0;
  return {
    present: true,
    wellFormed,
    valid,
    ref: valid ? raw : null,
    production: productionRefs.length > 0,
    productionRefs,
    problems,
  };
}

/**
 * True when `label` appears in `value` delimited by non-label characters — the
 * way a project ref appears inside `<ref>.supabase.co` or a pasted URL. A
 * plain substring test would be noisier without being safer.
 */
function containsLabel(value, label) {
  const index = value.indexOf(label);
  if (index === -1) return false;
  const before = index === 0 ? "" : value[index - 1];
  const after = value[index + label.length] ?? "";
  const isLabelChar = (ch) => ch !== "" && /[a-z0-9-]/.test(ch);
  return !isLabelChar(before) && !isLabelChar(after);
}
