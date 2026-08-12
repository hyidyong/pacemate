// Stage 7 (SSO readiness) — tenant ↔ provider registry.
//
// A provider descriptor binds ONE thing that authorizes (schoolId ===
// schools.id) to the routing/verification metadata of the institution's IdP
// as brokered by Supabase Auth. PUBLIC METADATA ONLY: secrets (OIDC client
// secrets, SAML certs/keys) live exclusively in Supabase Auth's server-side
// provider configuration and are structurally rejected here (parse error) so
// they can never end up in env JSON that might leak into logs or the client.
//
// Zero imports on purpose (the src/lib/tenant.ts convention): pure,
// direct-importable, deterministic. Env access lives in the server boundary
// (sso-callback.service.ts), never here.

export type SsoProtocol = "oidc" | "saml";

// JIT may only ever yield the unprivileged role. This is a type-level AND
// runtime ceiling: professor/assistant/admin are pre-provisioned by humans.
export type SsoJitRole = "student";

export type SsoJitPolicy = {
  enabled: boolean;
  allowedRoles: readonly SsoJitRole[];
  requireEmailVerified: boolean;
  requireDomains: readonly string[];
};

export type SsoTenantPolicy = {
  jit: SsoJitPolicy;
  enforceSsoOnly: boolean;
};

export type SsoProviderDescriptor = {
  schoolId: string;
  slug: string;
  protocol: SsoProtocol;
  // GoTrue reference: "custom:<slug>" for custom OIDC providers, the SSO
  // provider uuid for SAML. SAML users surface as provider "sso:<uuid>" on
  // auth.identities, so lookups match both spellings.
  providerRef: string;
  issuer: string;
  emailDomains: readonly string[];
  enabled: boolean;
  policy: SsoTenantPolicy;
};

export type SsoProviderRegistry = readonly SsoProviderDescriptor[];

export class SsoRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoRegistryError";
  }
}

const SECRET_KEY_PATTERN =
  /secret|private|certificate|password|credential|signing/i;

const CUSTOM_OIDC_REF_PATTERN = /^custom:[a-z0-9][a-z0-9_-]*$/;

function requireNonEmptyString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SsoRegistryError(`provider[${index}].${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeStringArray(value: unknown, field: string, index: number): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new SsoRegistryError(`provider[${index}].${field} must be an array of strings`);
  }
  return value.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function rejectSecretKeys(entry: Record<string, unknown>, index: number) {
  for (const key of Object.keys(entry)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new SsoRegistryError(
        `provider[${index}] carries a secret-like field "${key}" — secrets belong in the auth platform's server-side provider config, never in the registry`,
      );
    }
  }
}

function parseJitPolicy(value: unknown, index: number): SsoJitPolicy {
  const raw = (value ?? {}) as Record<string, unknown>;
  const allowedRolesRaw = raw.allowedRoles === undefined ? [] : raw.allowedRoles;
  if (
    !Array.isArray(allowedRolesRaw) ||
    allowedRolesRaw.some((role) => role !== "student")
  ) {
    throw new SsoRegistryError(
      `provider[${index}].policy.jit.allowedRoles may only contain "student" — privileged roles are never JIT-provisionable`,
    );
  }
  return {
    enabled: raw.enabled === true,
    allowedRoles: allowedRolesRaw as SsoJitRole[],
    requireEmailVerified: raw.requireEmailVerified !== false,
    requireDomains: normalizeStringArray(raw.requireDomains, "policy.jit.requireDomains", index),
  };
}

// Parses the env-supplied registry JSON. Fails closed: any malformed entry
// rejects the WHOLE registry (a partially-trusted identity config is worse
// than none). An absent/empty value is a valid empty registry.
export function parseSsoProviderRegistry(raw: string | null | undefined): SsoProviderRegistry {
  if (!raw || !raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SsoRegistryError("registry is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new SsoRegistryError("registry must be a JSON array of provider descriptors");
  }

  const seenSlugs = new Set<string>();
  const seenRefs = new Set<string>();

  return parsed.map((entryRaw, index) => {
    if (typeof entryRaw !== "object" || entryRaw === null || Array.isArray(entryRaw)) {
      throw new SsoRegistryError(`provider[${index}] must be an object`);
    }
    const entry = entryRaw as Record<string, unknown>;
    rejectSecretKeys(entry, index);

    const protocol = entry.protocol;
    if (protocol !== "oidc" && protocol !== "saml") {
      throw new SsoRegistryError(`provider[${index}].protocol must be "oidc" or "saml"`);
    }

    const providerRef = requireNonEmptyString(entry.providerRef, "providerRef", index);
    if (protocol === "oidc" && !CUSTOM_OIDC_REF_PATTERN.test(providerRef)) {
      throw new SsoRegistryError(
        `provider[${index}].providerRef must look like "custom:<slug>" for OIDC providers`,
      );
    }

    const slug = requireNonEmptyString(entry.slug, "slug", index).toLowerCase();
    if (seenSlugs.has(slug)) {
      throw new SsoRegistryError(`provider[${index}].slug "${slug}" is duplicated`);
    }
    seenSlugs.add(slug);
    if (seenRefs.has(providerRef)) {
      throw new SsoRegistryError(`provider[${index}].providerRef is duplicated`);
    }
    seenRefs.add(providerRef);

    const policyRaw = (entry.policy ?? {}) as Record<string, unknown>;

    const descriptor: SsoProviderDescriptor = {
      schoolId: requireNonEmptyString(entry.schoolId, "schoolId", index),
      slug,
      protocol,
      providerRef,
      issuer: requireNonEmptyString(entry.issuer, "issuer", index),
      emailDomains: normalizeStringArray(entry.emailDomains, "emailDomains", index),
      enabled: entry.enabled === true,
      policy: {
        jit: parseJitPolicy(policyRaw.jit, index),
        enforceSsoOnly: policyRaw.enforceSsoOnly === true,
      },
    };
    return descriptor;
  });
}

export function findSsoProviderBySlug(
  registry: SsoProviderRegistry,
  slug: string | null | undefined,
): SsoProviderDescriptor | null {
  if (typeof slug !== "string" || !slug.trim()) return null;
  const normalized = slug.trim().toLowerCase();
  return registry.find((provider) => provider.slug === normalized) ?? null;
}

// Matches the provider string GoTrue reports on auth.identities. SAML
// identities surface as "sso:<provider-uuid>" while the registry stores the
// bare uuid it was registered with — both spellings resolve.
export function findSsoProviderByRef(
  registry: SsoProviderRegistry,
  providerRef: string | null | undefined,
): SsoProviderDescriptor | null {
  if (typeof providerRef !== "string" || !providerRef.trim()) return null;
  const ref = providerRef.trim();
  return (
    registry.find(
      (provider) => provider.providerRef === ref || `sso:${provider.providerRef}` === ref,
    ) ?? null
  );
}
