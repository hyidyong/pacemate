import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAccountLink,
  evaluateSsoLogin,
  mapAffiliationToJitRole,
} from "./sso-login-policy.ts";

// Stage 7 SSO login decision — the TEST_MATRIX.md scenarios at the pure
// decision level, with a two-tenant fixture in the tenant-isolation style.
// Every deny asserts the enumerated reason (fail-closed, no partials).

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

function provider(overrides = {}) {
  return {
    schoolId: SCHOOL_A,
    slug: "univ-a",
    protocol: "oidc",
    providerRef: "custom:univ-a",
    issuer: "https://idp.univ-a.test",
    emailDomains: ["univ-a.test"],
    enabled: true,
    policy: {
      jit: {
        enabled: false,
        allowedRoles: [],
        requireEmailVerified: true,
        requireDomains: [],
      },
      enforceSsoOnly: false,
    },
    ...overrides,
  };
}

function jitProvider(jitOverrides = {}) {
  return provider({
    policy: {
      jit: {
        enabled: true,
        allowedRoles: ["student"],
        requireEmailVerified: true,
        requireDomains: ["univ-a.test"],
        ...jitOverrides,
      },
      enforceSsoOnly: false,
    },
  });
}

function identity(overrides = {}) {
  return {
    providerRef: "custom:univ-a",
    subject: "idp-sub-1",
    email: "member@univ-a.test",
    emailVerified: true,
    displayName: "A 학생",
    affiliation: "student",
    ...overrides,
  };
}

const ACTIVE_A = { id: SCHOOL_A, status: "active" };
const SUSPENDED_A = { id: SCHOOL_A, status: "suspended" };

const MEMBER_A = {
  id: "profile-a",
  identifier: "member@univ-a.test",
  role: "student",
  school_id: SCHOOL_A,
  auth_user_id: "auth-1",
};

test("valid University A member through University A's provider → allow with the DB role", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: provider(),
    profile: MEMBER_A,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, {
    kind: "allow",
    profileId: "profile-a",
    tenantId: SCHOOL_A,
    role: "student",
  });
});

test("the pre-provisioned role is reused verbatim — IdP claims never change it", () => {
  const decision = evaluateSsoLogin({
    identity: identity({ affiliation: "admin" }), // hostile claim
    provider: provider(),
    profile: { ...MEMBER_A, role: "professor" },
    school: ACTIVE_A,
  });
  assert.equal(decision.kind, "allow");
  assert.equal(decision.role, "professor");
});

test("valid A identity resolving to a University B membership → tenant_mismatch (cross-tenant deny)", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: provider(),
    profile: { ...MEMBER_A, school_id: SCHOOL_B },
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "tenant_mismatch" });
});

test("unknown provider → deny", () => {
  const decision = evaluateSsoLogin({
    identity: identity({ providerRef: "custom:unknown" }),
    provider: null,
    profile: MEMBER_A,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "unknown_provider" });
});

test("disabled provider → deny", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: provider({ enabled: false }),
    profile: MEMBER_A,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "provider_disabled" });
});

test("missing stable subject → controlled missing_required_claim failure", () => {
  const decision = evaluateSsoLogin({
    identity: identity({ subject: null }),
    provider: provider(),
    profile: MEMBER_A,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "missing_required_claim" });
});

test("school row absent or drifted from the provider's tenant → tenant_mismatch", () => {
  for (const school of [null, { id: SCHOOL_B, status: "active" }]) {
    const decision = evaluateSsoLogin({
      identity: identity(),
      provider: provider(),
      profile: MEMBER_A,
      school,
    });
    assert.deepEqual(decision, { kind: "deny", reason: "tenant_mismatch" });
  }
});

test("suspended (or unknown-status) tenant → school_suspended deny", () => {
  for (const school of [SUSPENDED_A, { id: SCHOOL_A, status: null }]) {
    const decision = evaluateSsoLogin({
      identity: identity(),
      provider: provider(),
      profile: MEMBER_A,
      school,
    });
    assert.deepEqual(decision, { kind: "deny", reason: "school_suspended" });
  }
});

test("membership with a role outside the app vocabulary fails closed", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: provider(),
    profile: { ...MEMBER_A, role: "superadmin" },
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "role_not_allowed" });
});

test("unknown user with JIT off (the default) → not_provisioned", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: provider(),
    profile: null,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "not_provisioned" });
});

test("new permitted user with JIT enabled → provision as student only", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: jitProvider(),
    profile: null,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "provision", tenantId: SCHOOL_A, role: "student" });
});

test("privileged/unknown affiliation claims never JIT-provision (no auto-escalation)", () => {
  for (const affiliation of ["admin", "faculty", "staff", "professor", "assistant", "law", null]) {
    const decision = evaluateSsoLogin({
      identity: identity({ affiliation }),
      provider: jitProvider(),
      profile: null,
      school: ACTIVE_A,
    });
    assert.deepEqual(decision, { kind: "deny", reason: "role_not_allowed" });
  }
});

test("JIT requires a verified institutional email", () => {
  assert.deepEqual(
    evaluateSsoLogin({
      identity: identity({ emailVerified: false }),
      provider: jitProvider(),
      profile: null,
      school: ACTIVE_A,
    }),
    { kind: "deny", reason: "email_unverified" },
  );
  assert.deepEqual(
    evaluateSsoLogin({
      identity: identity({ email: null }),
      provider: jitProvider(),
      profile: null,
      school: ACTIVE_A,
    }),
    { kind: "deny", reason: "missing_required_claim" },
  );
  assert.deepEqual(
    evaluateSsoLogin({
      identity: identity({ email: "someone@other-univ.test" }),
      provider: jitProvider(),
      profile: null,
      school: ACTIVE_A,
    }),
    { kind: "deny", reason: "not_provisioned" },
  );
});

test("JIT with an empty allowedRoles list denies even a student affiliation", () => {
  const decision = evaluateSsoLogin({
    identity: identity(),
    provider: jitProvider({ allowedRoles: [] }),
    profile: null,
    school: ACTIVE_A,
  });
  assert.deepEqual(decision, { kind: "deny", reason: "role_not_allowed" });
});

test("affiliation mapping allowlist yields student or nothing", () => {
  assert.equal(mapAffiliationToJitRole("student"), "student");
  assert.equal(mapAffiliationToJitRole(" Student "), "student");
  for (const value of ["faculty", "staff", "admin", "law", "", null]) {
    assert.equal(mapAffiliationToJitRole(value), null);
  }
});

// ---- Account linking (first login of a pre-provisioned profile) ------------

const UNLINKED_A = { ...MEMBER_A, auth_user_id: null };

test("account link succeeds only under all four conditions", () => {
  assert.deepEqual(
    evaluateAccountLink({ identity: identity(), provider: provider(), candidate: UNLINKED_A }),
    { ok: true },
  );
});

test("identifier match is case-insensitive but exact", () => {
  assert.deepEqual(
    evaluateAccountLink({
      identity: identity({ email: "MEMBER@UNIV-A.TEST" }),
      provider: provider(),
      candidate: UNLINKED_A,
    }),
    { ok: true },
  );
  assert.deepEqual(
    evaluateAccountLink({
      identity: identity({ email: "member2@univ-a.test" }),
      provider: provider(),
      candidate: UNLINKED_A,
    }),
    { ok: false, reason: "identity_conflict" },
  );
});

test("linking denies: no candidate, already-linked, unverified email, cross-tenant", () => {
  assert.deepEqual(
    evaluateAccountLink({ identity: identity(), provider: provider(), candidate: null }),
    { ok: false, reason: "not_provisioned" },
  );
  assert.deepEqual(
    evaluateAccountLink({ identity: identity(), provider: provider(), candidate: MEMBER_A }),
    { ok: false, reason: "identity_conflict" },
  );
  assert.deepEqual(
    evaluateAccountLink({
      identity: identity({ emailVerified: false }),
      provider: provider(),
      candidate: UNLINKED_A,
    }),
    { ok: false, reason: "email_unverified" },
  );
  assert.deepEqual(
    evaluateAccountLink({
      identity: identity(),
      provider: provider(),
      candidate: { ...UNLINKED_A, school_id: SCHOOL_B },
    }),
    { ok: false, reason: "tenant_mismatch" },
  );
});
