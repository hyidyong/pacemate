import assert from "node:assert/strict";
import test from "node:test";
import {
  SsoRegistryError,
  findSsoProviderByRef,
  findSsoProviderBySlug,
  parseSsoProviderRegistry,
} from "./provider-registry.ts";

// Stage 7 SSO provider registry: parsing is fail-closed (one bad entry
// rejects the whole registry), secrets are structurally rejected, and JIT can
// never be configured to yield a privileged role.

const VALID_ENTRY = {
  schoolId: "school-a",
  slug: "Univ-A",
  protocol: "oidc",
  providerRef: "custom:univ-a",
  issuer: "https://idp.univ-a.test",
  emailDomains: ["Univ-A.test"],
  enabled: true,
  policy: {
    jit: {
      enabled: true,
      allowedRoles: ["student"],
      requireEmailVerified: true,
      requireDomains: ["univ-a.test"],
    },
    enforceSsoOnly: false,
  },
};

test("empty/absent registry parses to an empty registry (SSO disabled)", () => {
  assert.deepEqual(parseSsoProviderRegistry(undefined), []);
  assert.deepEqual(parseSsoProviderRegistry(null), []);
  assert.deepEqual(parseSsoProviderRegistry(""), []);
  assert.deepEqual(parseSsoProviderRegistry("   "), []);
});

test("a valid descriptor parses with normalized slug/domains", () => {
  const [provider] = parseSsoProviderRegistry(JSON.stringify([VALID_ENTRY]));
  assert.equal(provider.slug, "univ-a");
  assert.equal(provider.schoolId, "school-a");
  assert.deepEqual(provider.emailDomains, ["univ-a.test"]);
  assert.equal(provider.enabled, true);
  assert.equal(provider.policy.jit.enabled, true);
});

test("defaults are safe: enabled=false, JIT off, enforceSsoOnly off", () => {
  const [provider] = parseSsoProviderRegistry(
    JSON.stringify([
      {
        schoolId: "school-a",
        slug: "univ-a",
        protocol: "saml",
        providerRef: "3f0e2c1a-0000-4000-8000-000000000001",
        issuer: "https://idp.univ-a.test/saml",
      },
    ]),
  );
  assert.equal(provider.enabled, false);
  assert.equal(provider.policy.jit.enabled, false);
  assert.deepEqual(provider.policy.jit.allowedRoles, []);
  assert.equal(provider.policy.jit.requireEmailVerified, true);
  assert.equal(provider.policy.enforceSsoOnly, false);
});

test("malformed registries are rejected wholesale", () => {
  for (const bad of [
    "not-json",
    JSON.stringify({}),
    JSON.stringify([{ ...VALID_ENTRY, schoolId: "" }]),
    JSON.stringify([{ ...VALID_ENTRY, protocol: "ldap" }]),
    JSON.stringify([{ ...VALID_ENTRY, providerRef: "univ-a" }]), // oidc must be custom:*
    JSON.stringify([VALID_ENTRY, VALID_ENTRY]), // duplicate slug/ref
  ]) {
    assert.throws(() => parseSsoProviderRegistry(bad), SsoRegistryError);
  }
});

test("secret-like fields are structurally rejected — secrets never live in the registry", () => {
  for (const secretField of [
    { clientSecret: "x" },
    { privateKey: "x" },
    { samlSigningCertificate: "x" },
    { password: "x" },
  ]) {
    assert.throws(
      () => parseSsoProviderRegistry(JSON.stringify([{ ...VALID_ENTRY, ...secretField }])),
      SsoRegistryError,
    );
  }
});

test("JIT allowedRoles can never contain a privileged role", () => {
  for (const roles of [["professor"], ["admin"], ["assistant"], ["student", "admin"]]) {
    const entry = {
      ...VALID_ENTRY,
      policy: { jit: { enabled: true, allowedRoles: roles } },
    };
    assert.throws(
      () => parseSsoProviderRegistry(JSON.stringify([entry])),
      SsoRegistryError,
    );
  }
});

test("slug lookup is case-insensitive and fails to null", () => {
  const registry = parseSsoProviderRegistry(JSON.stringify([VALID_ENTRY]));
  assert.equal(findSsoProviderBySlug(registry, "UNIV-A")?.schoolId, "school-a");
  assert.equal(findSsoProviderBySlug(registry, "unknown"), null);
  assert.equal(findSsoProviderBySlug(registry, ""), null);
  assert.equal(findSsoProviderBySlug(registry, null), null);
});

test("ref lookup matches both the registered ref and the sso:-prefixed identity spelling", () => {
  const samlEntry = {
    schoolId: "school-b",
    slug: "univ-b",
    protocol: "saml",
    providerRef: "3f0e2c1a-0000-4000-8000-000000000002",
    issuer: "https://idp.univ-b.test/saml",
    enabled: true,
  };
  const registry = parseSsoProviderRegistry(JSON.stringify([VALID_ENTRY, samlEntry]));
  assert.equal(findSsoProviderByRef(registry, "custom:univ-a")?.schoolId, "school-a");
  assert.equal(
    findSsoProviderByRef(registry, "sso:3f0e2c1a-0000-4000-8000-000000000002")?.schoolId,
    "school-b",
  );
  assert.equal(findSsoProviderByRef(registry, "custom:unknown"), null);
  assert.equal(findSsoProviderByRef(registry, null), null);
});
