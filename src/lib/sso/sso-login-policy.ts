// Stage 7 (SSO readiness) — the pure login/linking decision.
//
// Authentication (who did the IdP verify — done upstream by the auth
// platform) is separated from authorization (what may this identity do in
// this tenant — decided HERE). Nothing in this module trusts a client value:
// callers pass the server-verified identity snapshot, the registry-resolved
// provider, and server-read profile/school rows. Zero imports (the
// src/lib/tenant.ts convention) so every branch is directly testable.
//
// Deny-by-default: any state this module does not positively recognize is a
// deny with an enumerated reason. Reasons feed /login?error=sso_<reason> and
// the audit log; user-facing copy stays generic (no account-existence
// oracle).

import type { SsoProviderDescriptor } from "./provider-registry";

export type SsoAppRole = "student" | "professor" | "assistant" | "admin";

export type SsoIdentitySnapshot = {
  providerRef: string;
  // The IdP's permanent subject identifier — the ONLY per-user trusted key.
  subject: string | null;
  email: string | null;
  emailVerified: boolean;
  // Display-only; never keys anything.
  displayName: string | null;
  // Untrusted by default; consulted only through the JIT allowlist below.
  affiliation: string | null;
};

export type SsoProfileRow = {
  id: string;
  identifier?: string | null;
  role: string | null;
  school_id: string | null;
  auth_user_id: string | null;
};

export type SsoSchoolRow = {
  id: string;
  status: string | null;
};

export type SsoDenyReason =
  | "unknown_provider"
  | "provider_disabled"
  | "missing_required_claim"
  | "tenant_mismatch"
  | "school_suspended"
  | "not_provisioned"
  | "identity_conflict"
  | "email_unverified"
  | "role_not_allowed"
  | "failed";

export type SsoLoginDecision =
  | { kind: "allow"; profileId: string; tenantId: string; role: SsoAppRole }
  | { kind: "provision"; tenantId: string; role: "student" }
  | { kind: "deny"; reason: SsoDenyReason };

function isAppRole(value: unknown): value is SsoAppRole {
  return (
    value === "student" ||
    value === "professor" ||
    value === "assistant" ||
    value === "admin"
  );
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
}

function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

// The explicit allowlist (spec §12): the only affiliation value that maps to
// anything is "student", and the only role it maps to is student.
// "department = law" (or faculty/staff/anything else) maps to NOTHING.
export function mapAffiliationToJitRole(affiliation: string | null): "student" | null {
  if (typeof affiliation !== "string") return null;
  return affiliation.trim().toLowerCase() === "student" ? "student" : null;
}

export function evaluateSsoLogin(input: {
  identity: SsoIdentitySnapshot;
  provider: SsoProviderDescriptor | null;
  profile: SsoProfileRow | null;
  school: SsoSchoolRow | null;
}): SsoLoginDecision {
  const { identity, provider, profile, school } = input;

  if (!provider) {
    return { kind: "deny", reason: "unknown_provider" };
  }
  if (!provider.enabled) {
    return { kind: "deny", reason: "provider_disabled" };
  }
  if (!identity.subject) {
    return { kind: "deny", reason: "missing_required_claim" };
  }
  // The school row must exist and be the exact tenant this provider was
  // registered for — a registry/DB drift fails closed, and provider A can
  // never assert into tenant B.
  if (!school || school.id !== provider.schoolId) {
    return { kind: "deny", reason: "tenant_mismatch" };
  }
  if (school.status !== "active") {
    return { kind: "deny", reason: "school_suspended" };
  }

  if (profile) {
    // Existing membership: reuse it. The pre-provisioned role is
    // authoritative — IdP claims never change it (no silent escalation or
    // demotion).
    if (profile.school_id !== provider.schoolId) {
      return { kind: "deny", reason: "tenant_mismatch" };
    }
    if (!isAppRole(profile.role)) {
      return { kind: "deny", reason: "role_not_allowed" };
    }
    return {
      kind: "allow",
      profileId: profile.id,
      tenantId: school.id,
      role: profile.role,
    };
  }

  // No membership: JIT is an explicit per-tenant opt-in, default OFF
  // (pre-provisioned/invite model, SSO_DESIGN §7).
  const jit = provider.policy.jit;
  if (!jit.enabled) {
    return { kind: "deny", reason: "not_provisioned" };
  }
  const email = normalizeEmail(identity.email);
  if (!email) {
    return { kind: "deny", reason: "missing_required_claim" };
  }
  if (jit.requireEmailVerified && !identity.emailVerified) {
    return { kind: "deny", reason: "email_unverified" };
  }
  if (jit.requireDomains.length > 0) {
    const domain = emailDomain(email);
    if (!domain || !jit.requireDomains.includes(domain)) {
      return { kind: "deny", reason: "not_provisioned" };
    }
  }
  const mappedRole = mapAffiliationToJitRole(identity.affiliation);
  // Both the mapping ceiling and the policy allowlist must agree — and the
  // hard-coded "student" comparison keeps a future config mistake from ever
  // provisioning anything else.
  if (!mappedRole || mappedRole !== "student" || !jit.allowedRoles.includes(mappedRole)) {
    return { kind: "deny", reason: "role_not_allowed" };
  }
  return { kind: "provision", tenantId: school.id, role: "student" };
}

export type SsoAccountLinkDecision =
  | { ok: true }
  | { ok: false; reason: SsoDenyReason };

// First-login linking of a verified institutional identity to a
// PRE-PROVISIONED profile (auth_user_id still NULL). Email is trusted for
// exactly this one operation, under all four conditions (SSO_DESIGN §5).
export function evaluateAccountLink(input: {
  identity: SsoIdentitySnapshot;
  provider: SsoProviderDescriptor;
  candidate: SsoProfileRow | null;
}): SsoAccountLinkDecision {
  const { identity, provider, candidate } = input;

  if (!candidate) {
    return { ok: false, reason: "not_provisioned" };
  }
  if (candidate.auth_user_id) {
    return { ok: false, reason: "identity_conflict" };
  }
  const email = normalizeEmail(identity.email);
  if (!email || !identity.emailVerified) {
    return { ok: false, reason: "email_unverified" };
  }
  if (normalizeEmail(candidate.identifier) !== email) {
    return { ok: false, reason: "identity_conflict" };
  }
  if (candidate.school_id !== provider.schoolId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  return { ok: true };
}
